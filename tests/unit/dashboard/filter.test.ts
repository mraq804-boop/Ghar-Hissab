import { describe, expect, it } from "vitest";
import { inSelection, kindTotals, resolveSelection, selectionParams, type FilterCategory } from "@/lib/dashboard/filter";

const cats: FilterCategory[] = [
  { id: "groc", name: "Groceries", kind: "essential", active: true },
  { id: "wapda", name: "Electricity (Wapda)", kind: "essential", active: true },
  { id: "milk", name: "Milk", kind: "variable", active: true },
  { id: "meat", name: "Chicken & meat", kind: "variable", active: true },
  { id: "veg", name: "Vegetables (Sabzi)", kind: "variable", active: true },
];
const rs = (n: number) => BigInt(n) * 100n;

describe("resolveSelection", () => {
  it("shows everything by default and for unknown ids", () => {
    expect(resolveSelection(cats, {})).toMatchObject({ ids: null, label: "All categories" });
    expect(resolveSelection(cats, { cats: "nope" }).ids).toBeNull();
  });

  it("selects a whole group", () => {
    const s = resolveSelection(cats, { group: "variable" });
    expect([...s.ids!]).toEqual(["milk", "meat", "veg"]);
    expect(s).toMatchObject({ group: "variable", label: "Daily food", names: ["Milk", "Chicken & meat", "Vegetables (Sabzi)"] });
  });

  it("selects several categories, and still reads the old single-category links", () => {
    expect(resolveSelection(cats, { cats: "milk,meat" })).toMatchObject({ label: "Milk + Chicken & meat" });
    expect(resolveSelection(cats, { cats: "milk,meat,groc" }).label).toBe("3 categories");
    expect(resolveSelection(cats, { cat: "wapda" }).label).toBe("Electricity (Wapda)");
  });

  it("tests membership", () => {
    const s = resolveSelection(cats, { group: "essential" });
    expect([inSelection(s, "groc"), inSelection(s, "milk"), inSelection(s, null)]).toEqual([true, false, false]);
    expect(inSelection(resolveSelection(cats, {}), null)).toBe(true);
  });
});

describe("selectionParams", () => {
  it("turns a chosen set into the shortest address", () => {
    expect(selectionParams(cats, [])).toEqual({});
    expect(selectionParams(cats, cats.map((c) => c.id))).toEqual({});
    expect(selectionParams(cats, ["veg", "milk", "meat"])).toEqual({ group: "variable" });
    expect(selectionParams(cats, ["milk", "groc"])).toEqual({ cats: "milk,groc" });
  });
});

describe("kindTotals", () => {
  it("adds shared amounts by group, skipping personal items and bills not issued", () => {
    expect(
      kindTotals(
        [
          { categoryId: "groc", amountPaisa: rs(23700), shared: true },
          { categoryId: "milk", amountPaisa: rs(12000), shared: true },
          { categoryId: "meat", amountPaisa: rs(26500), shared: true },
          { categoryId: "wapda", amountPaisa: null, shared: true },
          { categoryId: null, amountPaisa: rs(4960), shared: false },
        ],
        cats,
      ),
    ).toEqual({ essential: rs(23700), variable: rs(38500) });
  });
});
