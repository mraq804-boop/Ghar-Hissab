import { describe, expect, it } from "vitest";
import { compareWithScreenshot, parsePaymentText } from "@/lib/ocr/parse-payment";

const JAZZCASH = `JazzCash
Transaction Successful
Rs. 5,000.00
Sent to
Abdul Qadeer
03XX XXXXXXX
TID: 012345678901
20 Oct 2026, 10:15 AM
Fee Rs. 0.00`;

const EASYPAISA = `easypaisa
Successfully sent
Rs 8,730
To Abdul Qadeer
Transaction ID 31234567890
Date & Time 20/10/2026 09:41 PM
Fee Rs 0
Available Balance Rs 120,450.00`;

const MEEZAN = `Funds Transfer Successful
From Account ****1234
To Account ****5678
Amount PKR 27,900.00
Transaction Reference No. 600012345678
Date 19-Oct-2026`;

const HBL = `HBL Mobile
Transaction Date: 18/10/2026 14:02
Amount: PKR 19,000.00
Charges: PKR 0.00
STAN: 123456
Reference: FT26293ABCD`;

const RAAST = `Raast Payment
PKR 2,200
Raast ID 03001234567
Transaction ID: RST20261020ABC123
Oct 20, 2026`;

describe("parsePaymentText", () => {
  it("reads a JazzCash receipt", () => {
    expect(parsePaymentText(JAZZCASH)).toEqual({ amount: "5000.00", paidOn: "2026-10-20", reference: "012345678901", method: "jazzcash" });
  });

  it("reads an Easypaisa receipt and ignores the fee and balance", () => {
    expect(parsePaymentText(EASYPAISA)).toEqual({ amount: "8730.00", paidOn: "2026-10-20", reference: "31234567890", method: "easypaisa" });
  });

  it("reads a bank funds transfer", () => {
    expect(parsePaymentText(MEEZAN)).toEqual({ amount: "27900.00", paidOn: "2026-10-19", reference: "600012345678", method: "bank_transfer" });
  });

  it("prefers the reference over the STAN and skips charges", () => {
    expect(parsePaymentText(HBL)).toEqual({ amount: "19000.00", paidOn: "2026-10-18", reference: "FT26293ABCD", method: "bank_transfer" });
  });

  it("reads a Raast transfer with a month-first date", () => {
    expect(parsePaymentText(RAAST)).toEqual({ amount: "2200.00", paidOn: "2026-10-20", reference: "RST20261020ABC123", method: "raast" });
  });

  it("copes with OCR spacing noise", () => {
    expect(parsePaymentText("Amount Rs.5,000\nTrx ID : 98765 4321\n20.10.2026").amount).toBe("5000.00");
    expect(parsePaymentText("Amount Rs.5,000\nTrx ID : 987654321\n20.10.2026").reference).toBe("987654321");
  });

  it("returns nulls rather than guessing", () => {
    expect(parsePaymentText("Thank you for using our app")).toEqual({ amount: null, paidOn: null, reference: null, method: null });
    expect(parsePaymentText("Date 31/02/2026").paidOn).toBeNull();
    expect(parsePaymentText("Transaction Successful").reference).toBeNull();
  });
});

describe("compareWithScreenshot", () => {
  const read = { amount: "5000.00", paidOn: "2026-10-20", reference: "012345678901", method: "jazzcash" as const };

  it("passes when everything matches", () => {
    const r = compareWithScreenshot(read, { amount: "5000", paidOn: "2026-10-20", reference: "0123 4567 8901" });
    expect(r.every((c) => c.status === "match")).toBe(true);
  });

  it("flags a different amount, date and reference", () => {
    const r = compareWithScreenshot(read, { amount: "50000", paidOn: "2026-10-13", reference: "999" });
    expect(r.map((c) => [c.field, c.status])).toEqual([["amount", "mismatch"], ["date", "mismatch"], ["reference", "mismatch"]]);
    expect(r[0].message).toBe("Screenshot shows Rs 5,000 but Rs 50,000 was entered");
  });

  it("says when something could not be read", () => {
    const r = compareWithScreenshot({ amount: null, paidOn: null, reference: null, method: null }, { amount: "100", paidOn: "2026-10-20", reference: null });
    expect(r.map((c) => c.status)).toEqual(["unread", "unread", "unread"]);
  });
});
