import { describe, expect, it } from "vitest";
import { buildMonthSummary } from "@/lib/smart/summary";

const rs = (n: number) => BigInt(n) * 100n;

describe("buildMonthSummary", () => {
  it("lists each household, who still has to pay and what is not final yet", () => {
    const text = buildMonthSummary({
      monthLabel: "October 2026",
      sharedPaisa: rs(82400),
      purseCode: "AQ",
      units: [
        { code: "AQ", sharePaisa: rs(27756), paidPaisa: rs(27900), balancePaisa: rs(144), status: "gets_back" },
        { code: "AK", sharePaisa: rs(27755), paidPaisa: rs(19000), balancePaisa: rs(-8755), status: "to_pay" },
        { code: "AB", sharePaisa: rs(26889), paidPaisa: 0n, balancePaisa: rs(-26889), status: "not_paid" },
      ],
      billsNotIssued: ["Water"],
      pendingPayments: 1,
      link: "https://example.test/division?m=2026-10",
    });
    expect(text).toBe(
      [
        "*Ghar Hisaab · October 2026*",
        "Shared spending: Rs 82,400",
        "",
        "*AQ*: share Rs 27,756, paid Rs 27,900, gets back Rs 144",
        "*AK*: share Rs 27,755, paid Rs 19,000, still to pay Rs 8,755",
        "*AB*: share Rs 26,889, paid Rs 0, not paid yet (Rs 26,889)",
        "",
        "💰 Please pay AQ: AK Rs 8,755, AB Rs 26,889",
        "",
        "⏳ Not entered yet: Water. Shares will change when they are added.",
        "🕓 1 payment waiting for approval, not counted yet.",
        "",
        "Details: https://example.test/division?m=2026-10",
      ].join("\n"),
    );
  });

  it("keeps it short when everyone has settled", () => {
    const text = buildMonthSummary({
      monthLabel: "November 2026",
      sharedPaisa: rs(1000),
      purseCode: "AQ",
      units: [{ code: "AK", sharePaisa: rs(500), paidPaisa: rs(500), balancePaisa: 0n, status: "settled" }],
      billsNotIssued: [],
      pendingPayments: 0,
      link: null,
    });
    expect(text).toBe("*Ghar Hisaab · November 2026*\nShared spending: Rs 1,000\n\n*AK*: share Rs 500, paid Rs 500, settled ✅");
  });
});
