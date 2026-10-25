import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, createDb, expectDbError } from "./db";
import { bootstrapPayload } from "@/lib/household-defaults";

const ADMIN = { sub: "00000000-0000-0000-0000-0000000000a1" };
const AK_USER = { sub: "00000000-0000-0000-0000-0000000000b2" };
const AB_USER = { sub: "00000000-0000-0000-0000-0000000000c3" };
const STRANGER = { sub: "00000000-0000-0000-0000-0000000000d4" };

type Ids = {
  householdId: string;
  units: Record<string, string>;
  sections: Record<string, string>;
  rules: Record<string, string>;
  categories: Record<string, string>;
};

let db: PGlite;
let ids: Ids;
let periodId: string;

async function rpc<T = Record<string, unknown>>(actor: Parameters<typeof as>[1], sql: string, params: unknown[] = []) {
  return as(db, actor, async (tx) => (await tx.query<T>(sql, params)).rows);
}

async function addProof(user: { sub: string }, name: string) {
  const path = `${ids.householdId}/${user.sub}/${name}`;
  await rpc(user, `insert into storage.objects (bucket_id, name, owner_id) values ('payment-proofs', $1, $2)`, [path, user.sub]);
  return path;
}

function payment(over: Record<string, unknown>) {
  return {
    household_id: ids.householdId,
    period_id: periodId,
    amount: "5000",
    paid_on: "2026-10-15",
    method: "bank_transfer",
    idempotency_key: crypto.randomUUID(),
    ...over,
  };
}

beforeAll(async () => {
  db = await createDb();
  for (const [u, email] of [[ADMIN, "aq@example.test"], [AK_USER, "ak@example.test"], [AB_USER, "ab@example.test"], [STRANGER, "x@example.test"]] as const) {
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [u.sub, email]);
  }
  const [{ ids: out }] = await rpc<{ ids: Ids }>("service", `select public.bootstrap_household($1) as ids`, [
    JSON.stringify(bootstrapPayload("Test Home")),
  ]);
  ids = out;
  const h = ids.householdId;
  await db.query(
    `insert into public.members (household_id, unit_id, full_name, user_id) values
      ($1, $2, 'AQ Admin', $5), ($1, $3, 'AK Member', $6), ($1, $4, 'AB Member', $7)`,
    [h, ids.units.AQ, ids.units.AK, ids.units.AB, ADMIN.sub, AK_USER.sub, AB_USER.sub],
  );
  await db.query(
    `insert into public.household_roles (household_id, user_id, role) values ($1, $2, 'admin'), ($1, $3, 'member'), ($1, $4, 'member')`,
    [h, ADMIN.sub, AK_USER.sub, AB_USER.sub],
  );
  [{ id: periodId }] = await rpc<{ id: string }>(ADMIN, `select public.ensure_period($1, 2026, 10) as id`, [h]);
}, 60_000);

describe("migrations", () => {
  it("bootstraps units, sections, rules and categories", async () => {
    expect(Object.keys(ids.units)).toEqual(["AB", "AK", "AQ"].sort());
    const parts = await db.query(`select count(*)::int as n from public.split_rule_parts where rule_id = $1`, [ids.rules.SARF]);
    expect(parts.rows[0]).toEqual({ n: 3 });
  });

  it("only the service role can bootstrap a household", async () => {
    await expectDbError(rpc(ADMIN, `select public.bootstrap_household('{}')`), /permission denied|forbidden/);
  });
});

