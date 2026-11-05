import { describe, expect, it } from "vitest";
import { formatKg, needsFor, shoppingCategory, shoppingList } from "@/lib/shopping";

describe("shoppingCategory", () => {
  const cats = [
    { name: "Groceries", active: true },
    { name: "Vegetables (Sabzi)", active: true },
    { name: "Chicken & meat", active: true },
  ];
  it("puts sabzi in vegetables and meat, chicken and fish in chicken & meat", () => {
    expect(shoppingCategory("Sabzi", cats)?.name).toBe("Vegetables (Sabzi)");
    expect(shoppingCategory("Fish", cats)?.name).toBe("Chicken & meat");
    expect(shoppingCategory("Meat", cats)?.name).toBe("Chicken & meat");
    expect(shoppingCategory("Chicken", [{ name: "Chicken & meat", active: false }])).toBeUndefined();
  });
});

describe("needsFor", () => {
  it("reads meat, chicken and fish dishes", () => {
    expect(needsFor("Fish Fry", "Chicken / Fish")).toEqual([{ group: "Fish", item: "Fish", kg: 2.5 }]);
    expect(needsFor("Mutton Karahi", "Mutton / Keema")).toEqual([{ group: "Meat", item: "Mutton", kg: 3 }]);
    expect(needsFor("Chicken Handi", "Chicken / Fish")).toEqual([{ group: "Chicken", item: "Chicken", kg: 3 }]);
    expect(needsFor("Mutton Yakhni Pulao", "Chawal")).toEqual([{ group: "Meat", item: "Mutton", kg: 3 }]);
    expect(needsFor("Yakhni Pulao", "Chawal")).toEqual([{ group: "Chicken", item: "Chicken", kg: 2.5 }]);
  });

  it("splits mixed dishes into meat and sabzi", () => {
    expect(needsFor("Keema Matar", "Mutton / Keema")).toEqual([
      { group: "Meat", item: "Keema (mutton)", kg: 2 },
      { group: "Sabzi", item: "Matar", kg: 1 },
    ]);
    expect(needsFor("Sabzi (seasonal) + Chicken", "Sabzi + Chicken")).toEqual([
      { group: "Chicken", item: "Chicken", kg: 1.5 },
      { group: "Sabzi", item: "Seasonal sabzi", kg: 2 },
    ]);
    expect(needsFor("Chinese Biryani", "Chawal (Biryani)").map((n) => n.group)).toEqual(["Chicken", "Sabzi"]);
  });

  it("uses a named sabzi as the item and skips daal", () => {
    expect(needsFor("Bhindi Masala", "Sabzi")).toEqual([{ group: "Sabzi", item: "Bhindi Masala", kg: 3 }]);
    expect(needsFor("Daal Mung", "Daal")).toEqual([]);
    expect(needsFor("", "Sabzi")).toEqual([]);
  });
});

describe("shoppingList", () => {
  const week = [
    { day: "2026-11-09", dish: "Sabzi (seasonal) + Chicken", category: "Sabzi + Chicken" },
    { day: "2026-11-12", dish: "Sabzi (seasonal)", category: "Sabzi" },
    { day: "2026-11-14", dish: "Fish Masala", category: "Chicken / Fish" },
    { day: "2026-11-15", dish: "Sabzi Biryani", category: "Chawal (Biryani)" },
  ];

  it("adds the week up and keeps the days", () => {
    expect(shoppingList(week)).toEqual([
      { group: "Chicken", item: "Chicken", kg: 1.5, days: ["2026-11-09"] },
      { group: "Fish", item: "Fish", kg: 2.5, days: ["2026-11-14"] },
      { group: "Sabzi", item: "Seasonal sabzi", kg: 5, days: ["2026-11-09", "2026-11-12"] },
      { group: "Sabzi", item: "Mix sabzi", kg: 3, days: ["2026-11-15"] },
    ]);
  });

  it("scales to the number of people in quarter kilos", () => {
    expect(shoppingList(week, 6).find((r) => r.item === "Fish")?.kg).toBe(1.25);
    expect(formatKg(1.25)).toBe("1.25 kg");
    expect(formatKg(2.5)).toBe("2.5 kg");
    expect(formatKg(3)).toBe("3 kg");
  });
});
