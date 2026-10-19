import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/supabase/admin", () => ({ createSupabaseAdmin: () => null }));

import { computeSettlement } from "@/lib/finance";
import type { SectionKey } from "@/lib/household-defaults";
import { SheetsClient, SheetsError, spreadsheetIdFromUrl } from "@/server/excel/google";
import { renderPeriodSheet, SHEET_TITLE, type LayoutExpense } from "@/server/excel/layout";
import { assertManagedSheet, ensureSheet, LayoutDriftError, readUsed, typedValue, verifyChecks, writeLayout } from "@/server/excel/sheets-writer";
import { classify } from "@/server/excel/worker";
import { FakeSheets } from "../../helpers/fake-sheets";
import { OCTOBER_EXPENSES, OCTOBER_PAYMENTS, POOL3, UNITS } from "../../fixtures/october-2026";

const SS = "spreadsheet-id-0000000000000";

function layoutFor(expenses = OCTOBER_EXPENSES) {
  const settlement = computeSettlement({ units: UNITS, expenses, payments: OCTOBER_PAYMENTS });
  const rows: LayoutExpense[] = expenses.map((e) => ({
    id: e.id,
    sectionKey: e.section as SectionKey,
    title: e.title,
    notes: null,
    qtyText: null,
    qtyNum: null,
    rate: null,
    amountPaisa: e.amountPaisa,
    spec: e.split,
    ruleKey: e.split.type === "none" ? "NONE" : e.split.type === "weights" ? "SARF" : e.split.type === "equal_units" && e.split.unitIds.length === 2 ? "WAPDA" : "POOL3",
    ruleLabel: "Rule",
    ruleDescription: "",
  }));
  return renderPeriodSheet({
    sheetName: "Grocery List",
    month: 10,
    units: UNITS,
    expenses: rows,
    paidByUnit: new Map(OCTOBER_PAYMENTS.map((p) => [p.unitId, p.amountPaisa])),
    settlement,
    poolOrder: ["POOL3", "WAPDA", "SARF"],
  });
}

const rowOf = (layout: ReturnType<typeof layoutFor>, key: string) => layout.rows.find((r) => r.cells[7] === key)!.r;

function client(fake: FakeSheets, waits: number[] = [], maxRetries = 4) {
  return new SheetsClient({ accessToken: "t", fetchImpl: fake.fetch, sleepImpl: async (ms) => void waits.push(ms), maxRetries });
}

async function sync(fake: FakeSheets, layout = layoutFor()) {
  const c = client(fake);
  const sheet = await ensureSheet(c, SS, "Grocery List");
  const ref = { spreadsheetId: SS, sheet };
  if (fake.tab("Grocery List").cells.size) await assertManagedSheet(c, ref, "money");
  await writeLayout(c, ref, layout, await readUsed(c, ref));
  await verifyChecks(c, ref, layout.checks);
  return c;
}