describe("expenses", () => {
  let expenseId: string;
  let version: number;

  it("admin creates an expense through the RPC and an audit row is written", async () => {
    const [row] = await rpc<{ id: string; version: number }>(ADMIN, `select * from public.upsert_expense($1)`, [
      JSON.stringify({
        household_id: ids.householdId,
        period_id: periodId,
        section_id: ids.sections.MILK_MEAT,
        category_id: ids.categories.meat,
        title: "Chicken",
        qty_num: "21",
        rate: "500",
        amount: "1",
        split_rule_id: ids.rules.POOL3,
      }),
    ]);
    expenseId = row.id;
    version = row.version;
    const [e] = (await db.query<{ amount: string }>(`select amount::text from public.expenses where id = $1`, [expenseId])).rows;
    expect(e.amount).toBe("10500.00");
    const audit = await db.query(`select 1 from public.audit_log where table_name = 'expenses' and record_id = $1`, [expenseId]);
    expect(audit.rows.length).toBe(1);
  });

  it("enqueues exactly one pending sync job for the period", async () => {
    const jobs = await db.query(`select status from public.sync_jobs where scope = $1 and status = 'pending'`, [`period:${periodId}`]);
    expect(jobs.rows.length).toBe(1);
  });

  it("members cannot change expenses", async () => {
    await expectDbError(
      rpc(AK_USER, `select * from public.upsert_expense($1)`, [
        JSON.stringify({ household_id: ids.householdId, period_id: periodId, section_id: ids.sections.SHARED, title: "x", amount: "1", split_rule_id: ids.rules.POOL3 }),
      ]),
      /forbidden/,
    );
    await expectDbError(
      rpc(AK_USER, `update public.expenses set amount = 1 where id = $1 returning id`, [expenseId]).then((r) => {
        if (r.length === 0) throw new Error("forbidden: no rows updated");
      }),
      /forbidden/,
    );
  });

  it("rejects stale versions", async () => {
    await expectDbError(
      rpc(ADMIN, `select * from public.upsert_expense($1)`, [
        JSON.stringify({ id: expenseId, expected_version: version + 5, household_id: ids.householdId, period_id: periodId, section_id: ids.sections.MILK_MEAT, title: "Chicken", amount: "1", split_rule_id: ids.rules.POOL3 }),
      ]),
      /conflict/,
    );
  });

  it("validates custom splits", async () => {
    await expectDbError(
      rpc(ADMIN, `select * from public.upsert_expense($1)`, [
        JSON.stringify({
          household_id: ids.householdId, period_id: periodId, section_id: ids.sections.SHARED, title: "Odd", amount: "100",
          split_override: { type: "custom_amounts", parts: [{ unitId: ids.units.AQ, amountPaisa: "5000" }] },
        }),
      ]),
      /add up/,
    );
  });

  it("an expense paid directly by another household sends a pending payment for approval that follows the expense", async () => {
    const base = { household_id: ids.householdId, period_id: periodId, section_id: ids.sections.BILLS, title: "Gas", split_rule_id: ids.rules.POOL3 };
    const linked = (id: string) =>
      db.query<{ id: string; status: string; amount: string; payer: string; version: number }>(
        `select p.id, p.status, p.amount::text, u.code as payer, p.version from public.payments p join public.units u on u.id = p.payer_unit_id where p.related_expense_id = $1`,
        [id],
      );
    const pick = (rows: { status: string; amount: string; payer: string }[]) => rows.map(({ status, amount, payer }) => ({ status, amount, payer }));

    const imported = await rpc<{ id: string; version: number }>(ADMIN, `select * from public.upsert_expense($1)`, [
      JSON.stringify({ ...base, title: "Wapda", amount: "" }),
    ]);
    const [wapda] = await rpc<{ id: string; version: number }>(ADMIN, `select * from public.upsert_expense($1)`, [
      JSON.stringify({ ...base, title: "Wapda", id: imported[0].id, expected_version: imported[0].version, amount: "10575", paid_by_unit_id: ids.units.AB }),
    ]);
    expect(pick((await linked(wapda.id)).rows)).toEqual([{ status: "pending", amount: "10575.00", payer: "AB" }]);

    const [row] = await rpc<{ id: string; version: number }>(ADMIN, `select * from public.upsert_expense($1)`, [
      JSON.stringify({ ...base, amount: "8730", paid_by_unit_id: ids.units.AB }),
    ]);
    const [created] = (await linked(row.id)).rows;
    expect(pick([created])).toEqual([{ status: "pending", amount: "8730.00", payer: "AB" }]);

    await rpc(ADMIN, `select * from public.review_payment($1, 'approved', $2)`, [created.id, created.version]);
    const [sameAgain] = await rpc<{ id: string; version: number }>(ADMIN, `select * from public.upsert_expense($1)`, [
      JSON.stringify({ ...base, id: row.id, expected_version: row.version, amount: "8730", paid_by_unit_id: ids.units.AB, notes: "receipt filed" }),
    ]);
    expect(pick((await linked(row.id)).rows)).toEqual([{ status: "approved", amount: "8730.00", payer: "AB" }]);

    const [v2] = await rpc<{ id: string; version: number }>(ADMIN, `select * from public.upsert_expense($1)`, [
      JSON.stringify({ ...base, id: row.id, expected_version: sameAgain.version, amount: "9000", paid_by_unit_id: ids.units.AK }),
    ]);
    expect(pick((await linked(row.id)).rows)).toEqual([{ status: "pending", amount: "9000.00", payer: "AK" }]);

    const [v3] = await rpc<{ id: string; version: number }>(ADMIN, `select * from public.upsert_expense($1)`, [
      JSON.stringify({ ...base, id: row.id, expected_version: v2.version, amount: "9000", paid_by_unit_id: ids.units.AQ }),
    ]);
    expect((await linked(row.id)).rows).toEqual([]);

    const [v4] = await rpc<{ id: string; version: number }>(ADMIN, `select * from public.upsert_expense($1)`, [
      JSON.stringify({ ...base, id: row.id, expected_version: v3.version, amount: "9000", paid_by_unit_id: ids.units.AB }),
    ]);
    expect((await linked(row.id)).rows).toHaveLength(1);
    await rpc(ADMIN, `select public.delete_expense($1, $2)`, [row.id, v4.version]);
    expect((await linked(row.id)).rows).toEqual([]);
  });

  it("members cannot trigger direct-payment syncing themselves", async () => {
    await expectDbError(rpc(AK_USER, `select public.sync_direct_payment($1)`, [periodId]), /permission denied/);
  });

  it("closed periods are read-only", async () => {
    await rpc(ADMIN, `select public.set_period_status($1, 'closed')`, [periodId]);
    await expectDbError(
      rpc(ADMIN, `select * from public.delete_expense($1, $2)`, [expenseId, version]),
      /period_closed/,
    );
    await rpc(ADMIN, `select public.set_period_status($1, 'open')`, [periodId]);
  });
});

