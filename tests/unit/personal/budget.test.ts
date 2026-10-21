import { describe, expect, it } from "vitest";
import { budgetStatus, daysIn, DEFAULT_PERSONAL_CATEGORIES, guessPersonalCategory } from "@/lib/personal/budget";

describe("budgetStatus", () => {
  it("is fine well under budget", () => {
    expect(budgetStatus(5000, 20000, 20, 31)).toMatchObject({ state: "ok", left: 15000, percent: 25 });
  });

  it("warns when spending is on pace to go over", () => {
    expect(budgetStatus(10000, 20000, 10, 31)).toMatchObject({ state: "pace", projected: 31000 });
  });

  it("warns near the limit and when over", () => {
    expect(budgetStatus(16500, 20000, 25, 31).state).toBe("near");
    expect(budgetStatus(21000, 20000, null, 31)).toMatchObject({ state: "over", left: 0, percent: 105, projected: null });
  });

  it("doesn't project from the first few days", () => {
    expect(budgetStatus(3000, 20000, 2, 31)).toMatchObject({ state: "ok", projected: null });
  });

  it("knows month lengths", () => {
    expect([daysIn("2026-02"), daysIn("2028-02"), daysIn("2026-10")]).toEqual([28, 29, 31]);
  });
});

describe("guessPersonalCategory", () => {
  it("learns from the person's own earlier notes first", () => {
    const history = [{ note: "Shell petrol pump", categoryName: "Car" }];
    expect(guessPersonalCategory("petrol 3000", history, [...DEFAULT_PERSONAL_CATEGORIES, "Car"])).toBe("Car");
  });

  it("falls back to common words, in English or Roman Urdu", () => {
    expect(guessPersonalCategory("petrol 3000", [], DEFAULT_PERSONAL_CATEGORIES)).toBe("Fuel");
    expect(guessPersonalCategory("dawai 850", [], DEFAULT_PERSONAL_CATEGORIES)).toBe("Medicine");
    expect(guessPersonalCategory("jazz load 500", [], DEFAULT_PERSONAL_CATEGORIES)).toBe("Mobile & internet");
    expect(guessPersonalCategory("xyz 100", [], DEFAULT_PERSONAL_CATEGORIES)).toBeNull();
  });
});
