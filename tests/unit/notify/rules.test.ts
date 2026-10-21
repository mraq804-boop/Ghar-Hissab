import { describe, expect, it } from "vitest";
import { advancePast, daysBetween, deliverAfter, karachi, karachiInstant, nextOccurrence, scheduleAt, weekKey } from "@/lib/notify/rules";

const at = (iso: string) => new Date(iso);

describe("Karachi time", () => {
  it("is UTC+5", () => {
    expect(karachi(at("2026-10-21T20:30:00Z"))).toMatchObject({ date: "2026-10-22", hour: 1, minute: 30, weekday: 4 });
    expect(karachiInstant("2026-10-22", "08:00").toISOString()).toBe("2026-10-22T03:00:00.000Z");
  });
});

describe("deliverAfter", () => {
  it("sends straight away outside quiet hours", () => {
    const now = at("2026-10-21T10:00:00Z");
    expect(deliverAfter(now, "22:00", "08:00")).toBe(now);
  });

  it("holds late-night messages until 8 AM", () => {
    expect(deliverAfter(at("2026-10-21T18:30:00Z"), "22:00", "08:00").toISOString()).toBe("2026-10-22T03:00:00.000Z");
    expect(deliverAfter(at("2026-10-21T22:00:00Z"), "22:00", "08:00").toISOString()).toBe("2026-10-22T03:00:00.000Z");
  });

  it("handles quiet hours inside one day and none at all", () => {
    expect(deliverAfter(at("2026-10-21T09:00:00Z"), "13:00", "15:00").toISOString()).toBe("2026-10-21T10:00:00.000Z");
    const now = at("2026-10-21T20:00:00Z");
    expect(deliverAfter(now, "00:00", "00:00")).toBe(now);
  });
});

describe("repeating reminders", () => {
  it("moves daily, weekly and monthly reminders on", () => {
    const first = karachiInstant("2026-01-31", "09:00");
    expect(nextOccurrence(first, "none")).toBeNull();
    expect(karachi(nextOccurrence(first, "daily")!).date).toBe("2026-02-01");
    expect(karachi(nextOccurrence(first, "weekly")!).date).toBe("2026-02-07");
    const feb = nextOccurrence(first, "monthly")!;
    expect(karachi(feb)).toMatchObject({ date: "2026-02-28", hour: 9 });
  });

  it("skips past missed repeats instead of firing many at once", () => {
    const old = karachiInstant("2026-10-01", "09:00");
    expect(karachi(advancePast(old, "daily", karachiInstant("2026-10-21", "10:00"))!).date).toBe("2026-10-22");
  });
});

describe("schedule", () => {
  it("knows when each regular message is due", () => {
    expect(scheduleAt(karachi(karachiInstant("2026-10-25", "10:15")))).toMatchObject({ owedReminder: true, weeklySummary: false, pendingDigest: true });
    expect(scheduleAt(karachi(karachiInstant("2026-10-25", "19:00")))).toMatchObject({ weeklySummary: true });
    expect(scheduleAt(karachi(karachiInstant("2026-11-01", "09:00")))).toMatchObject({ monthStart: true, owedReminder: false });
    expect(scheduleAt(karachi(karachiInstant("2026-10-24", "10:30")))).toMatchObject({ meterReminder: true });
    expect(scheduleAt(karachi(karachiInstant("2026-10-24", "07:30")))).toMatchObject({ pendingDigest: false, meterReminder: false });
  });

  it("counts days and names weeks", () => {
    expect(daysBetween("2026-10-20", "2026-10-22")).toBe(2);
    expect(weekKey(karachi(karachiInstant("2026-10-21", "12:00")))).toBe("2026-W43");
  });
});
