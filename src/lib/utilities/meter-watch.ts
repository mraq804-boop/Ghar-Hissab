export type MeterLevel = "none" | "ok" | "watch" | "over";

export type MeterWatch = {
  level: MeterLevel;
  limit: number;
  baseline: number;
  baselineDate: string;
  nextReadingDate: string;
  latest: number | null;
  latestAt: string | null;
  used: number | null;
  perDay: number | null;
  projected: number | null;
  daysLeft: number;
  allowancePerDay: number | null;
  stale: boolean;
  problem: "below_baseline" | null;
};

const DAY = 86_400_000;
const toDay = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The reading date one month after `date`, kept on the same day of the month where possible. */
export function nextReadingDate(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return iso(Date.UTC(y, m, Math.min(d, last)));
}

/**
 * Where a meter stands in its billing cycle. `baseline` is LESCO's present reading on the latest bill,
 * `readings` are the family's readings (any order) and `now` is an ISO timestamp.
 */
export function meterWatch(input: {
  baseline: number;
  baselineDate: string;
  nextReadingDate?: string | null;
  readings: { reading: number; readAt: string }[];
  limit: number;
  now: string;
}): MeterWatch {
  const next = input.nextReadingDate ?? nextReadingDate(input.baselineDate);
  const start = toDay(input.baselineDate);
  const end = toDay(next);
  const nowMs = Date.parse(input.now);
  const daysLeft = Math.max(0, Math.ceil((end - nowMs) / DAY));
  const inCycle = input.readings.filter((r) => Date.parse(r.readAt) >= start).sort((a, b) => Date.parse(b.readAt) - Date.parse(a.readAt));
  const latest = inCycle[0] ?? null;

  const base: MeterWatch = {
    level: "none",
    limit: input.limit,
    baseline: input.baseline,
    baselineDate: input.baselineDate,
    nextReadingDate: next,
    latest: latest?.reading ?? null,
    latestAt: latest?.readAt ?? null,
    used: null,
    perDay: null,
    projected: null,
    daysLeft,
    allowancePerDay: null,
    stale: !latest || nowMs - Date.parse(latest.readAt) > 7 * DAY,
    problem: null,
  };
  if (!latest) return base;
  if (latest.reading < input.baseline) return { ...base, problem: "below_baseline" };

  const used = latest.reading - input.baseline;
  const elapsedDays = Math.max(0, (Date.parse(latest.readAt) - start) / DAY);
  const remainingAfterReading = Math.max(0, (end - Date.parse(latest.readAt)) / DAY);
  const perDay = elapsedDays >= 2 ? used / elapsedDays : null;
  const projected = perDay !== null ? Math.round(used + perDay * remainingAfterReading) : null;
  const allowancePerDay = remainingAfterReading >= 1 ? Math.max(0, (input.limit - 1 - used) / remainingAfterReading) : null;

  let level: MeterLevel = "ok";
  if (used >= input.limit || (projected !== null && projected >= input.limit)) level = "over";
  else if (used >= input.limit * 0.8 || (projected !== null && projected >= input.limit * 0.85)) level = "watch";

  return {
    ...base,
    used,
    perDay: perDay === null ? null : Math.round(perDay * 10) / 10,
    projected,
    allowancePerDay: allowancePerDay === null ? null : Math.floor(allowancePerDay * 10) / 10,
    level,
  };
}

/** Picks the meter number out of text read from a photo: the longest run of digits (4 to 7 long). */
export function readMeterDigits(text: string): number | null {
  const runs = (text.replace(/[oO]/g, "0").replace(/[lI|]/g, "1").match(/\d[\d\s]{2,9}\d/g) ?? [])
    .map((r) => r.replace(/\s/g, ""))
    .filter((r) => r.length >= 4 && r.length <= 7);
  if (!runs.length) return null;
  runs.sort((a, b) => b.length - a.length);
  return Number(runs[0]);
}
