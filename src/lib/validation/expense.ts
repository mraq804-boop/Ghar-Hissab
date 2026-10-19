import { z } from "zod";

export const moneyString = z
  .string()
  .trim()
  .transform((s) => s.replace(/,/g, ""))
  .pipe(z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "Enter an amount in rupees, e.g. 2500 or 2500.50"));

export const quantityString = z
  .string()
  .trim()
  .regex(/^\d{1,6}(\.\d{1,3})?$/, "Enter a quantity such as 21 or 0.25");

export const splitInputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("rule"), ruleId: z.uuid("Choose how this expense is shared") }),
  z.object({ type: z.literal("equal_units"), unitIds: z.array(z.uuid()).min(1, "Pick at least one household") }),
  z.object({
    type: z.literal("percentage"),
    parts: z.array(z.object({ unitId: z.uuid(), percent: z.number().min(0).max(100) })).min(1),
  }),
  z.object({
    type: z.literal("custom_amounts"),
    parts: z.array(z.object({ unitId: z.uuid(), amount: moneyString })).min(1),
  }),
  z.object({
    type: z.literal("weights"),
    parts: z.array(z.object({ unitId: z.uuid(), num: z.number().int().min(0), den: z.number().int().min(1) })).min(1),
  }),
]);

export type SplitInput = z.infer<typeof splitInputSchema>;

export const expenseInputSchema = z
  .object({
    id: z.uuid().optional(),
    expectedVersion: z.number().int().positive().optional(),
    periodId: z.uuid(),
    sectionId: z.uuid("Choose a section"),
    categoryId: z.uuid().nullable(),
    title: z.string().trim().min(1, "Give the expense a name").max(120),
    description: z.string().trim().max(500).optional().default(""),
    qtyText: z.string().trim().max(40).optional().default(""),
    pricing: z.enum(["amount", "rate", "pending"]),
    qty: z.string().optional().default(""),
    rate: z.string().optional().default(""),
    amount: z.string().optional().default(""),
    expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).optional().default(""),
    paidByUnitId: z.uuid(),
    notes: z.string().trim().max(1000).optional().default(""),
    split: splitInputSchema,
  })
  .superRefine((v, ctx) => {
    if (v.pricing === "amount" && !moneyString.safeParse(v.amount).success) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: "Enter the amount in rupees" });
    }
    if (v.pricing === "rate") {
      if (!quantityString.safeParse(v.qty).success) ctx.addIssue({ code: "custom", path: ["qty"], message: "Enter the quantity in kg or litres" });
      if (!moneyString.safeParse(v.rate).success) ctx.addIssue({ code: "custom", path: ["rate"], message: "Enter the rate per kg or litre" });
    }
    if (v.pricing === "pending" && v.split.type === "custom_amounts") {
      ctx.addIssue({ code: "custom", path: ["split"], message: "Custom amounts need the bill amount first" });
    }
  });

export type ExpenseInputForm = z.input<typeof expenseInputSchema>;
export type ExpenseInputParsed = z.output<typeof expenseInputSchema>;
