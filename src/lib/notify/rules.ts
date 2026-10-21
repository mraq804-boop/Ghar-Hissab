/** Pakistan has no daylight saving, so local time is always UTC+5. */
const OFFSET_MS = 5 * 3600_000;

export type Local = { date: string; year: number; month: number; day: number; hour: number; minute: number; weekday: number };

export function karachi(at: Date): Local {
  const t = new Date(at.getTime() + OFFSET_MS);
  return {
    date: t.toISOString().slice(0, 10),
    year: t.getUTCFullYear(),
    month: t.getUTCMonth() + 1,
    day: t.getUTCDate(),
    hour: t.getUTCHours(),
    minute: t.getUTCMinutes(),
    weekday: t.getUTCDay(),
  };
}

/** A Karachi wall-clock date and time as a real instant. */
export function karachiInstant(date: string, time: string): Date {
  return new Date(Date.parse(`${date}T${time.length === 5 ? `${time}:00` : time}Z`) - OFFSET_MS);
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};

/**
 * When a notification created at `now` may ring, given the person's quiet hours (Karachi time).
 * Inside quiet hours it waits until they end; otherwise it goes now.
 */
export function deliverAfter(now: Date, quietStart: string, quietEnd: string): Date {
  const start = minutes(quietStart);
  const end = minutes(quietEnd);
  if (start === end) return now;
  const local = karachi(now);
  const current = local.hour * 60 + local.minute;
  const quiet = start < end ? current >= start && current < end : current >= start || current < end;
  if (!quiet) return now;
  const endTime = `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
  const today = karachiInstant(local.date, endTime);
  return today.getTime() > now.getTime() ? today : new Date(today.getTime() + 86_400_000);
}

/** The next time a repeating reminder rings after `at`, or null when it doesn't repeat. */
export function nextOccurrence(at: Date, repeat: "none" | "daily" | "weekly" | "monthly"): Date | null {
  if (repeat === "none") return null;
  if (repeat === "daily") return new Date(at.getTime() + 86_400_000);
  if (repeat === "weekly") return new Date(at.getTime() + 7 * 86_400_000);
  const local = new Date(at.getTime() + OFFSET_MS);
  const day = local.getUTCDate();
  const target = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1, local.getUTCHours(), local.getUTCMinutes()));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return new Date(target.getTime() - OFFSET_MS);
}

/** Moves a reminder's time forward past `now`, so a missed repeat doesn't fire many times at once. */
export function advancePast(at: Date, repeat: "none" | "daily" | "weekly" | "monthly", now: Date): Date | null {
  let next = nextOccurrence(at, repeat);
  for (let i = 0; next && next.getTime() <= now.getTime() && i < 400; i++) next = nextOccurrence(next, repeat);
  return next;
}

export function daysBetween(fromDate: string, toDate: string) {
  return Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000);
}

/** Week key such as 2026-W43 (weeks start Monday), for "at most once a week" messages. */
export function weekKey(local: Local) {
  const d = new Date(Date.UTC(local.year, local.month - 1, local.day));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export type Schedule = {
  pendingDigest: boolean;
  billDueCheck: boolean;
  meterReminder: boolean;
  owedReminder: boolean;
  monthStart: boolean;
  weeklySummary: boolean;
};

/** Which daily or weekly messages are due at this run. Each one is also de-duplicated by key. */
export function scheduleAt(local: Local): Schedule {
  return {
    pendingDigest: local.hour >= 9,
    billDueCheck: local.hour >= 9,
    meterReminder: local.weekday === 6 && local.hour >= 10,
    owedReminder: (local.day === 25 || local.day === 1) && local.hour >= 10,
    monthStart: local.day === 1 && local.hour >= 9,
    weeklySummary: local.weekday === 0 && local.hour >= 19,
  };
}