describe("payments", () => {
  let paymentId: string;

  it("members can only pay for their own unit", async () => {
    await expectDbError(
      rpc(AK_USER, `select * from public.submit_payment($1)`, [JSON.stringify(payment({ payer_unit_id: ids.units.AB, method: "cash" }))]),
      /forbidden/,
    );
  });

  it("requires a screenshot for non-cash payments", async () => {
    await expectDbError(
      rpc(AK_USER, `select * from public.submit_payment($1)`, [JSON.stringify(payment({ payer_unit_id: ids.units.AK }))]),
      /screenshot_required/,
    );
  });

  it("rejects attachments the user did not upload", async () => {
    const path = await addProof(AB_USER, "ab.png");
    await expectDbError(
      rpc(AK_USER, `select * from public.submit_payment($1)`, [
        JSON.stringify(payment({ payer_unit_id: ids.units.AK, attachment: { path, mime: "image/png", size: 100, sha256: "a".repeat(64) } })),
      ]),
      /invalid_attachment/,
    );
  });

  it("submits a pending payment and replays idempotently", async () => {
    const path = await addProof(AK_USER, "ak.png");
    const body = payment({
      payer_unit_id: ids.units.AK,
      reference: "TXN-1",
      attachment: { path, mime: "image/png", size: 1234, sha256: "b".repeat(64) },
    });
    const [first] = await rpc<{ id: string; status: string; replayed: boolean }>(AK_USER, `select * from public.submit_payment($1)`, [JSON.stringify(body)]);
    expect(first).toMatchObject({ status: "pending", replayed: false });
    const [again] = await rpc<{ id: string; replayed: boolean }>(AK_USER, `select * from public.submit_payment($1)`, [JSON.stringify(body)]);
    expect(again).toMatchObject({ id: first.id, replayed: true });
    const n = await db.query(`select count(*)::int as n from public.payments where idempotency_key = $1`, [body.idempotency_key]);
    expect(n.rows[0]).toEqual({ n: 1 });
    paymentId = first.id;
  });

  it("blocks duplicate transaction references", async () => {
    const path = await addProof(AK_USER, "ak2.png");
    await expectDbError(
      rpc(AK_USER, `select * from public.submit_payment($1)`, [
        JSON.stringify(payment({ payer_unit_id: ids.units.AK, reference: "txn-1", attachment: { path, mime: "image/png", size: 1, sha256: "c".repeat(64) } })),
      ]),
      /duplicate_reference/,
    );
  });

  it("pending payments do not enqueue a sync", async () => {
    await db.query(`delete from public.sync_jobs`);
    const jobs = await db.query(`select 1 from public.sync_jobs`);
    expect(jobs.rows.length).toBe(0);
  });

  it("members cannot review payments", async () => {
    await expectDbError(rpc(AK_USER, `select * from public.review_payment($1, 'approved', 1)`, [paymentId]), /forbidden/);
  });

  it("requires a reason to reject and the current version to approve", async () => {
    await expectDbError(rpc(ADMIN, `select * from public.review_payment($1, 'rejected', 1)`, [paymentId]), /reason_required/);
    await expectDbError(rpc(ADMIN, `select * from public.review_payment($1, 'approved', 9)`, [paymentId]), /conflict/);
  });

  it("approves once, records the review and enqueues the period sync", async () => {
    const [r] = await rpc<{ status: string }>(ADMIN, `select * from public.review_payment($1, 'approved', 1)`, [paymentId]);
    expect(r.status).toBe("approved");
    await expectDbError(rpc(ADMIN, `select * from public.review_payment($1, 'approved', 2)`, [paymentId]), /already_reviewed/);
    const reviews = await db.query(`select decision from public.payment_reviews where payment_id = $1`, [paymentId]);
    expect(reviews.rows).toEqual([{ decision: "approved" }]);
    const jobs = await db.query(`select scope from public.sync_jobs where status = 'pending'`);
    expect(jobs.rows).toEqual([{ scope: `period:${periodId}` }]);
  });

  it("hides other units' payments when balances are private", async () => {
    await db.query(`update public.app_settings set members_see_all_balances = false where household_id = $1`, [ids.householdId]);
    const seen = await rpc(AB_USER, `select id from public.payments where id = $1`, [paymentId]);
    expect(seen).toEqual([]);
    const own = await rpc(AK_USER, `select id from public.payments where id = $1`, [paymentId]);
    expect(own.length).toBe(1);
    await db.query(`update public.app_settings set members_see_all_balances = true where household_id = $1`, [ids.householdId]);
  });

  it("keeps screenshots private to the payer unit and admins", async () => {
    const path = `${ids.householdId}/${AK_USER.sub}/ak.png`;
    expect(await rpc(AB_USER, `select name from storage.objects where name = $1`, [path])).toEqual([]);
    expect((await rpc(ADMIN, `select name from storage.objects where name = $1`, [path])).length).toBe(1);
    expect((await rpc(AB_USER, `select id from public.payment_attachments`)).length).toBe(0);
  });

  it("outsiders see nothing", async () => {
    expect(await rpc(STRANGER, `select id from public.expenses`)).toEqual([]);
    expect(await rpc(STRANGER, `select id from public.payments`)).toEqual([]);
    expect(await rpc(STRANGER, `select id from public.households`)).toEqual([]);
    await expectDbError(
      rpc(STRANGER, `select * from public.submit_payment($1)`, [JSON.stringify(payment({ payer_unit_id: ids.units.AK, method: "cash" }))]),
      /forbidden/,
    );
  });

  it("anonymous users cannot read anything", async () => {
    expect(await rpc("anon", `select id from public.units`)).toEqual([]);
  });
});

