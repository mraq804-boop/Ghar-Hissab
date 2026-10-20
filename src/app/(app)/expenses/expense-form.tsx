"use client";

import { useMemo, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Field } from "@/components/ledger/field";
import { formatPaisa } from "@/lib/finance/money";
import { previewSplit } from "@/lib/finance/expense-preview";
import type { RuleRow } from "@/lib/finance/rules";
import type { ExpenseInputForm, SplitInput } from "@/lib/validation/expense";
import { cn } from "@/lib/utils";
import { saveExpense } from "./actions";

export type FormRef = {
  units: { id: string; code: string; sort_order: number; is_purse_holder: boolean }[];
  sections: { id: string; key: string; title: string }[];
  rules: (RuleRow & { name: string; description: string | null; active: boolean })[];
  categories: { id: string; name: string; section_id: string; default_split_rule_id: string | null; active: boolean }[];
};

type SplitMode = "rule" | "equal_units" | "percentage" | "custom_amounts";

type FormValues = ExpenseInputForm & {
  splitMode: SplitMode;
  ruleId: string;
  equalUnits: string[];
  percents: Record<string, string>;
  customAmounts: Record<string, string>;
};

function toSplit(v: FormValues): SplitInput {
  switch (v.splitMode) {
    case "rule":
      return { type: "rule", ruleId: v.ruleId };
    case "equal_units":
      return { type: "equal_units", unitIds: v.equalUnits };
    case "percentage":
      return { type: "percentage", parts: Object.entries(v.percents).filter(([, p]) => p !== "" && Number(p) > 0).map(([unitId, p]) => ({ unitId, percent: Number(p) })) };
    case "custom_amounts":
      return { type: "custom_amounts", parts: Object.entries(v.customAmounts).filter(([, a]) => a.trim() !== "" && Number(a.replace(/,/g, "")) > 0).map(([unitId, amount]) => ({ unitId, amount })) };
  }
}

