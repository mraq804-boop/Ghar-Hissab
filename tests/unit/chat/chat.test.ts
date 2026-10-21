import { afterEach, describe, expect, it, vi } from "vitest";
import { buildChatContext, type ChatMonth } from "@/lib/chat/context";

vi.mock("server-only", () => ({}));
const { askGemini, ChatError } = await import("@/server/chat/gemini");

const rs = (n: number) => BigInt(n) * 100n;

const october: ChatMonth = {
  label: "October 2026",
  status: "open",
  sharedPaisa: rs(91715),
  personalPaisa: rs(4960),
  units: [
    { code: "AQ", sharePaisa: rs(27336), paidPaisa: rs(27900), balancePaisa: rs(564), status: "gets_back" },
    { code: "AK", sharePaisa: rs(32623), paidPaisa: rs(19000), balancePaisa: rs(-13623), status: "to_pay" },
  ],
  expenses: [
    { title: "Chicken", section: "Milk, sabzi, chicken & meat", category: "Chicken & meat", amountPaisa: rs(10500), qty: "21", ratePaisa: rs(500), split: "Three-way pool", paidBy: "AQ", date: null },
    { title: "Water", section: "Bills", category: "Water", amountPaisa: null, qty: null, ratePaisa: null, split: "Three-way pool", paidBy: "AQ", date: null },
  ],
  payments: [
    { payer: "AQ", amountPaisa: rs(27900), paidOn: "2026-10-31", method: "Other", status: "approved" },
    { payer: "AK", amountPaisa: rs(19000), paidOn: "2026-10-31", method: "JazzCash", status: "approved" },
  ],
};

const base = {
  today: "2026-10-20",
  households: [{ code: "AQ", isPurseHolder: true }, { code: "AK", isPurseHolder: false }],
  rules: ["Three-way pool = Equal: AQ + AK + AB"],
  months: [october],
};

describe("buildChatContext", () => {
  it("includes totals, balances, expenses and payments for an administrator", () => {
    const text = buildChatContext({ ...base, scope: { seeExpenses: true, seeAllBalances: true, ownUnit: "AQ" } });
    expect(text).toContain("AQ (holds the family purse; others pay AQ)");
    expect(text).toContain("AK: share Rs 32,623, paid Rs 19,000, balance −Rs 13,623 (still to pay).");
    expect(text).toContain("Still to pay: AK Rs 13,623.");
    expect(text).toContain("Gets money back: AQ Rs 564.");
    expect(text).toContain("Chicken | Milk, sabzi, chicken & meat | Chicken & meat | Rs 10,500 | 21 × Rs 500 | Three-way pool | AQ | -");
    expect(text).toContain("Bills not issued yet (no amount): Water.");
    expect(text).toContain("Totals by category, largest first: Chicken & meat Rs 10,500.");
  });

  it("lists expenses largest first so the biggest is easy to find", () => {
    const month: ChatMonth = {
      ...october,
      expenses: [
        { ...october.expenses[0], title: "Oil", category: "Groceries", amountPaisa: rs(9000), ratePaisa: null, qty: null },
        { ...october.expenses[0], title: "Milk", category: "Milk", amountPaisa: rs(12000), ratePaisa: null, qty: null },
        { ...october.expenses[0], title: "Tea", category: "Groceries", amountPaisa: rs(1000), ratePaisa: null, qty: null },
      ],
    };
    const text = buildChatContext({ ...base, months: [month], scope: { seeExpenses: true, seeAllBalances: true, ownUnit: "AQ" } });
    const order = ["Milk |", "Oil |", "Tea |"].map((t) => text.indexOf(t));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(text).toContain("Totals by category, largest first: Milk Rs 12,000; Groceries Rs 10,000.");
    expect(text).toContain("Biggest single expense items: 1. Milk Rs 12,000; 2. Oil Rs 9,000; 3. Tea Rs 1,000.");
    expect(text).toContain("AK | Rs 19,000 | 2026-10-31 | JazzCash | approved");
  });

  it("leaves out other households and expense lines when a member may not see them", () => {
    const text = buildChatContext({ ...base, scope: { seeExpenses: false, seeAllBalances: false, ownUnit: "AK" } });
    expect(text).toContain("AK: share");
    expect(text).not.toContain("AQ: share");
    expect(text).not.toContain("AQ | Rs 27,900");
    expect(text).not.toContain("Chicken |");
    expect(text).toContain("only the asker's household is included");
  });
});

describe("askGemini", () => {
  afterEach(() => vi.unstubAllEnvs());

  const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it("sends the key in a header, maps roles and returns the text", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const fetchImpl = reply(200, { candidates: [{ content: { parts: [{ text: "AK still has to pay " }, { text: "Rs 13,623." }] } }] });
    const answer = await askGemini("SYSTEM", [{ role: "user", text: "q1" }, { role: "assistant", text: "a1" }, { role: "user", text: "q2" }], fetchImpl);
    expect(answer).toBe("AK still has to pay Rs 13,623.");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
    expect(url).not.toContain("test-key");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
    const body = JSON.parse(init.body as string);
    expect(body.systemInstruction.parts[0].text).toBe("SYSTEM");
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(["user", "model", "user"]);
  });

  it("explains the free limit, a bad key and a missing key in plain words", async () => {
    await expect(askGemini("S", [{ role: "user", text: "q" }], reply(200, {}))).rejects.toThrow(/isn't set up/);
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    await expect(askGemini("S", [{ role: "user", text: "q" }], reply(429, {}))).rejects.toThrow(/free Gemini limit/);
    await expect(askGemini("S", [{ role: "user", text: "q" }], reply(400, { error: { message: "API key not valid" } }))).rejects.toThrow(/key isn't valid/);
    await expect(askGemini("S", [{ role: "user", text: "q" }], reply(200, { promptFeedback: { blockReason: "SAFETY" } }))).rejects.toBeInstanceOf(ChatError);
  });
});

describe("utility bills in the chat data", () => {
  it("lists each bill with its due date and late amounts, without reference numbers", () => {
    const text = buildChatContext({
      ...base,
      bills: [{ connection: "AQ 1", company: "LESCO", utility: "Electricity", month: "October 2026", payablePaisa: rs(1524), dueDate: "2026-10-22", latePayments: [{ until: "2026-10-26", amountPaisa: rs(1580) }, { until: null, amountPaisa: rs(1636) }], units: 63, inExpenses: false }],
      scope: { seeExpenses: true, seeAllBalances: true, ownUnit: "AQ" },
    });
    expect(text).toContain("AQ 1 | LESCO | Electricity | October 2026 | Rs 1,524 | 2026-10-22 | Rs 1,580 until 2026-10-26, Rs 1,636 after that | 63 | no");
  });
});
