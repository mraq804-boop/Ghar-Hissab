import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { categorize, parseWorkbook } from "@/lib/import/parse-workbook";
import { reconcile, settlementFromParsed } from "@/lib/import/reconcile";

const WORKBOOK = process.env.WORKBOOK_PATH ?? "C:/Users/AbdulQadeer-ISKAAN/Desktop/Grocery_Shopping_List.xlsx";

describe("categorize", () => {
  it("maps the workbook's special rows to their rules", () => {
    expect(categorize("SHARED", "Sarf", "Shared - AB 1/9")).toEqual({ category: "detergent", rule: "SARF" });
    expect(categorize("BILLS", "Wapda (electricity)", "Split AK + AB")).toEqual({ category: "electricity", rule: "WAPDA" });
    expect(categorize("BILLS", "Gas", "Split AQ + AK + AB").rule).toBe("POOL3");
    expect(categorize("BILLS", "Internet", "Split AQ + AK + AB").rule).toBe("POOL3");
    expect(categorize("NOT_SHARED", "Capri", null)).toEqual({ category: "personal", rule: "NONE" });
    expect(categorize("MILK_MEAT", "Mutton", null).category).toBe("meat");
  });
});

describe.skipIf(!existsSync(WORKBOOK))("the real workbook", () => {
  it("parses every row and reconciles with the sheet's own totals", async () => {
    const parsed = await parseWorkbook(readFileSync(WORKBOOK), 2026);
    expect(parsed.month).toBe(10);
    expect(parsed.year).toBe(2026);
    expect(parsed.expenses).toHaveLength(36);
    expect(parsed.expenses.filter((e) => e.amount === null).map((e) => e.title)).toEqual(["Wapda (electricity)", "Gas", "Water"]);
    expect(parsed.expenses.find((e) => e.title === "Chicken")).toMatchObject({ qtyNum: 21, rate: 500, amount: 10500 });
    expect(parsed.paid).toEqual({ AQ: 27900, AK: 19000, AB: 0 });
    expect(parsed.menu).toHaveLength(28);
    expect(parsed.sabzi.length).toBeGreaterThan(10);
    expect(parsed.duties).toHaveLength(30);
    expect(parsed.duties[0]).toMatchObject({ day: "2026-10-01", breakfast: "P1", lunch: "P2", dinner: "P1", off: "P3", offNote: "on holiday" });

    const lines = reconcile(parsed);
    expect(lines.length).toBeGreaterThanOrEqual(12);
    for (const l of lines) expect(l, l.label).toMatchObject({ ok: true });

    const s = settlementFromParsed(parsed);
    expect(s.units.map((u) => u.sharePaisa)).toEqual([2_775_600n, 2_775_500n, 2_688_900n]);
  });
});
