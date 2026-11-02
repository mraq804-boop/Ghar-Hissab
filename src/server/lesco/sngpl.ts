import "server-only";
import { readSngplPage } from "@/lib/utilities/sngpl-page";
import type { FetchedBill } from "./check";

const SITE = "https://www.sngpl.com.pk";
const FORM = `${SITE}/login.jsp?mdids=85`;
const UA = "Mozilla/5.0 (compatible; GharHisaab gas bill; fetched when the family asks)";
const TIMEOUT = 40_000;
const TOKEN_AGE = 15 * 60_000;

type Session = { c: string; s: string; f: string; t: number };

export type SngplStart = { ok: true; token: string; image: string } | { ok: false; message: string };
export type SngplResult =
  | { ok: true; html: string; bill: FetchedBill; site: string }
  | { ok: false; reason: "wrong_code" | "not_found" | "expired" | "unreachable" | "unreadable"; message: string; raw?: { body: Uint8Array; type: string } };

async function request(url: string, cookie: string) {
  try {
    return await fetch(url, {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { "User-Agent": UA, Accept: "text/html,image/*,application/pdf;q=0.9", Referer: FORM, ...(cookie ? { Cookie: cookie } : {}) },
    });
  } catch {
    return null;
  }
}

function addCookies(res: Response, jar: Map<string, string>) {
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

function jarFrom(cookie: string) {
  return new Map(cookie.split("; ").filter(Boolean).map((p) => [p.slice(0, p.indexOf("=")), p.slice(p.indexOf("=") + 1)] as [string, string]));
}

const unreachable = "Couldn't reach SNGPL's bill site. Try again in a few minutes, or use Upload bill.";

/** Opens SNGPL's bill form and returns its picture code, plus a token that carries SNGPL's session to the next step. */
export async function startSngpl(): Promise<SngplStart> {
  const jar = new Map<string, string>();
  const page = await request(FORM, "");
  if (!page?.ok) return { ok: false, message: unreachable };
  const html = await page.text();
  const cookie = addCookies(page, jar);
  const form = /<form[^>]*id="frmDomesticConsumNo"[\s\S]*?<\/form>/i.exec(html)?.[0] ?? "";
  if (!form || !/txtCaptcha/.test(form)) return { ok: false, message: "SNGPL's bill page has changed. Use Upload bill instead." };
  const field = (name: string) => new RegExp(`name="${name}"[^>]*value="([^"]*)"`).exec(form)?.[1] ?? "";

  const pic = await request(`${SITE}/captcha-image.jpg?${Date.now()}`, cookie);
  if (!pic?.ok) return { ok: false, message: unreachable };
  const bytes = Buffer.from(await pic.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > 100_000) return { ok: false, message: "SNGPL's picture code didn't load. Try again." };
  const session: Session = { c: addCookies(pic, jar), s: field("as_sfid"), f: field("as_fid"), t: Date.now() };
  return { ok: true, token: Buffer.from(JSON.stringify(session)).toString("base64url"), image: `data:image/jpeg;base64,${bytes.toString("base64")}` };
}

function readToken(token: string): Session | null {
  try {
    const s = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as Session;
    if (typeof s.c !== "string" || typeof s.s !== "string" || typeof s.f !== "string" || typeof s.t !== "number") return null;
    if (s.c.length > 4000 || Date.now() - s.t > TOKEN_AGE) return null;
    return s;
  } catch {
    return null;
  }
}

/** Sends the consumer number and the code the person typed, and reads the bill SNGPL returns. */
export async function finishSngpl(consumer: string, code: string, token: string): Promise<SngplResult> {
  const session = readToken(token);
  if (!session) return { ok: false, reason: "expired", message: "The picture code is too old. Here is a new one." };
  const jar = jarFrom(session.c);
  const q = new URLSearchParams({ proc: "viewbill", contype: "NewCon", mdids: "85", consumer, txtCaptcha: code });
  q.append("proc", "viewbill");
  if (session.s) q.set("as_sfid", session.s);
  if (session.f) q.set("as_fid", session.f);

  let res = await request(`${SITE}/viewbill?${q}`, session.c);
  for (let hop = 0; res && res.status >= 300 && res.status < 400 && hop < 3; hop++) {
    const next = new URL(res.headers.get("location") ?? "/", SITE);
    if (!/(^|\.)sngpl\.com\.pk$/.test(next.hostname) || next.protocol !== "https:") return { ok: false, reason: "unreadable", message: "SNGPL sent the request somewhere unexpected, so it was stopped." };
    res = await request(next.toString(), addCookies(res, jar));
  }
  if (!res) return { ok: false, reason: "unreachable", message: unreachable };
  if (!res.ok) return { ok: false, reason: "unreachable", message: `SNGPL's bill site answered with an error (${res.status}). Try again, or use Upload bill.` };

  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!type.includes("html")) {
    const body = new Uint8Array(await res.arrayBuffer());
    return { ok: false, reason: "unreadable", message: "SNGPL sent the bill in a form the app can't read yet. It has been kept so it can be checked. Use Upload bill for now.", raw: { body: body.slice(0, 5_000_000), type: type || "application/octet-stream" } };
  }
  const html = await res.text();
  const page = readSngplPage(html, consumer);
  if (page.ok) return { ok: true, html, bill: page.bill, site: SITE };
  const why = {
    wrong_code: "The picture code didn't match. Here is a new one.",
    not_found: "SNGPL didn't find a bill for this consumer number. Check the 11 digits.",
    other_consumer: "SNGPL returned a bill for a different consumer number, so it was not saved.",
    unreadable: "SNGPL's reply couldn't be read yet. It has been kept so it can be checked. Use Upload bill for now.",
  };
  const reason = page.reason === "other_consumer" ? "unreadable" : page.reason;
  return { ok: false, reason, message: why[page.reason], ...(page.reason === "unreadable" ? { raw: { body: new TextEncoder().encode(html), type: "text/html" } } : {}) };
}