describe("sync worker", () => {
  const W1 = "11111111-1111-1111-1111-111111111111";
  const W2 = "22222222-2222-2222-2222-222222222222";

  it("is not callable by users", async () => {
    await expectDbError(rpc(ADMIN, `select * from public.claim_sync_job($1)`, [W1]), /permission denied/);
  });

  it("claims one job per household at a time and coalesces new changes", async () => {
    const [job] = await rpc<{ id: number; scope: string; status: string }>("service", `select * from public.claim_sync_job($1, 60)`, [W1]);
    expect(job).toMatchObject({ scope: `period:${periodId}`, status: "running" });
    expect(await rpc("service", `select * from public.claim_sync_job($1, 60)`, [W2])).toEqual([]);

    await rpc("service", `select public.enqueue_sync($1, $2)`, [ids.householdId, `period:${periodId}`]);
    await rpc("service", `select public.enqueue_sync($1, $2)`, [ids.householdId, `period:${periodId}`]);
    const pending = await db.query(`select count(*)::int as n from public.sync_jobs where status = 'pending'`);
    expect(pending.rows[0]).toEqual({ n: 1 });

    await rpc("service", `select public.finish_sync_job($1, $2, true)`, [job.id, W1]);
    const state = await db.query<{ ok: boolean }>(`select last_success_at is not null as ok from public.sync_scope_state where scope = $1`, [`period:${periodId}`]);
    expect(state.rows[0].ok).toBe(true);
  });

  it("retries with backoff, then marks failed and lets an admin retry", async () => {
    const [job] = await rpc<{ id: number }>("service", `select * from public.claim_sync_job($1, 60)`, [W1]);
    await rpc("service", `select public.finish_sync_job($1, $2, false, 'boom', now() + interval '1 hour')`, [job.id, W1]);
    const retried = await db.query(`select status, last_error from public.sync_jobs where id = $1`, [job.id]);
    expect(retried.rows[0]).toEqual({ status: "pending", last_error: "boom" });
    expect(await rpc("service", `select * from public.claim_sync_job($1, 60)`, [W1])).toEqual([]);

    await db.query(`update public.sync_jobs set next_attempt_at = now() where id = $1`, [job.id]);
    const [again] = await rpc<{ id: number; attempts: number }>("service", `select * from public.claim_sync_job($1, 60)`, [W1]);
    expect(again.attempts).toBe(2);
    await rpc("service", `select public.finish_sync_job($1, $2, false, 'gave up')`, [again.id, W1]);
    const failed = await db.query(`select status from public.sync_jobs where id = $1`, [again.id]);
    expect(failed.rows[0]).toEqual({ status: "failed" });

    const [{ n }] = await rpc<{ n: number }>(ADMIN, `select public.retry_sync($1) as n`, [ids.householdId]);
    expect(n).toBe(1);
    const pending = await db.query(`select count(*)::int as n from public.sync_jobs where status = 'pending'`);
    expect(pending.rows[0]).toEqual({ n: 1 });
  });

  it("recovers jobs whose lease expired", async () => {
    const [job] = await rpc<{ id: number }>("service", `select * from public.claim_sync_job($1, 60)`, [W1]);
    await db.query(`update public.sync_jobs set lease_until = now() - interval '1 second' where id = $1`, [job.id]);
    await db.query(`update public.sync_leases set lease_until = now() - interval '1 second'`);
    const [again] = await rpc<{ id: number }>("service", `select * from public.claim_sync_job($1, 60)`, [W2]);
    expect(again.id).toBe(job.id);
  });
});

