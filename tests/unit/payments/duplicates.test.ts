import { describe, expect, it } from "vitest";
import { duplicateWarnings, type PaymentLike } from "@/lib/payments/duplicates";

const p = (over: Partial<PaymentLike> & { id: string }): PaymentLike => ({
  payerCode: "AK",
  amount: "5000",
  paidOn: "2026-10-20",
  reference: null,
  status: "pending",
  shas: [],
  ...over,
});

describe("duplicateWarnings", () => {
  it("flags a transaction ID used twice, even with different formatting", () => {
    const w = duplicateWarnings([p({ id: "a", reference: "0123 4567 8901" }), p({ id: "b", payerCode: "AB", amount: "300", reference: "012345678901", paidOn: "2026-10-12" })]);
    expect(w.get("a")).toEqual(["Transaction ID 0123 4567 8901 is also on AB's payment of Rs 300 on 12 Oct"]);
    expect(w.get("b")?.[0]).toContain("is also on AK's payment of Rs 5,000");
  });

  it("flags the same household, amount and day as a possible double entry", () => {
    const w = duplicateWarnings([p({ id: "a" }), p({ id: "b" })]);
    expect(w.get("a")?.[0]).toContain("may have been entered twice");
  });

  it("flags a reused screenshot", () => {
    const w = duplicateWarnings([p({ id: "a", shas: ["x"] }), p({ id: "b", amount: "10", shas: ["x"] })]);
    expect(w.get("a")).toContain("This exact screenshot is attached to another payment. Check it isn't being counted twice.");
  });

  it("ignores rejected payments and unrelated ones", () => {
    const w = duplicateWarnings([p({ id: "a", reference: "TX123456" }), p({ id: "b", reference: "TX123456", status: "rejected" }), p({ id: "c", payerCode: "AB" })]);
    expect(w.size).toBe(0);
  });
});
