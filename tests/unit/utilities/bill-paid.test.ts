import { describe, expect, it } from "vitest";
import { billPaid } from "@/lib/utilities/bill-paid";

describe("billPaid", () => {
  it("counts a bill as paid once its expense has the paid bill attached or a date", () => {
    expect(billPaid({ expense_date: null, receipt_path: "h/r.jpg", deleted_at: null })).toBe(true);
    expect(billPaid({ expense_date: "2026-11-05", receipt_path: null, deleted_at: null })).toBe(true);
  });

  it("is not paid with no expense, a deleted one, or neither a receipt nor a date", () => {
    expect(billPaid(null)).toBe(false);
    expect(billPaid({ expense_date: null, receipt_path: null, deleted_at: null })).toBe(false);
    expect(billPaid({ expense_date: "2026-11-05", receipt_path: "h/r.jpg", deleted_at: "2026-11-05T10:00:00Z" })).toBe(false);
  });
});
