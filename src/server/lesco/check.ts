import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseLescoBill, type LescoBill } from "@/lib/lesco/parse";
import { billAssets, buildBillSnapshot } from "@/lib/lesco/snapshot";
import { PROVIDERS, type Provider } from "@/lib/utilities/providers";
import { readBillText } from "@/lib/utilities/read-bill-text";

const UA = "Mozilla/5.0 (compatible; GharHisaab bill check; one request per meter per day)";
const LESCO = "https://bill.pitc.com.pk";
const WASA = "https://cms.wasalhr.pk";

export type Meter = { id: string; household_id: string; reference_no: string; label: string; provider: Provider };
export type FetchedBill = Omit<LescoBill, "referenceNo">;
export type CheckOutcome =
  | { status: "new"; bill: FetchedBill }
  | { status: "unchanged"; bill: FetchedBill }
  | { status: "error"; message: string };

type Fetched = { ok: true; html: string; bill: FetchedBill; site: string } | { ok: false; message: string };

const assetCache = new Map<string, { at: number; value: string }>();

const TIMEOUT = 40_000;
let lastFailure = "";

/** Why a request failed, in a few words, for the meter's error note. */
function failure(e: unknown) {
  const err = e as { name?: string; cause?: { code?: string } };
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return "no answer within 40 seconds";
  return err?.cause?.code ? `connection failed: ${err.cause.code}` : "connection failed";
}

async function attempt(url: string | URL, init: RequestInit): Promise<Response | null> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT), cache: "no-store" });
  } catch (e) {
    lastFailure = failure(e);
    return null;
  }
}

async function get(url: string) {
  return attempt(url, { headers: { "User-Agent": UA, Accept: "text/html,text/css,image/*;q=0.8" } });
}

async function asset(site: string, path: string, kind: "css" | "image") {
  const key = site + path;
  const hit = assetCache.get(key);
  if (hit && Date.now() - hit.at < 12 * 3600_000) return hit.value;
  const res = await get(site + path);
  if (!res?.ok) return null;
  let value: string;
  if (kind === "css") value = await res.text();
  else {
    const type = res.headers.get("content-type") ?? "";
    if (!/^image\/(png|jpeg|gif|webp)/.test(type)) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength > 200_000) return null;
    value = `data:${type.split(";")[0]};base64,${bytes.toString("base64")}`;
  }
  assetCache.set(key, { at: Date.now(), value });
  return value;
}

const unreachable = (name: string) => `Couldn't reach ${name}'s bill site (${lastFailure || "no answer"}). It will be tried again tomorrow.`;

export function providerSiteUrl(provider: Provider) {
  return PROVIDERS[provider].siteUrl;
}

function hidden(html: string, name: string) {
  return new RegExp(`name="${name}"[^>]*value="([^"]*)"`).exec(html)?.[1] ?? "";
}

