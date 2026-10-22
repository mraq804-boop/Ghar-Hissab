"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MONTHS_LONG } from "@/lib/periods";
import { getContext, isAdmin } from "@/server/auth";
import { dbError, forbidden, invalid, type ActionResult } from "@/server/actions/result";
import { sniffMime } from "@/lib/validation/payment";
import { getReference, type ExpenseRow } from "@/server/data/ledger";
import { kickSync } from "@/server/excel/kick";
import { PROVIDERS, isProvider, type Provider } from "@/lib/utilities/providers";
import { checkMeter, type CheckOutcome } from "@/server/lesco/check";
import { onBillArrived, onMeterReading } from "@/server/notify/events";
import { createSupabaseAdmin } from "@/server/supabase/admin";

const meterSchema = z
  .object({
    provider: z.string().refine(isProvider, "Choose LESCO, WASA or SNGPL."),
    label: z.string().trim().min(1, "Give it a name, e.g. Ground floor").max(60),
    referenceNo: z.string().transform((s) => s.replace(/\D/g, "")),
    categoryId: z.uuid().nullable(),
  })
  .superRefine((v, ctx) => {
    if (!isProvider(v.provider)) return;
    const p = PROVIDERS[v.provider];
    if (!p.pattern.test(v.referenceNo)) ctx.addIssue({ code: "custom", path: ["referenceNo"], message: `Check the ${p.numberLabel.toLowerCase()}: ${p.numberHint.toLowerCase()}.` });
  });

const METER_COLUMNS = "id, household_id, reference_no, label, provider";