describe("electricity bills", () => {
  let meterId: string;
  let billId: string;

  it("only admins add meters, and reference numbers must have 14 digits", async () => {
    await expectDbError(
      rpc(AK_USER, `insert into public.utility_meters (household_id, label, reference_no) values ($1, 'Upstairs', '02117110000001')`, [ids.householdId]),
      /row-level security/,
    );
    await expectDbError(rpc(ADMIN, `insert into public.utility_meters (household_id, label, reference_no) values ($1, 'Bad', '123')`, [ids.householdId]), /check/);
    [{ id: meterId }] = await rpc<{ id: string }>(
      ADMIN,
      `insert into public.utility_meters (household_id, label, reference_no, category_id) values ($1, 'Ground floor', '02117110000001', $2) returning id`,
      [ids.householdId, ids.categories.WAPDA ?? null],
    );
  });

  it("bills are written by the server, read by members and only their expense link can change", async () => {
    [{ id: billId }] = await rpc<{ id: string }>(
      "service",
      `insert into public.utility_bills (household_id, meter_id, bill_month, due_date, payable) values ($1, $2, '2026-10-01', '2026-10-22', 1524) returning id`,
      [ids.householdId, meterId],
    );
    expect(await rpc(AB_USER, `select payable from public.utility_bills where id = $1`, [billId])).toEqual([{ payable: "1524.00" }]);
    await expectDbError(rpc(ADMIN, `insert into public.utility_bills (household_id, meter_id, bill_month, payable) values ($1, $2, '2026-11-01', 1)`, [ids.householdId, meterId]), /row-level security/);
    await expectDbError(rpc(ADMIN, `update public.utility_bills set payable = 1 where id = $1`, [billId]), /permission denied/);
    await expectDbError(rpc(AK_USER, `update public.utility_bills set expense_id = null where id = $1 returning id`, [billId]).then((r) => { if (!r.length) throw new Error("row-level security: no row updated"); }), /row-level security/);
    expect(await rpc(ADMIN, `update public.utility_bills set expense_id = null where id = $1 returning id`, [billId])).toEqual([{ id: billId }]);
  });

  it("outsiders see no meters or bills", async () => {
    expect(await rpc(STRANGER, `select id from public.utility_meters`)).toEqual([]);
    expect(await rpc(STRANGER, `select id from public.utility_bills`)).toEqual([]);
  });
});

describe("water and gas connections", () => {
  it("checks each company's number format", async () => {
    await expectDbError(rpc(ADMIN, `insert into public.utility_meters (household_id, provider, label, reference_no) values ($1, 'sngpl', 'Gas', '123')`, [ids.householdId]), /check/);
    await expectDbError(rpc(ADMIN, `insert into public.utility_meters (household_id, provider, label, reference_no) values ($1, 'ptcl', 'Phone', '12345678901')`, [ids.householdId]), /check/);
    const rows = await rpc(ADMIN, `insert into public.utility_meters (household_id, provider, label, reference_no) values ($1, 'sngpl', 'Gas', '12345678901'), ($1, 'wasa', 'Water', '2345678') returning provider`, [ids.householdId]);
    expect(rows).toEqual([{ provider: "sngpl" }, { provider: "wasa" }]);
  });

  it("records uploaded bills with their file type", async () => {
    const [{ id: meterId }] = await rpc<{ id: string }>(ADMIN, `select id from public.utility_meters where provider = 'sngpl'`);
    const [bill] = await rpc(
      "service",
      `insert into public.utility_bills (household_id, meter_id, bill_month, payable, source, snapshot_mime) values ($1, $2, '2026-10-01', 8730, 'upload', 'image/jpeg') returning source, snapshot_mime`,
      [ids.householdId, meterId],
    );
    expect(bill).toEqual({ source: "upload", snapshot_mime: "image/jpeg" });
    await expectDbError(rpc("service", `insert into public.utility_bills (household_id, meter_id, bill_month, payable, snapshot_mime) values ($1, $2, '2026-11-01', 1, 'text/javascript')`, [ids.householdId, meterId]), /check/);
  });
});