export function ExpenseForm({
  refData,
  periodId,
  initial,
  onDone,
}: {
  refData: FormRef;
  periodId: string;
  initial?: Partial<FormValues> & { id?: string; expectedVersion?: number };
  onDone: () => void;
}) {
  const purse = refData.units.find((u) => u.is_purse_holder) ?? refData.units[0];
  const defaultRule = refData.rules.find((r) => r.type === "equal_units" && r.parts.length === refData.units.length) ?? refData.rules[0];
  const [pending, start] = useTransition();

  const form = useForm<FormValues>({
    defaultValues: {
      periodId,
      sectionId: refData.sections[0]?.id ?? "",
      categoryId: null,
      title: "",
      description: "",
      qtyText: "",
      pricing: "amount",
      qty: "",
      rate: "",
      amount: "",
      expenseDate: "",
      paidByUnitId: purse?.id ?? "",
      notes: "",
      splitMode: "rule",
      ruleId: defaultRule?.id ?? "",
      equalUnits: refData.units.map((u) => u.id),
      percents: {},
      customAmounts: {},
      split: { type: "rule", ruleId: defaultRule?.id ?? "" },
      ...initial,
    },
  });
  const { register, control, handleSubmit, setValue, formState, setError } = form;
  const v = useWatch({ control }) as FormValues;

  const preview = useMemo(
    () =>
      previewSplit({
        pricing: v.pricing ?? "amount",
        amount: v.amount ?? "",
        qty: v.qty ?? "",
        rate: v.rate ?? "",
        split: toSplit(v),
        rules: refData.rules,
        units: refData.units.map((u) => ({ id: u.id, code: u.code, sortOrder: u.sort_order })),
      }),
    [v, refData],
  );

  const submit = handleSubmit((values) => {
    const payload: ExpenseInputForm = {
      id: initial?.id,
      expectedVersion: initial?.expectedVersion,
      periodId,
      sectionId: values.sectionId,
      categoryId: values.categoryId || null,
      title: values.title,
      description: values.description,
      qtyText: values.qtyText,
      pricing: values.pricing,
      qty: values.qty,
      rate: values.rate,
      amount: values.amount,
      expenseDate: values.expenseDate,
      paidByUnitId: values.paidByUnitId,
      notes: values.notes,
      split: toSplit(values),
    };
    start(async () => {
      const r = await saveExpense(payload);
      if (r.ok) {
        toast.success(r.message);
        onDone();
      } else {
        for (const [k, msgs] of Object.entries(r.fieldErrors ?? {})) setError(k as keyof FormValues, { message: msgs[0] });
        toast.error(r.error);
      }
    });
  });

  const err = (k: string) => (formState.errors as Record<string, { message?: string }>)[k]?.message;
  const activeCategories = refData.categories.filter((c) => c.active || c.id === initial?.categoryId);

  return (
    <form onSubmit={submit} className="space-y-5 pb-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" htmlFor="categoryId">
          <Controller
            control={control}
            name="categoryId"
            render={({ field }) => (
              <Select
                value={field.value ?? ""}
                onValueChange={(id) => {
                  field.onChange(id);
                  const c = refData.categories.find((x) => x.id === id);
                  if (c) {
                    setValue("sectionId", c.section_id);
                    if (c.default_split_rule_id && v.splitMode === "rule") setValue("ruleId", c.default_split_rule_id);
                  }
                }}
              >
                <SelectTrigger id="categoryId" className="h-10 w-full"><SelectValue placeholder="Choose a category" /></SelectTrigger>
                <SelectContent>
                  {refData.sections.map((s) => {
                    const cats = activeCategories.filter((c) => c.section_id === s.id);
                    return cats.length ? (
                      <SelectGroup key={s.id}>
                        <SelectLabel>{s.title}</SelectLabel>
                        {cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectGroup>
                    ) : null;
                  })}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
        <Field label="Section in the workbook" htmlFor="sectionId">
          <Controller
            control={control}
            name="sectionId"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="sectionId" className="h-10 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {refData.sections.map((s) => <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
      </div>

      <Field label="Item" htmlFor="title" error={err("title")}>
        <Input id="title" className="h-10" placeholder="e.g. Oil, Wapda bill, Maid" aria-invalid={!!err("title")} {...register("title", { required: "Give the expense a name" })} />
      </Field>

      <div className="space-y-2">
        <span className="text-sm font-medium">How is it priced?</span>
        <Controller
          control={control}
          name="pricing"
          render={({ field }) => (
            <ToggleGroup type="single" variant="outline" value={field.value} onValueChange={(x) => x && field.onChange(x)} className="w-full">
              <ToggleGroupItem value="amount" className="flex-1">Fixed amount</ToggleGroupItem>
              <ToggleGroupItem value="rate" className="flex-1">Kg × rate</ToggleGroupItem>
              <ToggleGroupItem value="pending" className="flex-1">Bill not issued</ToggleGroupItem>
            </ToggleGroup>
          )}
        />
      </div>

      {v.pricing === "amount" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount (Rs)" htmlFor="amount" error={err("amount")}>
            <Input id="amount" inputMode="decimal" className="num h-10" placeholder="0" {...register("amount")} />
          </Field>
          <Field label="Quantity (optional)" htmlFor="qtyText" hint="As written, e.g. 2 Box or 0.25 Kg">
            <Input id="qtyText" className="h-10" {...register("qtyText")} />
          </Field>
        </div>
      ) : v.pricing === "rate" ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Quantity (kg / L)" htmlFor="qty" error={err("qty")}>
            <Input id="qty" inputMode="decimal" className="num h-10" {...register("qty")} />
          </Field>
          <Field label="Rate per kg / L" htmlFor="rate" error={err("rate")}>
            <Input id="rate" inputMode="decimal" className="num h-10" {...register("rate")} />
          </Field>
          <Field label="Amount">
            <p className="num flex h-10 items-center rounded-md border bg-muted px-3 text-sm">
              {preview.ok && preview.amountPaisa !== null ? formatPaisa(preview.amountPaisa, { decimals: true }) : "—"}
            </p>
          </Field>
        </div>
      ) : (
        <p className="rounded-lg bg-muted px-3 py-2.5 text-sm text-muted-foreground">
          The expense is listed now and counts toward shares once you enter the amount.
        </p>
      )}

      <fieldset className="space-y-3 rounded-xl border p-4">
        <legend className="px-1 text-sm font-medium">Who shares it</legend>
        <Controller
          control={control}
          name="splitMode"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger className="h-10 w-full" aria-label="Split method"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="rule">Use a family rule</SelectItem>
                <SelectItem value="equal_units">Equally between chosen households</SelectItem>
                <SelectItem value="percentage">By percentage</SelectItem>
                <SelectItem value="custom_amounts">Custom amount per household</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
        {v.splitMode === "rule" ? (
          <Controller
            control={control}
            name="ruleId"
            render={({ field }) => (
              <div role="radiogroup" aria-label="Family rule" className="grid gap-2 sm:grid-cols-2">
                {refData.rules.filter((r) => r.active || r.id === field.value).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    role="radio"
                    aria-checked={field.value === r.id}
                    onClick={() => field.onChange(r.id)}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      field.value === r.id ? "border-haldi bg-accent" : "hover:bg-muted",
                    )}
                  >
                    <span className="block font-medium">{r.name}</span>
                    <span className="block text-xs text-muted-foreground">{r.description}</span>
                  </button>
                ))}
              </div>
            )}
          />
        ) : v.splitMode === "equal_units" ? (
          <div className="flex flex-wrap gap-3">
            {refData.units.map((u) => (
              <label key={u.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <Checkbox
                  checked={v.equalUnits?.includes(u.id)}
                  onCheckedChange={(c) => setValue("equalUnits", c ? [...(v.equalUnits ?? []), u.id] : (v.equalUnits ?? []).filter((x) => x !== u.id))}
                />
                {u.code}
              </label>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {refData.units.map((u) => (
              <Field key={u.id} label={u.code} htmlFor={`part-${u.id}`}>
                <Input
                  id={`part-${u.id}`}
                  inputMode="decimal"
                  className="num h-10"
                  placeholder={v.splitMode === "percentage" ? "%" : "Rs"}
                  {...register(v.splitMode === "percentage" ? `percents.${u.id}` : `customAmounts.${u.id}`)}
                />
              </Field>
            ))}
          </div>
        )}

        <div aria-live="polite" className="rounded-lg bg-muted/60 px-3 py-2.5 text-sm">
          {!preview.ok ? (
            <span className="text-destructive">{preview.error}</span>
          ) : preview.amountPaisa === null ? (
            <span className="text-muted-foreground">Shares appear when the amount is known.</span>
          ) : preview.shares.length === 0 ? (
            <span className="text-muted-foreground">Personal item, nobody is charged.</span>
          ) : (
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {preview.shares.map((s) => (
                <span key={s.unitId}>
                  <span className="font-semibold">{refData.units.find((u) => u.id === s.unitId)?.code}</span>{" "}
                  <span className="num">{formatPaisa(s.sharePaisa, { decimals: s.sharePaisa % 100n !== 0n })}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Paid by" htmlFor="paidByUnitId" hint="If not the purse-holder, a payment from that household is sent to Payments for you to approve.">
          <Controller
            control={control}
            name="paidByUnitId"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="paidByUnitId" className="h-10 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {refData.units.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.code}{u.is_purse_holder ? " (purse-holder)" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
        <Field label="Date (optional)" htmlFor="expenseDate">
          <Input id="expenseDate" type="date" className="h-10" {...register("expenseDate")} />
        </Field>
      </div>

      <Field label="Notes" htmlFor="notes" hint="Shown in the Notes / Category column of the workbook">
        <Textarea id="notes" rows={2} {...register("notes")} />
      </Field>

      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t bg-background px-4 pt-4 pb-1">
        <Button type="button" variant="outline" className="h-11 flex-1" onClick={onDone} disabled={pending}>Cancel</Button>
        <Button type="submit" className="h-11 flex-[2]" disabled={pending || !preview.ok}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          {initial?.id ? "Save changes" : "Add expense"}
        </Button>
      </div>
    </form>
  );
}
