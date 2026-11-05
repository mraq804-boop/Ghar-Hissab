import { describe, expect, it } from "vitest";
import { daysOfMonth, generateRoster, mealCounts, menuWeek, menuWeekday, weekOf } from "@/lib/kitchen";
import { text } from "@/server/excel/layout";

describe("duty roster generator", () => {
  const days = daysOfMonth(2026, 10);

  it("covers three meals every day with two people on duty", () => {
    const r = generateRoster(["P1", "P2", "P3"], days);
    expect(r).toHaveLength(31);
    for (const d of r) {
      const cooks = new Set([d.breakfast, d.lunch, d.dinner]);
      expect(cooks.size).toBe(2);
      expect(cooks.has(d.off)).toBe(false);
    }
  });

  it("rotates pairs so each person is off roughly every third day", () => {
    const r = generateRoster(["P1", "P2", "P3"], days.slice(0, 30));
    const offs = new Map<string, number>();
    for (const d of r) offs.set(d.off!, (offs.get(d.off!) ?? 0) + 1);
    expect([...offs.values()]).toEqual([10, 10, 10]);
    const counts = mealCounts(r);
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(90);
    for (const c of counts.values()) expect(c).toBe(30);
  });

  it("lets two people cover everything while the third is away, like October", () => {
    const r = generateRoster(["P1", "P2", "P3"], days, (d) => (d <= "2026-10-17" ? ["P3"] : []));
    const early = r.filter((d) => d.day <= "2026-10-17");
    for (const d of early) {
      expect(d.off).toBe("P3");
      expect([d.breakfast, d.lunch, d.dinner]).not.toContain("P3");
    }
    expect(r.find((d) => d.day === "2026-10-18")?.off).not.toBeNull();
  });
});

describe("excel text escaping", () => {
  it("never lets user text become a formula", () => {
    expect(text("=HYPERLINK(\"http://x\")")).toBe("'=HYPERLINK(\"http://x\")");
    expect(text("+92 300")).toBe("'+92 300");
    expect(text("-5")).toBe("'-5");
    expect(text("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(text("Oil")).toBe("Oil");
    expect(text(null)).toBe("");
  });
});

describe("printable week", () => {
  it("lists Monday to Sunday around any day, across month ends", () => {
    expect(weekOf("2026-11-04")).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);
    expect(weekOf("2026-11-02")[0]).toBe("2026-11-02");
    expect(weekOf("2026-11-08")[0]).toBe("2026-11-02");
    expect(weekOf("2026-12-31")).toEqual(["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03"]);
  });

  it("uses menu week 1 for days 1-7, 2 for 8-14, 3 for 15-21 and 4 from the 22nd", () => {
    expect(["2026-11-01", "2026-11-07", "2026-11-08", "2026-11-14", "2026-11-15", "2026-11-21", "2026-11-22", "2026-11-30"].map(menuWeek)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it("numbers weekdays Monday 1 to Sunday 7 like the menu", () => {
    expect(["2026-11-02", "2026-11-07", "2026-11-08"].map(menuWeekday)).toEqual([1, 6, 7]);
  });
});