describe("personal spending", () => {
  let akExpense: string;

  it("each person records their own categories, spending and budgets", async () => {
    const [{ id: cat }] = await rpc<{ id: string }>(AK_USER, `insert into public.personal_categories (name) values ('Fuel') returning id`);
    [{ id: akExpense }] = await rpc<{ id: string }>(
      AK_USER,
      `insert into public.personal_expenses (category_id, amount, spent_on, note) values ($1, 3000, '2026-10-20', 'petrol') returning id`,
      [cat],
    );
    await rpc(AK_USER, `insert into public.personal_budgets (amount) values (20000)`);
    expect(await rpc(AK_USER, `select amount from public.personal_expenses`)).toEqual([{ amount: "3000.00" }]);
  });

  it("nobody else can see or change them, not even the administrator", async () => {
    for (const other of [ADMIN, AB_USER, STRANGER]) {
      expect(await rpc(other, `select id from public.personal_expenses`)).toEqual([]);
      expect(await rpc(other, `select id from public.personal_categories`)).toEqual([]);
      expect(await rpc(other, `select id from public.personal_budgets`)).toEqual([]);
      expect(await rpc(other, `update public.personal_expenses set amount = 1 where id = $1 returning id`, [akExpense])).toEqual([]);
      expect(await rpc(other, `delete from public.personal_expenses where id = $1 returning id`, [akExpense])).toEqual([]);
    }
    await expectDbError(
      rpc(ADMIN, `insert into public.personal_expenses (user_id, amount, spent_on) values ($1, 5, '2026-10-20')`, [AK_USER.sub]),
      /row-level security/,
    );
  });

  it("writes no audit copies", async () => {
    expect(await rpc("service", `select count(*)::int as n from public.audit_log where table_name like 'personal_%'`)).toEqual([{ n: 0 }]);
  });

  it("keeps receipt files under the owner's folder", async () => {
    await rpc(AK_USER, `insert into storage.objects (bucket_id, name, owner_id) values ('personal-receipts', $1, $2)`, [`${AK_USER.sub}/r1.jpg`, AK_USER.sub]);
    await expectDbError(
      rpc(AB_USER, `insert into storage.objects (bucket_id, name, owner_id) values ('personal-receipts', $1, $2)`, [`${AK_USER.sub}/r2.jpg`, AB_USER.sub]),
      /row-level security/,
    );
    expect(await rpc(ADMIN, `select name from storage.objects where bucket_id = 'personal-receipts'`)).toEqual([]);
    expect(await rpc(AK_USER, `select name from storage.objects where bucket_id = 'personal-receipts'`)).toEqual([{ name: `${AK_USER.sub}/r1.jpg` }]);
    await expectDbError(
      rpc(AK_USER, `insert into public.personal_expenses (amount, spent_on, receipt_path) values (5, '2026-10-20', $1)`, [`${AB_USER.sub}/x.jpg`]),
      /check/,
    );
  });
});

