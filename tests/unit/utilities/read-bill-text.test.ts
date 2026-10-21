import { describe, expect, it } from "vitest";
import { readBillText } from "@/lib/utilities/read-bill-text";

describe("readBillText", () => {
  it("reads an SNGPL-style bill", () => {
    const text = `SUI NORTHERN GAS PIPELINES LIMITED
CONSUMER # 12345678901
BILLING MONTH OCT-26
ISSUE DATE 08-OCT-2026
DUE DATE 21-OCT-2026
AMOUNT PAYABLE WITHIN DUE DATE 8,730
AMOUNT PAYABLE AFTER DUE DATE 9,163`;
    expect(readBillText(text)).toEqual({ billMonth: "2026-10", dueDate: "2026-10-21", payable: 8730, afterDue: 9163 });
  });

  it("finds values on the next line and numeric dates", () => {
    const text = `Bill Month\nNovember 2026\nDue Date\n24/11/2026\nPayable Within Due Date\nRs. 2,450\nPayable After Due Date\nRs. 2,573`;
    expect(readBillText(text)).toEqual({ billMonth: "2026-11", dueDate: "2026-11-24", payable: 2450, afterDue: 2573 });
  });

  it("uses the due date's month when no billing month is printed, and leaves unknowns empty", () => {
    expect(readBillText("DUE DATE 05 DEC 26\nNET PAYABLE 1,200")).toEqual({ billMonth: "2026-12", dueDate: "2026-12-05", payable: 1200, afterDue: null });
    expect(readBillText("blurry picture")).toEqual({ billMonth: null, dueDate: null, payable: null, afterDue: null });
  });
});
