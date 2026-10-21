import { describe, expect, it } from "vitest";
import { meterWatch, nextReadingDate, readMeterDigits } from "@/lib/utilities/meter-watch";

const base = { baseline: 841, baselineDate: "2026-10-09", limit: 200 };

describe("nextReadingDate", () => {
  it("moves one month on, keeping the day where it exists", () => {
    expect(nextReadingDate("2026-10-09")).toBe("2026-11-09");
    expect(nextReadingDate("2026-01-31")).toBe("2026-02-28");
    expect(nextReadingDate("2026-12-15")).toBe("2027-01-15");
  });
});

describe("meterWatch", () => {
  it("has nothing to say before the first reading, and asks for one", () => {
    const w = meterWatch({ ...base, readings: [], now: "2026-10-21T08:00:00Z" });
    expect(w).toMatchObject({ level: "none", used: null, stale: true, nextReadingDate: "2026-11-09", daysLeft: 19 });
  });

  it("projects a normal month and gives a daily allowance", () => {
    const w = meterWatch({ ...base, readings: [{ reading: 901, readAt: "2026-10-21T00:00:00Z" }], now: "2026-10-21T08:00:00Z" });
    expect(w).toMatchObject({ level: "ok", used: 60, perDay: 5, projected: 155, allowancePerDay: 7.3, stale: false });
  });

  it("warns when the month is heading over the limit", () => {
    const w = meterWatch({ ...base, readings: [{ reading: 961, readAt: "2026-10-21T00:00:00Z" }], now: "2026-10-21T08:00:00Z" });
    expect(w).toMatchObject({ level: "over", used: 120, perDay: 10, projected: 310, allowancePerDay: 4.1 });
  });

  it("watches when close, uses the newest reading in this cycle, and ignores readings from before the bill", () => {
    const w = meterWatch({
      ...base,
      readings: [
        { reading: 800, readAt: "2026-10-01T00:00:00Z" },
        { reading: 900, readAt: "2026-10-19T00:00:00Z" },
        { reading: 905, readAt: "2026-10-20T00:00:00Z" },
      ],
      now: "2026-10-21T08:00:00Z",
    });
    expect(w).toMatchObject({ latest: 905, used: 64, projected: 180, level: "watch" });
    expect(meterWatch({ ...base, readings: [{ reading: 1010, readAt: "2026-11-01T00:00:00Z" }], now: "2026-11-01T08:00:00Z" }).level).toBe("over");
    expect(meterWatch({ ...base, readings: [{ reading: 1002, readAt: "2026-11-05T00:00:00Z" }], now: "2026-11-05T08:00:00Z" }).level).toBe("watch");
  });

  it("flags a reading below the bill's reading instead of calculating", () => {
    expect(meterWatch({ ...base, readings: [{ reading: 99, readAt: "2026-10-21T00:00:00Z" }], now: "2026-10-21T08:00:00Z" })).toMatchObject({ problem: "below_baseline", used: null });
  });

  it("marks a week-old reading as stale", () => {
    expect(meterWatch({ ...base, readings: [{ reading: 870, readAt: "2026-10-12T00:00:00Z" }], now: "2026-10-21T08:00:00Z" }).stale).toBe(true);
  });
});

describe("readMeterDigits", () => {
  it("finds the meter number in read text", () => {
    expect(readMeterDigits("kWh\n0 0 9 0 1\nS-P 1063693")).toBe(1063693);
    expect(readMeterDigits("00901 kWh")).toBe(901);
    expect(readMeterDigits("O0901")).toBe(901);
    expect(readMeterDigits("no digits")).toBeNull();
  });
});