function cookiesFrom(res: Response, jar: Map<string, string>) {
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

/** LESCO: load the search form, submit the reference number and follow the redirect to the bill. */
async function fetchLesco(referenceNo: string): Promise<Fetched> {
  const jar = new Map<string, string>();
  const form = await get(`${LESCO}/lescobill`);
  if (!form?.ok) return { ok: false, message: unreachable("LESCO") };
  const formHtml = await form.text();
  cookiesFrom(form, jar);
  const select = /<select name="ruCodeTextBox"[\s\S]*?<\/select>/.exec(formHtml)?.[0] ?? "";
  const ruCode = /<option[^>]*selected[^>]*value="([^"]*)"/.exec(select)?.[1] ?? /<option[^>]*value="([^"]*)"/.exec(select)?.[1] ?? "";
  const body = new URLSearchParams({
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    __LASTFOCUS: "",
    __VIEWSTATE: hidden(formHtml, "__VIEWSTATE"),
    __VIEWSTATEGENERATOR: hidden(formHtml, "__VIEWSTATEGENERATOR"),
    __EVENTVALIDATION: hidden(formHtml, "__EVENTVALIDATION"),
    __RequestVerificationToken: hidden(formHtml, "__RequestVerificationToken"),
    rbSearchByList: "refno",
    searchTextBox: referenceNo,
    ruCodeTextBox: ruCode,
    btnSearch: "Search",
  });
  let res = await attempt(`${LESCO}/lescobill`, {
    method: "POST",
    redirect: "manual",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", Cookie: cookiesFrom(form, jar), Referer: `${LESCO}/lescobill`, Origin: LESCO },
    body,
  });
  for (let hop = 0; res && res.status >= 300 && res.status < 400 && hop < 3; hop++) {
    const next = new URL(res.headers.get("location") ?? "/lescobill", `${LESCO}/lescobill`);
    if (next.origin !== LESCO) return { ok: false, message: "LESCO sent the request somewhere unexpected, so it was stopped." };
    const cookie = cookiesFrom(res, jar);
    res = await attempt(next, { redirect: "manual", headers: { "User-Agent": UA, Cookie: cookie, Referer: `${LESCO}/lescobill` } });
  }
  if (!res) return { ok: false, message: unreachable("LESCO") };
  if (!res.ok) return { ok: false, message: `LESCO's bill site answered with an error (${res.status}). It will be tried again tomorrow.` };
  const html = await res.text();
  const parsed = parseLescoBill(html);
  if (!parsed.ok) {
    const why = {
      captcha: "LESCO is asking for a CAPTCHA, so the bill can't be read automatically. Open LESCO's site instead.",
      not_found: "LESCO didn't find a bill for this reference number. Check the 14 digits.",
      unreadable: "LESCO's bill page has changed and couldn't be read. Open LESCO's site instead.",
    };
    return { ok: false, message: why[parsed.reason] };
  }
  const { referenceNo: found, ...bill } = parsed.bill;
  if (found && found !== referenceNo) return { ok: false, message: "LESCO returned a bill for a different reference number, so it was not saved." };
  return { ok: true, html, bill, site: LESCO };
}

function htmlToLines(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(td|th|div|p|li|tr|h\d)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** WASA Lahore: the duplicate bill page takes the account number in the address. */
async function fetchWasa(account: string): Promise<Fetched> {
  const res = await get(`${WASA}/DuplicateBill/showBill?acctnum=${encodeURIComponent(account)}`);
  if (!res) return { ok: false, message: unreachable("WASA") };
  if (!res.ok) return { ok: false, message: `WASA's bill site answered with an error (${res.status}). It will be tried again tomorrow.` };
  const html = await res.text();
  if (/captcha/i.test(html) && /<img[^>]*captcha|name="[^"]*captcha/i.test(html)) return { ok: false, message: "WASA is asking for a CAPTCHA, so the bill can't be read automatically. Open WASA's site instead." };
  if (/wrong account no/i.test(html)) return { ok: false, message: "WASA didn't find a bill for this account number. Check the number on the water bill." };
  const read = readBillText(htmlToLines(html));
  if (!read.payable || !read.billMonth) return { ok: false, message: "WASA's bill page couldn't be read. Open WASA's site instead." };
  return {
    ok: true,
    html,
    site: WASA,
    bill: {
      billMonth: read.billMonth,
      readingDate: null,
      issueDate: null,
      dueDate: read.dueDate,
      units: null,
      payable: read.payable,
      currentBill: null,
      latePayments: read.afterDue ? [{ until: null, amount: read.afterDue }] : [],
      previousReading: null,
      presentReading: null,
      history: [],
    },
  };
}

/** Downloads the current bill for one meter, saves a copy and records it. Uses the service-role client. */
export type CheckOptions = { onNewBill?: (householdId: string, meterId: string, billMonth: string) => void };

export async function checkMeter(db: SupabaseClient, meter: Meter, opts: CheckOptions = {}): Promise<CheckOutcome> {
  lastFailure = "";
  const finish = async (outcome: CheckOutcome) => {
    await db.from("utility_meters").update({ last_checked_at: new Date().toISOString(), last_error: outcome.status === "error" ? outcome.message : null }).eq("id", meter.id);
    return outcome;
  };
  if (!PROVIDERS[meter.provider].fetches) return { status: "error", message: `${PROVIDERS[meter.provider].name} bills are uploaded, not fetched.` };

  const fetched = meter.provider === "lesco" ? await fetchLesco(meter.reference_no) : await fetchWasa(meter.reference_no);
  if (!fetched.ok) return finish({ status: "error", message: fetched.message });
  const { bill, html, site } = fetched;

  const billMonth = `${bill.billMonth}-01`;
  const { data: existing } = await db.from("utility_bills").select("id, payable, due_date, present_reading").eq("meter_id", meter.id).eq("bill_month", billMonth).maybeSingle();
  if (existing && Number(existing.payable) === bill.payable && existing.due_date === bill.dueDate && existing.present_reading === bill.presentReading) return finish({ status: "unchanged", bill });

  const { styles, images } = billAssets(html);
  const styleMap: Record<string, string> = {};
  const imageMap: Record<string, string> = {};
  for (const p of styles.slice(0, 8)) {
    const css = await asset(site, p, "css");
    if (css) styleMap[p] = css;
  }
  for (const p of images.filter((i) => !/snap|meter|captcha/i.test(i)).slice(0, 4)) {
    const img = await asset(site, p, "image");
    if (img) imageMap[p] = img;
  }
  const snapshot = buildBillSnapshot(html, styleMap, imageMap);
  const path = `${meter.household_id}/${meter.id}/${bill.billMonth}.html`;
  const up = await db.storage.from("utility-bills").upload(path, new Blob([snapshot], { type: "text/plain" }), { contentType: "text/plain", upsert: true });
  if (up.error) return finish({ status: "error", message: "The bill was read but its copy couldn't be saved. It will be tried again tomorrow." });

  const saved = await db.from("utility_bills").upsert(
    {
      household_id: meter.household_id,
      meter_id: meter.id,
      bill_month: billMonth,
      reading_date: bill.readingDate,
      issue_date: bill.issueDate,
      due_date: bill.dueDate,
      units: bill.units,
      payable: bill.payable,
      current_bill: bill.currentBill,
      late_payments: bill.latePayments,
      previous_reading: bill.previousReading,
      present_reading: bill.presentReading,
      history: bill.history,
      snapshot_path: path,
      snapshot_mime: "text/html",
      source: "fetched",
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "meter_id,bill_month" },
  );
  if (saved.error) return finish({ status: "error", message: "The bill was read but couldn't be recorded. It will be tried again tomorrow." });
  if (!existing) opts.onNewBill?.(meter.household_id, meter.id, bill.billMonth);
  return finish({ status: existing ? "unchanged" : "new", bill });
}

/** Daily run: checks every active fetchable meter whose bill for the current month isn't in yet. */
export async function checkAllMeters(db: SupabaseClient, today: string, budgetMs = 270_000, opts: CheckOptions = {}) {
  const started = Date.now();
  const thisMonth = `${today.slice(0, 7)}-01`;
  const fetchable = Object.values(PROVIDERS).filter((p) => p.fetches).map((p) => p.id);
  const { data: meters, error } = await db.from("utility_meters").select("id, household_id, reference_no, label, provider").in("provider", fetchable).eq("active", true);
  if (error) throw error;
  const results: { meter: string; status: string }[] = [];
  for (const m of meters ?? []) {
    if (Date.now() - started > budgetMs) break;
    const { data: have } = await db.from("utility_bills").select("id").eq("meter_id", m.id).gte("bill_month", thisMonth).limit(1);
    if (have?.length) {
      await db.from("utility_meters").update({ last_error: null }).eq("id", m.id).not("last_error", "is", null);
      results.push({ meter: m.id, status: "already have this month" });
      continue;
    }
    const r = await checkMeter(db, m as Meter, opts);
    results.push({ meter: m.id, status: r.status });
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return results;
}
