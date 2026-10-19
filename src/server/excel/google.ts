import "server-only";

export const SCOPES = "openid email https://www.googleapis.com/auth/spreadsheets";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";

export class SheetsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason: string | null,
    readonly retryAfterMs: number | null,
  ) {
    super(message);
  }

  get retryable() {
    return (
      this.status === 0 ||
      this.status === 408 ||
      this.status === 429 ||
      this.status >= 500 ||
      (this.status === 403 && /rate|quota/i.test(this.reason ?? ""))
    );
  }
}

export type TokenSet = { accessToken: string; refreshToken: string | null; email: string | null };

export async function exchangeGoogleToken(
  params: Record<string, string>,
  cfg: { clientId: string; clientSecret: string },
  fetchImpl: typeof fetch = fetch,
): Promise<TokenSet> {
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...params }),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const reason = typeof json.error === "string" ? json.error : null;
    throw new SheetsError(`Google sign-in failed: ${reason ?? res.status}`, res.status === 400 ? 401 : res.status, reason, null);
  }
  return {
    accessToken: String(json.access_token),
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : null,
    email: emailFromIdToken(json.id_token),
  };
}

function emailFromIdToken(token: unknown): string | null {
  if (typeof token !== "string") return null;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function backoff(attempt: number) {
  const base = Math.min(30_000, 500 * 2 ** attempt);
  return base / 2 + Math.random() * (base / 2);
}

export type SheetInfo = { sheetId: number; title: string; rowCount: number; columnCount: number };

export class SheetsClient {
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  calls = 0;

  constructor(opts: { accessToken: string; fetchImpl?: typeof fetch; maxRetries?: number; sleepImpl?: (ms: number) => Promise<void> }) {
    this.token = opts.accessToken;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxRetries = opts.maxRetries ?? 4;
    this.sleep = opts.sleepImpl ?? sleep;
  }

  private readonly token: string;

  async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      this.calls++;
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method,
          headers: { authorization: `Bearer ${this.token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch (e) {
        const err = new SheetsError(`Network error talking to Google: ${(e as Error).message}`, 0, "network", null);
        if (attempt < this.maxRetries) {
          await this.sleep(backoff(attempt + 1));
          continue;
        }
        throw err;
      }
      const text = await res.text();
      const json = text ? safeJson(text) : undefined;
      if (res.ok) return json as T;
      const e = (json as { error?: { message?: string; status?: string; errors?: { reason?: string }[] } })?.error;
      const reason = e?.errors?.[0]?.reason ?? e?.status ?? null;
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      const err = new SheetsError(e?.message ?? `Google Sheets request failed with ${res.status}`, res.status, reason, retryAfter);
      if (err.retryable && attempt < this.maxRetries) {
        await this.sleep(retryAfter ?? backoff(attempt + 1));
        continue;
      }
      throw err;
    }
  }

  async spreadsheet(id: string) {
    const res = await this.request<{
      properties: { title: string };
      spreadsheetUrl: string;
      sheets: { properties: { sheetId: number; title: string; gridProperties?: { rowCount?: number; columnCount?: number } } }[];
    }>("GET", `${SHEETS}/${encodeURIComponent(id)}?fields=properties.title,spreadsheetUrl,sheets.properties(sheetId,title,gridProperties)`);
    return {
      title: res.properties.title,
      url: res.spreadsheetUrl,
      sheets: res.sheets.map((s) => ({
        sheetId: s.properties.sheetId,
        title: s.properties.title,
        rowCount: s.properties.gridProperties?.rowCount ?? 1000,
        columnCount: s.properties.gridProperties?.columnCount ?? 26,
      })) as SheetInfo[],
    };
  }

  async batchUpdate(id: string, requests: unknown[]) {
    if (!requests.length) return { replies: [] as unknown[] };
    return this.request<{ replies: unknown[] }>("POST", `${SHEETS}/${encodeURIComponent(id)}:batchUpdate`, { requests });
  }

  async getValues(id: string, ranges: string[]): Promise<unknown[][][]> {
    const qs = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join("&");
    const res = await this.request<{ valueRanges: { values?: unknown[][] }[] }>(
      "GET",
      `${SHEETS}/${encodeURIComponent(id)}/values:batchGet?${qs}&valueRenderOption=UNFORMATTED_VALUE`,
    );
    return res.valueRanges.map((v) => v.values ?? []);
  }
}

export function a1(title: string, range: string) {
  return `'${title.replace(/'/g, "''")}'!${range}`;
}

export function spreadsheetIdFromUrl(input: string): string | null {
  const trimmed = input.trim();
  const m = /\/spreadsheets\/d\/([a-zA-Z0-9-_]{20,})/.exec(trimmed);
  if (m) return m[1];
  return /^[a-zA-Z0-9-_]{20,}$/.test(trimmed) ? trimmed : null;
}

function parseRetryAfter(v: string | null): number | null {
  if (!v) return null;
  const s = Number(v);
  return Number.isFinite(s) ? Math.min(120_000, s * 1000) : null;
}

function safeJson(t: string) {
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}