describe("meter watch", () => {
  let meterId: string;

  it("every household member can add and see readings for the household's meters", async () => {
    [{ id: meterId }] = await rpc<{ id: string }>(ADMIN, `select id from public.utility_meters where provider = 'lesco' limit 1`);
    expect(await rpc(ADMIN, `select unit_limit from public.utility_meters where id = $1`, [meterId])).toEqual([{ unit_limit: 200 }]);
    await rpc(AB_USER, `insert into public.meter_readings (household_id, meter_id, reading) values ($1, $2, 890)`, [ids.householdId, meterId]);
    expect(await rpc(AK_USER, `select reading from public.meter_readings where meter_id = $1`, [meterId])).toEqual([{ reading: 890 }]);
  });

  it("outsiders can neither read nor add readings, and members can't record in someone else's name", async () => {
    expect(await rpc(STRANGER, `select id from public.meter_readings`)).toEqual([]);
    await expectDbError(rpc(STRANGER, `insert into public.meter_readings (household_id, meter_id, reading) values ($1, $2, 900)`, [ids.householdId, meterId]), /row-level security/);
    await expectDbError(
      rpc(AK_USER, `insert into public.meter_readings (household_id, meter_id, reading, recorded_by) values ($1, $2, 900, $3)`, [ids.householdId, meterId, AB_USER.sub]),
      /row-level security/,
    );
  });

  it("only the person who added a reading or an admin can remove it", async () => {
    expect(await rpc(AK_USER, `delete from public.meter_readings where meter_id = $1 returning id`, [meterId])).toEqual([]);
    expect((await rpc(AB_USER, `delete from public.meter_readings where meter_id = $1 returning id`, [meterId])).length).toBe(1);
  });

  it("stores bill readings and history", async () => {
    const [b] = await rpc(
      "service",
      `insert into public.utility_bills (household_id, meter_id, bill_month, payable, previous_reading, present_reading, history)
       values ($1, $2, '2026-12-01', 1, 778, 841, '[{"month":"2026-09","units":148}]') returning present_reading, history`,
      [ids.householdId, meterId],
    );
    expect(b).toEqual({ present_reading: 841, history: [{ month: "2026-09", units: 148 }] });
  });
});

describe("notifications and reminders", () => {
  it("each person manages only their own devices and preferences", async () => {
    await rpc(AK_USER, `insert into public.push_subscriptions (household_id, endpoint, p256dh, auth) values ($1, 'https://push.example/ak', 'k', 'a')`, [ids.householdId]);
    await rpc(AK_USER, `insert into public.notification_prefs (quiet_start) values ('23:00')`);
    for (const other of [ADMIN, AB_USER, STRANGER]) {
      expect(await rpc(other, `select id from public.push_subscriptions`)).toEqual([]);
      expect(await rpc(other, `select user_id from public.notification_prefs`)).toEqual([]);
    }
    await expectDbError(
      rpc(STRANGER, `insert into public.push_subscriptions (household_id, endpoint, p256dh, auth) values ($1, 'https://push.example/x', 'k', 'a')`, [ids.householdId]),
      /row-level security/,
    );
  });

  it("notifications are written by the server and only their owner can read them or mark them read", async () => {
    const [{ id }] = await rpc<{ id: string }>(
      "service",
      `insert into public.notifications (household_id, user_id, category, title, dedupe_key) values ($1, $2, 'payments', 'Approved', 'p1') returning id`,
      [ids.householdId, AK_USER.sub],
    );
    expect(await rpc(ADMIN, `select id from public.notifications`)).toEqual([]);
    await expectDbError(rpc(AK_USER, `insert into public.notifications (household_id, user_id, category, title, dedupe_key) values ($1, $2, 'payments', 'x', 'p2')`, [ids.householdId, AK_USER.sub]), /row-level security|permission denied/);
    await expectDbError(rpc(AK_USER, `update public.notifications set title = 'changed' where id = $1`, [id]), /permission denied/);
    expect(await rpc(AK_USER, `update public.notifications set read_at = now() where id = $1 returning id`, [id])).toEqual([{ id }]);
  });

  it("personal reminders stay private, family reminders are shared", async () => {
    await rpc(AB_USER, `insert into public.reminders (household_id, title, next_at) values ($1, 'My dentist', now() + interval '1 day')`, [ids.householdId]);
    await rpc(AB_USER, `insert into public.reminders (household_id, audience, title, next_at, repeat) values ($1, 'family', 'Pay maid', now() + interval '1 day', 'monthly')`, [ids.householdId]);
    expect((await rpc<{ title: string }>(AK_USER, `select title from public.reminders`)).map((r) => r.title)).toEqual(["Pay maid"]);
    expect((await rpc<{ title: string }>(ADMIN, `select title from public.reminders`)).map((r) => r.title)).toEqual(["Pay maid"]);
    expect(await rpc(AK_USER, `delete from public.reminders where title = 'Pay maid' returning id`)).toEqual([]);
    expect((await rpc(ADMIN, `delete from public.reminders where title = 'Pay maid' returning id`)).length).toBe(1);
    expect(await rpc(STRANGER, `select id from public.reminders`)).toEqual([]);
  });
});

