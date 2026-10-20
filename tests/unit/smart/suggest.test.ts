import { describe, expect, it } from "vitest";
import { parseQuickEntry, suggestExpense, type CategoryLite, type HistoryItem } from "@/lib/smart/suggest";

const categories: CategoryLite[] = [
  { id: "groc", name: "Groceries", section_id: "shared", default_split_rule_id: "pool3", active: true },
  { id: "milk", name: "Milk", section_id: "milkmeat", default_split_rule_id: "pool3", active: true },
  { id: "meat", name: "Chicken & meat", section_id: "milkmeat", default_split_rule_id: "pool3", active: true },
  { id: "veg", name: "Vegetables (Sabzi)", section_id: "milkmeat", default_split_rule_id: "pool3", active: true },
  { id: "wapda", name: "Electricity (Wapda)", section_id: "bills", default_split_rule_id: "two", active: true },
];

const h = (over: Partial<HistoryItem> & { title: string }): HistoryItem => ({
  categoryId: "groc",
  sectionId: "shared",
  splitRuleId: "pool3",
  splitOverride: null,
  amount: "1000",
  rate: null,
  qtyNum: null,
  qtyText: null,
  periodLabel: "Oct 2026",
  ...over,
});

const history: HistoryItem[] = [
  h({ title: "Chicken", categoryId: "meat", sectionId: "milkmeat", amount: "10500", rate: "500", qtyNum: "21" }),
  h({ title: "Milk", categoryId: "milk", sectionId: "milkmeat", amount: "12000" }),
  h({ title: "Wapda (electricity)", categoryId: "wapda", sectionId: "bills", splitRuleId: "two", amount: "10575" }),
  h({ title: "Chini", amount: "700" }),
  h({ title: "Sarf", splitRuleId: "sarf", amount: "2600" }),
];

describe("parseQuickEntry", () => {
  it("reads a quantity in kg or grams", () => {
    expect(parseQuickEntry("chicken 2kg")).toEqual({ name: "Chicken", qty: "2", qtyLabel: "2 Kg", amount: null });
    expect(parseQuickEntry("keema 500 g")).toMatchObject({ name: "Keema", qty: "0.5" });
  });

  it("reads an amount", () => {
    expect(parseQuickEntry("doodh 3,000")).toMatchObject({ name: "Doodh", amount: "3000", qty: null });
    expect(parseQuickEntry("Rs 450 Capri")).toMatchObject({ name: "Capri", amount: "450" });
  });

  it("understands spoken amounts", () => {
    expect(parseQuickEntry("doodh 12 hazaar")).toMatchObject({ name: "Doodh", amount: "12000" });
    expect(parseQuickEntry("milk 12 thousand rupees")).toMatchObject({ name: "Milk", amount: "12000" });
    expect(parseQuickEntry("oil ₹9,000")).toMatchObject({ name: "Oil", amount: "9000" });
    expect(parseQuickEntry("maid 8k")).toMatchObject({ name: "Maid", amount: "8000" });
    expect(parseQuickEntry("chicken 2 kg")).toMatchObject({ qty: "2", amount: null });
  });

  it("keeps the name as typed when it has capitals", () => {
    expect(parseQuickEntry("Garam Masala").name).toBe("Garam Masala");
  });
});

describe("suggestExpense", () => {
  it("reuses the last rate for a kg-priced item", () => {
    const s = suggestExpense("chicken 3 kg", history, categories);
    expect(s).toMatchObject({ source: "history", title: "Chicken", categoryId: "meat", pricing: "rate", qty: "3", rate: "500" });
  });

  it("understands Roman Urdu names", () => {
    expect(suggestExpense("doodh 12000", history, categories)).toMatchObject({ title: "Milk", categoryId: "milk", pricing: "amount", amount: "12000" });
    expect(suggestExpense("bijli", history, categories)).toMatchObject({ categoryId: "wapda", splitRuleId: "two" });
    expect(suggestExpense("surf", history, categories)).toMatchObject({ splitRuleId: "sarf" });
  });

  it("tolerates small typing mistakes and uses the name already in the ledger", () => {
    expect(suggestExpense("chiken 2kg", history, categories)).toMatchObject({ title: "Chicken", categoryId: "meat", qty: "2" });
    expect(suggestExpense("bijli", history, categories)?.title).toBe("Wapda (electricity)");
  });

  it("falls back to a category when the item is new", () => {
    expect(suggestExpense("aloo 2kg", history, categories)).toMatchObject({ source: "category", categoryId: "veg", title: "Aloo", qtyText: "2 Kg" });
  });

  it("stays quiet when it has no idea", () => {
    expect(suggestExpense("xyz", history, categories)).toBeNull();
    expect(suggestExpense("a", history, categories)).toBeNull();
  });
});
