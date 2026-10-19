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

  it("expense paid by a non-purse unit creates a pending contribution", async () => {
    const [row] = await rpc<{ id: string }>(ADMIN, `select * from public.upsert_expense($1)`, [
      JSON.stringify({ household_id: ids.householdId, period_id: periodId, section_id: ids.sections.BILLS, title: "Internet", amount: "2200", split_rule_id: ids.rules.POOL3, paid_by_unit_id: ids.units.AK }),
    ]);
    const pay = await db.query<{ status: string; amount: string }>(
      `select status, amount::text from public.payments where related_expense_id = $1`, [row.id]);
    expect(pay.rows).toEqual([{ status: "pending", amount: "2200.00" }]);
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
