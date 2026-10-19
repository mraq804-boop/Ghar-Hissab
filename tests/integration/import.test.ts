import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { as, createDb, expectDbError } from "./db";
import { parseWorkbook } from "@/lib/import/parse-workbook";
import { buildImportPayload } from "@/lib/import/payload";
import { computeSettlement, parseRupeesToPaisa, ruleToSpec, type RuleRow } from "@/lib/finance";

const WORKBOOK = process.env.WORKBOOK_PATH ?? "C:/Users/AbdulQadeer-ISKAAN/Desktop/Grocery_Shopping_List.xlsx";
const CONFIG = {
  householdName: "Test home",
  members: [
    { unit: "AQ" as const, fullName: "Admin AQ", email: "aq@example.test", admin: true, dutyLabel: "P1" },
    { unit: "AK" as const, fullName: "Cook AK", dutyLabel: "P2" },
    { unit: "AB" as const, fullName: "Cook AB", dutyLabel: "P3" },
  ],
};

describe.skipIf(!existsSync(WORKBOOK))("importing the real workbook", () => {
  it("imports atomically, reproduces the October settlement and refuses a second import", async () => {
    const db = await createDb();
    const admin = "00000000-0000-0000-0000-0000000000a1";
    await db.query(`insert into auth.users (id, email) values ($1, 'aq@example.test')`, [admin]);
    const bytes = readFileSync(WORKBOOK);
    const payload = buildImportPayload(await parseWorkbook(bytes, 2026), CONFIG, bytes);

    const [{ h }] = await as(db, "service", async (tx) => (await tx.query<{ h: string }>(`select public.import_workbook($1) as h`, [JSON.stringify(payload)])).rows);

    const role = await db.query(`select role from public.household_roles where household_id = $1 and user_id = $2`, [h, admin]);
    expect(role.rows).toEqual([{ role: "admin" }]);

    const units = (await db.query<{ id: string; code: string; sort_order: number }>(`select id, code, sort_order from public.units where household_id = $1`, [h])).rows;
    const rules = (await db.query<RuleRow>(`select r.id, r.type, coalesce(json_agg(json_build_object('unit_id', p.unit_id, 'num', p.num, 'den', p.den, 'percent', p.percent)) filter (where p.unit_id is not null), '[]') as parts from public.split_rules r left join public.split_rule_parts p on p.rule_id = r.id where r.household_id = $1 group by r.id`, [h])).rows;
    const expenses = (await db.query<{ amount: string | null; split_rule_id: string }>(`select amount::text, split_rule_id from public.expenses where household_id = $1`, [h])).rows;
    const payments = (await db.query<{ payer_unit_id: string; amount: string }>(`select payer_unit_id, amount::text from public.payments where household_id = $1 and status = 'approved'`, [h])).rows;

    const s = computeSettlement({
      units: units.map((u) => ({ id: u.id, code: u.code, sortOrder: u.sort_order })),
      expenses: expenses.map((e, i) => ({ id: String(i), amountPaisa: e.amount === null ? null : parseRupeesToPaisa(e.amount), split: ruleToSpec(rules.find((r) => r.id === e.split_rule_id)!) })),
      payments: payments.map((p) => ({ unitId: p.payer_unit_id, amountPaisa: parseRupeesToPaisa(p.amount) })),
    });
    expect(s.grandTotal).toBe(8_736_000n);
    expect(s.splitTotal).toBe(8_240_000n);
    expect(s.units.map((u) => [u.code, u.sharePaisa, u.paidPaisa])).toEqual([
      ["AQ", 2_775_600n, 2_790_000n],
      ["AK", 2_775_500n, 1_900_000n],
      ["AB", 2_688_900n, 0n],
    ]);

    const duties = await db.query(`select count(*)::int as n from public.duty_days where household_id = $1`, [h]);
    expect(duties.rows[0]).toEqual({ n: 30 });
    const jobs = await db.query(`select count(*)::int as n from public.sync_jobs where household_id = $1 and status = 'pending'`, [h]);
    expect((jobs.rows[0] as { n: number }).n).toBeGreaterThanOrEqual(3);

    await expectDbError(as(db, "service", (tx) => tx.query(`select public.import_workbook($1)`, [JSON.stringify(payload)])), /already_imported/);
    const count = await db.query(`select count(*)::int as n from public.households`);
    expect(count.rows[0]).toEqual({ n: 1 });
  }, 60_000);
});
