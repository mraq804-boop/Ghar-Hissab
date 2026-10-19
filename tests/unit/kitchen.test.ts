import { describe, expect, it } from "vitest";
import { daysOfMonth, generateRoster, mealCounts } from "@/lib/kitchen";
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