function outcomeMessage(o: CheckOutcome, label: string) {
  if (o.status === "error") return { ok: false as const, error: o.message };
  const due = o.bill.dueDate ? `, due ${new Date(o.bill.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "";
  return { ok: true as const, data: undefined, message: `${label}: ${o.status === "new" ? "bill found" : "bill is up to date"}, Rs ${o.bill.payable.toLocaleString("en-US")}${due}` };
}

export async function addMeter(input: z.input<typeof meterSchema>): Promise<ActionResult> {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return forbidden;
  const parsed = meterSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  const { data, error } = await ctx.supabase
    .from("utility_meters")
    .insert({ household_id: ctx.householdId, provider: v.provider, label: v.label, reference_no: v.referenceNo, category_id: v.categoryId })
    .select(METER_COLUMNS)
    .single();
  if (error) return error.code === "23505" ? { ok: false, error: "That number is already added." } : dbError(error);
  const provider = PROVIDERS[v.provider as Provider];
  if (!provider.fetches) {
    revalidatePath("/bills");
    return { ok: true, data: undefined, message: `${v.label} added. Use "Get bill" and "Upload bill" when the ${provider.utility.toLowerCase()} bill comes.` };
  }
  const outcome = await checkMeter(createSupabaseAdmin(), { ...data, provider: v.provider as Provider }, { onNewBill: onBillArrived });
  revalidatePath("/bills");
  revalidatePath("/dashboard");
  const r = outcomeMessage(outcome, v.label);
  return r.ok ? r : { ok: true, data: undefined, message: `Meter added. ${r.error}` };
}

const updateSchema = z.object({ id: z.uuid(), label: z.string().trim().min(1, "Give it a name").max(60), categoryId: z.uuid().nullable(), active: z.boolean() });

export async function updateMeter(input: z.input<typeof updateSchema>): Promise<ActionResult> {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return forbidden;
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  const { error } = await ctx.supabase.from("utility_meters").update({ label: v.label, category_id: v.categoryId, active: v.active }).eq("id", v.id);
  if (error) return dbError(error);
  revalidatePath("/bills");
  return { ok: true, data: undefined, message: "Meter saved" };
}

export async function deleteMeter(id: string): Promise<ActionResult> {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return forbidden;
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "That meter couldn't be found." };
  const { data: bills } = await ctx.supabase.from("utility_bills").select("snapshot_path").eq("meter_id", id);
  const { error } = await ctx.supabase.from("utility_meters").delete().eq("id", id);
  if (error) return dbError(error);
  const paths = (bills ?? []).map((b) => b.snapshot_path).filter((p): p is string => Boolean(p));
  if (paths.length) await createSupabaseAdmin().storage.from("utility-bills").remove(paths);
  revalidatePath("/bills");
  revalidatePath("/dashboard");
  return { ok: true, data: undefined, message: "Meter and its saved bills removed" };
}

export async function checkNow(id: string): Promise<ActionResult> {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return forbidden;
  const { data: meter } = await ctx.supabase.from("utility_meters").select(METER_COLUMNS).eq("id", id).maybeSingle();
  if (!meter || !isProvider(meter.provider)) return { ok: false, error: "That meter couldn't be found." };
  const outcome = await checkMeter(createSupabaseAdmin(), { ...meter, provider: meter.provider }, { onNewBill: onBillArrived });
  revalidatePath("/bills");
  revalidatePath("/dashboard");
  return outcomeMessage(outcome, meter.label);
}

const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export async function addBillToExpenses(billId: string): Promise<ActionResult<{ expenseId: string }>> {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return forbidden;
  if (!z.uuid().safeParse(billId).success) return { ok: false, error: "That bill couldn't be found." };

  const { data: bill } = await ctx.supabase
    .from("utility_bills")
    .select("id, bill_month, payable, due_date, meter_id, utility_meters(id, label, category_id, provider)")
    .eq("id", billId)
    .maybeSingle();
  if (!bill) return { ok: false, error: "That bill couldn't be found." };
  const meter = bill.utility_meters as unknown as { id: string; label: string; category_id: string | null; provider: string };
  const company = isProvider(meter.provider) ? PROVIDERS[meter.provider].name : "Utility";
  if (!meter.category_id) return { ok: false, error: `Choose which expense "${meter.label}" belongs to first (Bills → the meter's category).` };

  const ref = await getReference();
  const [year, month] = (bill.bill_month as string).split("-").map(Number);
  const period = ref.periods.find((p) => p.year === year && p.month === month);
  if (!period) return { ok: false, error: `Start ${MONTHS_LONG[month - 1]} ${year} in Expenses first, then add the bill.` };
  if (period.status === "closed") return { ok: false, error: `${MONTHS_LONG[month - 1]} ${year} is closed. Reopen it to add the bill.` };
  const category = ref.categories.find((c) => c.id === meter.category_id);
  if (!category) return { ok: false, error: "The meter's category no longer exists. Choose another one." };

  const { data: rows, error: loadError } = await ctx.supabase
    .from("expenses")
    .select("id, title, amount, qty_text, description, split_rule_id, split_override, expense_date, paid_by_unit_id, notes, section_id, category_id, version")
    .eq("period_id", period.id)
    .eq("category_id", category.id)
    .is("deleted_at", null);
  if (loadError) return dbError(loadError);
  const candidates = (rows ?? []) as unknown as (ExpenseRow & { version: number })[];

  const { count: metersInCategory } = await ctx.supabase
    .from("utility_meters")
    .select("id", { count: "exact", head: true })
    .eq("category_id", category.id)
    .eq("active", true);

  const target =
    candidates.find((e) => norm(e.title) === norm(meter.label)) ??
    (candidates.length === 1 && (metersInCategory ?? 0) <= 1 ? candidates[0] : undefined) ??
    (candidates.filter((e) => e.amount === null).length === 1 ? candidates.find((e) => e.amount === null) : undefined);

  const amount = Number(bill.payable).toFixed(2);
  const dueNote = bill.due_date ? `${company} bill, due ${new Date(bill.due_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : `${company} bill`;
  let payload: Record<string, unknown>;
  if (target) {
    payload = {
      id: target.id,
      expected_version: target.version,
      household_id: ctx.householdId,
      period_id: period.id,
      section_id: target.section_id,
      category_id: target.category_id,
      title: target.title,
      description: target.description ?? "",
      qty_text: target.qty_text ?? "",
      qty_num: "",
      rate: "",
      amount,
      split_rule_id: target.split_rule_id,
      split_override: target.split_override,
      expense_date: target.expense_date ?? "",
      paid_by_unit_id: target.paid_by_unit_id,
      notes: target.notes || dueNote,
    };
  } else {
    if (!category.default_split_rule_id) return { ok: false, error: `"${category.name}" has no default split. Add the expense by hand once, then try again.` };
    const purse = ref.units.find((u) => u.is_purse_holder) ?? ref.units[0];
    payload = {
      household_id: ctx.householdId,
      period_id: period.id,
      section_id: category.section_id,
      category_id: category.id,
      title: meter.label,
      description: "",
      qty_text: "",
      qty_num: "",
      rate: "",
      amount,
      split_rule_id: category.default_split_rule_id,
      split_override: null,
      expense_date: "",
      paid_by_unit_id: purse.id,
      notes: dueNote,
    };
  }

  const { data, error } = await ctx.supabase.rpc("upsert_expense", { p: payload });
  if (error) return dbError(error);
  const saved = (data as { id: string }[])[0];
  const link = await ctx.supabase.from("utility_bills").update({ expense_id: saved.id }).eq("id", bill.id);
  if (link.error) return dbError(link.error);

  revalidatePath("/", "layout");
  kickSync();
  return {
    ok: true,
    data: { expenseId: saved.id },
    message: target ? `${target.title} updated to Rs ${Number(amount).toLocaleString("en-US")}` : `${meter.label} added: Rs ${Number(amount).toLocaleString("en-US")}`,
  };
}

const UPLOAD_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" } as const;
const MAX_UPLOAD = 4 * 1024 * 1024;

const uploadSchema = z.object({
  meterId: z.uuid(),
  billMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose the bill month."),
  dueDate: z.union([z.literal(""), z.iso.date("Enter the due date.")]),
  payable: z.coerce.number({ error: "Enter the amount payable." }).positive("Enter the amount payable.").max(10_000_000),
  afterDue: z.union([z.literal(""), z.coerce.number().positive().max(10_000_000)]),
});

/** Saves a bill the admin uploaded (photo, screenshot or PDF) with the figures they confirmed. */
export async function uploadBill(form: FormData): Promise<ActionResult> {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return forbidden;
  const parsed = uploadSchema.safeParse({
    meterId: form.get("meterId"),
    billMonth: form.get("billMonth"),
    dueDate: form.get("dueDate") ?? "",
    payable: form.get("payable"),
    afterDue: form.get("afterDue") ?? "",
  });
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose the bill photo, screenshot or PDF." };
  if (file.size > MAX_UPLOAD) return { ok: false, error: "That file is bigger than 4 MB. Take a screenshot of the bill instead." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffMime(bytes);
  if (!mime || !(mime in UPLOAD_TYPES)) return { ok: false, error: mime === "image/heic" ? "iPhone HEIC photos aren't supported. Take a screenshot of the bill instead." : "Upload a JPG, PNG, WebP or PDF." };

  const { data: meter } = await ctx.supabase.from("utility_meters").select("id, household_id, provider").eq("id", v.meterId).maybeSingle();
  if (!meter || meter.household_id !== ctx.householdId) return { ok: false, error: "That connection couldn't be found." };

  const admin = createSupabaseAdmin();
  const path = `${ctx.householdId}/${meter.id}/${v.billMonth}-upload.${UPLOAD_TYPES[mime as keyof typeof UPLOAD_TYPES]}`;
  const up = await admin.storage.from("utility-bills").upload(path, bytes, { contentType: mime, upsert: true });
  if (up.error) return { ok: false, error: "The bill couldn't be saved. Try again." };

  const { data: previous } = await admin.from("utility_bills").select("snapshot_path").eq("meter_id", meter.id).eq("bill_month", `${v.billMonth}-01`).maybeSingle();
  const saved = await admin.from("utility_bills").upsert(
    {
      household_id: ctx.householdId,
      meter_id: meter.id,
      bill_month: `${v.billMonth}-01`,
      due_date: v.dueDate || null,
      payable: v.payable,
      late_payments: v.afterDue === "" ? [] : [{ until: null, amount: v.afterDue }],
      snapshot_path: path,
      snapshot_mime: mime,
      source: "upload",
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "meter_id,bill_month" },
  );
  if (saved.error) return dbError(saved.error);
  if (previous?.snapshot_path && previous.snapshot_path !== path) await admin.storage.from("utility-bills").remove([previous.snapshot_path]);
  if (!previous) onBillArrived(ctx.householdId, meter.id, v.billMonth);

  revalidatePath("/bills");
  revalidatePath("/dashboard");
  return { ok: true, data: undefined, message: `Bill saved: Rs ${v.payable.toLocaleString("en-US")}` };
}

const readingSchema = z.object({
  meterId: z.uuid(),
  reading: z.coerce.number({ error: "Enter the number shown on the meter." }).int("Use whole units, without decimals.").min(0).max(9_999_999),
  photoPath: z.string().max(200).nullable().optional(),
});

/** Any household member can record a meter reading. */
export async function addMeterReading(input: z.input<typeof readingSchema>): Promise<ActionResult> {
  const ctx = await getContext();
  const parsed = readingSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  if (v.photoPath && !v.photoPath.startsWith(`${ctx.householdId}/`)) return { ok: false, error: "That photo upload isn't valid. Take it again." };

  const { data: bill } = await ctx.supabase
    .from("utility_bills")
    .select("present_reading")
    .eq("meter_id", v.meterId)
    .not("present_reading", "is", null)
    .order("bill_month", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (bill?.present_reading !== null && bill?.present_reading !== undefined) {
    if (v.reading < bill.present_reading) return { ok: false, error: `That's lower than LESCO's last reading (${bill.present_reading}). Check the number, reading only the black digits.` };
    if (v.reading - bill.present_reading > 2000) return { ok: false, error: `That's ${v.reading - bill.present_reading} units since LESCO's last reading. Check the number before saving.` };
  }

  const { error } = await ctx.supabase.from("meter_readings").insert({ household_id: ctx.householdId, meter_id: v.meterId, reading: v.reading, photo_path: v.photoPath ?? null });
  if (error) return dbError(error);
  onMeterReading(ctx.householdId, v.meterId);
  revalidatePath("/bills");
  revalidatePath("/dashboard");
  return { ok: true, data: undefined, message: `Reading ${v.reading} saved` };
}

export async function deleteMeterReading(id: string): Promise<ActionResult> {
  const ctx = await getContext();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "That reading couldn't be found." };
  const { data, error } = await ctx.supabase.from("meter_readings").delete().eq("id", id).select("photo_path");
  if (error) return dbError(error);
  if (!data.length) return { ok: false, error: "You can only remove readings you added." };
  if (data[0].photo_path) await ctx.supabase.storage.from("meter-photos").remove([data[0].photo_path]);
  revalidatePath("/bills");
  revalidatePath("/dashboard");
  return { ok: true, data: undefined, message: "Reading removed" };
}

export async function setUnitLimit(input: { meterId: string; limit: number }): Promise<ActionResult> {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return forbidden;
  const parsed = z.object({ meterId: z.uuid(), limit: z.coerce.number().int().min(1).max(10_000) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter a whole number of units, e.g. 200." };
  const { error } = await ctx.supabase.from("utility_meters").update({ unit_limit: parsed.data.limit }).eq("id", parsed.data.meterId);
  if (error) return dbError(error);
  revalidatePath("/bills");
  revalidatePath("/dashboard");
  return { ok: true, data: undefined, message: `Limit set to ${parsed.data.limit} units` };
}
