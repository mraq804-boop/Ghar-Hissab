"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { paymentInputSchema, reviewSchema, sniffMime, type PaymentInputForm } from "@/lib/validation/payment";
import { getContext, isAdmin } from "@/server/auth";
import { dbError, forbidden, invalid, type ActionResult } from "@/server/actions/result";
import { kickSync } from "@/server/excel/kick";

export async function submitPayment(input: PaymentInputForm): Promise<ActionResult<{ id: string; duplicateScreenshot: boolean; replayed: boolean }>> {
  const ctx = await getContext();
  const parsed = paymentInputSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  if (!isAdmin(ctx) && v.payerUnitId !== ctx.unitId) return { ok: false, error: "You can only record payments for your own household." };

  let attachment: { path: string; mime: string; size: number; sha256: string } | null = null;
  if (v.proofPath) {
    const parts = v.proofPath.split("/");
    if (parts.length !== 3 || parts[0] !== ctx.householdId || parts[1] !== ctx.userId) return { ok: false, error: "The screenshot upload is not valid. Upload it again." };
    const { data: blob, error } = await ctx.supabase.storage.from("payment-proofs").download(v.proofPath);
    if (error || !blob) return { ok: false, error: "The screenshot upload could not be found. Upload it again." };
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const limit = ctx.settings.maxUploadMb * 1024 * 1024;
    if (bytes.byteLength === 0 || bytes.byteLength > limit) return { ok: false, error: `Screenshots must be smaller than ${ctx.settings.maxUploadMb} MB.` };
    const mime = sniffMime(bytes);
    if (!mime) return { ok: false, error: "That file is not a supported image or PDF." };
    attachment = { path: v.proofPath, mime, size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
  }

  const { data, error } = await ctx.supabase.rpc("submit_payment", {
    p: {
      household_id: ctx.householdId,
      idempotency_key: v.idempotencyKey,
      period_id: v.periodId,
      payer_unit_id: v.payerUnitId,
      payer_member_id: v.payerUnitId === ctx.unitId ? ctx.memberId : null,
      amount: v.amount,
      paid_on: v.paidOn,
      method: v.method,
      reference: v.reference,
      related_expense_id: v.relatedExpenseId ?? null,
      notes: v.notes,
      attachment,
    },
  });
  if (error) return dbError(error);
  const row = (data as { id: string; duplicate_screenshot: boolean; replayed: boolean }[])[0];
  revalidatePath("/", "layout");
  return {
    ok: true,
    data: { id: row.id, duplicateScreenshot: row.duplicate_screenshot, replayed: row.replayed },
    message: row.replayed ? "This payment was already recorded" : "Payment recorded. It counts once it is verified.",
  };
}

export async function reviewPayment(input: z.input<typeof reviewSchema>): Promise<ActionResult<{ status: string; version: number }>> {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return forbidden;
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { data, error } = await ctx.supabase.rpc("review_payment", {
    payment_id: parsed.data.paymentId,
    decision: parsed.data.decision,
    expected_version: parsed.data.version,
    reason: parsed.data.reason || null,
  });
  if (error) return dbError(error);
  const row = (data as { status: string; version: number }[])[0];
  revalidatePath("/", "layout");
  if (parsed.data.decision === "approved") kickSync();
  return { ok: true, data: row, message: parsed.data.decision === "approved" ? "Payment approved" : "Payment rejected" };
}

export async function proofUrl(paymentId: string): Promise<ActionResult<{ url: string; mime: string }>> {
  const ctx = await getContext();
  if (!z.uuid().safeParse(paymentId).success) return forbidden;
  const { data: att } = await ctx.supabase
    .from("payment_attachments")
    .select("storage_path, mime_type")
    .eq("payment_id", paymentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!att) return { ok: false, error: "No screenshot attached, or you don't have access to it." };
  const { data, error } = await ctx.supabase.storage.from("payment-proofs").createSignedUrl(att.storage_path, 60);
  if (error || !data) return { ok: false, error: "The screenshot could not be opened." };
  return { ok: true, data: { url: data.signedUrl, mime: att.mime_type } };
}
