import "server-only";
import { z } from "zod";

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

const DB_MESSAGES: Record<string, string> = {
  forbidden: "You don't have permission to do that.",
  conflict: "Someone else changed this while you were editing. Reload and try again.",
  period_closed: "This month is closed. Reopen it before changing its expenses.",
  screenshot_required: "Attach a screenshot of the payment.",
  invalid_attachment: "The screenshot upload could not be found. Upload it again.",
  duplicate_reference: "A payment with this transaction reference already exists.",
  already_reviewed: "This payment has already been reviewed.",
  reason_required: "Give a reason when rejecting a payment.",
  invalid_split: "The split is not valid.",
  invalid_expense: "The expense is not valid.",
  rule_in_closed_period: "This rule is used by a closed month. Create a new rule instead.",
};

export function dbError(err: { message?: string; hint?: string | null; code?: string } | null | undefined): ActionResult<never> {
  const key = err?.message?.trim() ?? "";
  if (err?.hint && DB_MESSAGES[key]) return { ok: false, error: err.hint };
  if (DB_MESSAGES[key]) return { ok: false, error: DB_MESSAGES[key] };
  if (err?.code === "23505") return { ok: false, error: "That record already exists." };
  console.error("Database error", { code: err?.code, message: err?.message });
  return { ok: false, error: "Something went wrong while saving. Try again." };
}

export function invalid(error: z.ZodError): ActionResult<never> {
  const flat = z.flattenError(error);
  const first = error.issues[0];
  return {
    ok: false,
    error: first ? first.message : "Check the highlighted fields.",
    fieldErrors: flat.fieldErrors as Record<string, string[]>,
  };
}

export const forbidden: ActionResult<never> = { ok: false, error: DB_MESSAGES.forbidden };