describe("writing the month to a Google Sheet", () => {
  it("reproduces the workbook totals in one atomic batch update", async () => {
    const fake = new FakeSheets();
    fake.addTab("Grocery List");
    await sync(fake);
    const t = fake.tab("Grocery List");
    expect(t.evaluate("B2")).toBe(SHEET_TITLE);
    expect(t.evaluate("G56")).toBe(87360);
    expect(t.evaluate("G59")).toBe(79800);
    expect(t.evaluate("G65")).toBeCloseTo(82400, 6);
    expect([t.evaluate("E69"), t.evaluate("E70"), t.evaluate("E71")]).toEqual([27756, 27755, 26889]);
    expect(t.merges).toContain("B2:G2");
    expect([...t.hiddenCols].sort()).toEqual([7, 8, 9]);
    expect(fake.batchCalls).toBe(1);
  });

  it("is idempotent: a second sync leaves identical cells and no duplicate rows", async () => {
    const fake = new FakeSheets();
    fake.addTab("Grocery List");
    await sync(fake);
    const first = new Map(fake.tab("Grocery List").cells);
    await sync(fake);
    expect(new Map(fake.tab("Grocery List").cells)).toEqual(first);
    const ids = [...first].filter(([k, v]) => k.startsWith("I") && typeof v === "string" && /^e\d+$/.test(v));
    expect(ids).toHaveLength(OCTOBER_EXPENSES.length);
  });

  it("removes deleted rows and clears leftovers below the new end", async () => {
    const fake = new FakeSheets();
    fake.addTab("Grocery List");
    await sync(fake);
    const layout = layoutFor(OCTOBER_EXPENSES.filter((e) => e.title !== "Oil" && e.title !== "Pamper"));
    await sync(fake, layout);
    const t = fake.tab("Grocery List");
    expect(t.evaluate(`G${rowOf(layout, "grand")}`)).toBe(87360 - 9000 - 2350);
    expect(Math.max(...[...t.cells.keys()].map((k) => Number(/\d+$/.exec(k)![0])))).toBe(layout.lastRow);
  });

  it("adds a new expense to its section and the split", async () => {
    const fake = new FakeSheets();
    fake.addTab("Grocery List");
    await sync(fake);
    const layout = layoutFor([...OCTOBER_EXPENSES, { id: "new1", section: "SHARED", title: "Atta", amountPaisa: 300_000n, split: POOL3 }]);
    await sync(fake, layout);
    const t = fake.tab("Grocery List");
    expect(t.evaluate(`G${rowOf(layout, "pool:POOL3")}`)).toBe(79800 + 3000);
    expect(t.evaluate(`G${rowOf(layout, "total:SHARED")}`)).toBe(23700 + 3000);
  });

  it("creates a missing tab for a new month", async () => {
    const fake = new FakeSheets();
    const c = client(fake);
    const sheet = await ensureSheet(c, SS, "Grocery List - Nov 2026");
    expect(sheet.created).toBe(true);
    expect(fake.tabs.map((t) => t.title)).toEqual(["Grocery List - Nov 2026"]);
  });

  it("refuses to overwrite a tab it does not recognise", async () => {
    const fake = new FakeSheets();
    const t = fake.addTab("Grocery List");
    t.cells.set("B2", "My private budget");
    const c = client(fake);
    const sheet = await ensureSheet(c, SS, "Grocery List");
    await expect(assertManagedSheet(c, { spreadsheetId: SS, sheet }, "money")).rejects.toBeInstanceOf(LayoutDriftError);
    expect(t.cells.get("B2")).toBe("My private budget");
  });

  it("fails verification when the sheet disagrees with the app", async () => {
    const fake = new FakeSheets();
    fake.addTab("Grocery List");
    const layout = layoutFor();
    const c = await sync(fake, layout);
    fake.tab("Grocery List").cells.set("G6", 999999);
    const sheet = await ensureSheet(c, SS, "Grocery List");
    await expect(verifyChecks(c, { spreadsheetId: SS, sheet }, layout.checks)).rejects.toThrow(/Read-back check failed/);
  });

  it("writes user text as plain strings, never formulas", () => {
    expect(typedValue("'=HYPERLINK(\"http://x\")")).toEqual({ userEnteredValue: { stringValue: '=HYPERLINK("http://x")' } });
    expect(typedValue("=SUM(G6:G26)")).toEqual({ userEnteredValue: { formulaValue: "=SUM(G6:G26)" } });
    expect(typedValue(12)).toEqual({ userEnteredValue: { numberValue: 12 } });
    expect(typedValue(null)).toEqual({});
  });
});

describe("Google client resilience", () => {
  it("retries 429 using Retry-After and 503 with backoff", async () => {
    const fake = new FakeSheets();
    fake.addTab("Grocery List");
    fake.faults = [
      { status: 429, retryAfter: "2", match: /values:batchGet/, times: 1 },
      { status: 503, match: /batchUpdate/, times: 2 },
    ];
    const waits: number[] = [];
    const c = client(fake, waits);
    const sheet = await ensureSheet(c, SS, "Grocery List");
    const ref = { spreadsheetId: SS, sheet };
    await writeLayout(c, ref, layoutFor(), await readUsed(c, ref));
    expect(waits[0]).toBe(2000);
    expect(waits).toHaveLength(3);
    expect(fake.tab("Grocery List").evaluate("G56")).toBe(87360);
  });

  it("gives up after its retry budget with a retryable error", async () => {
    const fake = new FakeSheets();
    fake.addTab("Grocery List");
    fake.faults = [{ status: 503, times: 99 }];
    const err = await client(fake, [], 2).spreadsheet(SS).catch((e) => e);
    expect(err).toBeInstanceOf(SheetsError);
    expect(classify(err).retryable).toBe(true);
  });

  it("treats revoked access, missing sheets and permission errors as permanent", () => {
    expect(classify(new SheetsError("x", 401, "invalid_grant", null)).retryable).toBe(false);
    expect(classify(new SheetsError("x", 404, "NOT_FOUND", null)).retryable).toBe(false);
    expect(classify(new SheetsError("x", 403, "PERMISSION_DENIED", null)).retryable).toBe(false);
    expect(classify(new SheetsError("x", 403, "rateLimitExceeded", null)).retryable).toBe(true);
  });

  it("extracts the spreadsheet id from a pasted link", () => {
    expect(spreadsheetIdFromUrl("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0")).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789");
    expect(spreadsheetIdFromUrl("not a link")).toBeNull();
  });
});