describe("personal plans", () => {
  it("the owner plans items for a month; nobody else can see or change them", async () => {
    const [{ id }] = await rpc<{ id: string }>(AK_USER, `insert into public.personal_plan_items (month, title, estimate, due_date, repeat_monthly) values ('2026-11-01', 'Petrol', 12000, '2026-11-05', true) returning id`);
    expect(await rpc(AK_USER, `select title, estimate from public.personal_plan_items`)).toEqual([{ title: "Petrol", estimate: "12000.00" }]);
    for (const other of [ADMIN, AB_USER, STRANGER]) {
      expect(await rpc(other, `select id from public.personal_plan_items`)).toEqual([]);
      expect(await rpc(other, `update public.personal_plan_items set estimate = 1 where id = $1 returning id`, [id])).toEqual([]);
    }
  });

  it("keeps due dates inside the month and refuses links to someone else's spending", async () => {
    await expectDbError(rpc(AK_USER, `insert into public.personal_plan_items (month, title, estimate, due_date) values ('2026-11-01', 'Late', 5, '2026-12-01')`), /check/);
    const [{ id: abExpense }] = await rpc<{ id: string }>(AB_USER, `insert into public.personal_expenses (amount, spent_on) values (50, '2026-11-02') returning id`);
    await expectDbError(rpc(AK_USER, `insert into public.personal_plan_items (month, title, estimate, expense_id) values ('2026-11-01', 'X', 5, $1)`, [abExpense]), /row-level security/);
  });
});

describe("personal salaries", () => {
  it("the owner records staff and payments; nobody else can see or change them", async () => {
    const [{ id: staff }] = await rpc<{ id: string }>(AK_USER, `insert into public.personal_staff (name, role, monthly_salary, pay_day) values ('Aslam', 'Driver', 25000, 1) returning id`);
    const [{ id: expense }] = await rpc<{ id: string }>(AK_USER, `insert into public.personal_expenses (amount, spent_on) values (5000, '2026-10-05') returning id`);
    await rpc(AK_USER, `insert into public.personal_salary_payments (staff_id, month, kind, amount, paid_on, expense_id) values ($1, '2026-10-01', 'advance', 5000, '2026-10-05', $2)`, [staff, expense]);
    expect(await rpc(AK_USER, `select kind, amount from public.personal_salary_payments`)).toEqual([{ kind: "advance", amount: "5000.00" }]);
    for (const other of [ADMIN, AB_USER, STRANGER]) {
      expect(await rpc(other, `select id from public.personal_staff`)).toEqual([]);
      expect(await rpc(other, `select id from public.personal_salary_payments`)).toEqual([]);
      expect(await rpc(other, `update public.personal_staff set monthly_salary = 1 where id = $1 returning id`, [staff])).toEqual([]);
    }
  });

  it("refuses payments for someone else's staff and bad values", async () => {
    const [{ id: abStaff }] = await rpc<{ id: string }>(AB_USER, `insert into public.personal_staff (name, monthly_salary) values ('Maid', 8000) returning id`);
    await expectDbError(rpc(AK_USER, `insert into public.personal_salary_payments (staff_id, month, amount, paid_on) values ($1, '2026-10-01', 8000, '2026-10-01')`, [abStaff]), /row-level security/);
    await expectDbError(rpc(AB_USER, `insert into public.personal_salary_payments (staff_id, month, kind, amount, paid_on) values ($1, '2026-10-01', 'loan', 8000, '2026-10-01')`, [abStaff]), /check/);
    await expectDbError(rpc(AB_USER, `insert into public.personal_staff (name, monthly_salary, pay_day) values ('X', 100, 32)`), /check/);
  });
});

describe("copying last month's items", () => {
  it("a copied item is paid from the purse and creates no payment", async () => {
    const [{ id: next }] = await rpc<{ id: string }>(ADMIN, `select public.ensure_period($1, 2027, 1) as id`, [ids.householdId]);
    const [row] = await rpc<{ id: string }>(ADMIN, `select * from public.upsert_expense($1)`, [
      JSON.stringify({
        household_id: ids.householdId,
        period_id: next,
        section_id: ids.sections.MILK_MEAT,
        category_id: ids.categories.meat,
        title: "Chicken",
        description: "",
        qty_text: "",
        qty_num: "21",
        rate: "500",
        amount: "10500.00",
        split_rule_id: ids.rules.POOL3,
        split_override: null,
        expense_date: "",
        paid_by_unit_id: null,
        notes: "",
      }),
    ]);
    const [e] = (await db.query<{ paid_by_unit_id: string; expense_date: string | null; amount: string }>(`select paid_by_unit_id, expense_date, amount::text from public.expenses where id = $1`, [row.id])).rows;
    expect(e).toEqual({ paid_by_unit_id: ids.units.AQ, expense_date: null, amount: "10500.00" });
    expect((await db.query(`select id from public.payments where related_expense_id = $1`, [row.id])).rows).toEqual([]);
  });
});
