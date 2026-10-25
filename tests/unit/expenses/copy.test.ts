import { describe, expect, it } from "vitest";
import { copyTotal, defaultTicks, groupForCopy, type CopyItem } from "@/lib/expenses/copy";

const rs = (n: number) => BigInt(n) * 100n;
const items: CopyItem[] = [
  { id: "atta", title: "Atta", categoryId: "groc", categoryName: "Groceries", qtyText: "20 kg", amountPaisa: rs(3000) },
  { id: "oil", title: "Oil", categoryId: "groc", categoryName: "Groceries", qtyText: "5 L", amountPaisa: rs(2500) },
  { id: "milk", title: "Milk", categoryId: "milk", categoryName: "Milk", qtyText: "120 L", amountPaisa: rs(12000) },
  { id: "wapda", title: "Wapda", categoryId: "bills", categoryName: "Electricity", qtyText: null, amountPaisa: null },
];

describe("groupForCopy", () => {
  it("groups by category, largest first, and marks items already in the new month", () => {
    const groups = groupForCopy(items, [{ title: " atta ", categoryId: "groc" }, { title: "Oil", categoryId: "other" }]);
    expect(groups.map((g) => [g.name, g.totalPaisa])).toEqual([
      ["Milk", rs(12000)],
      ["Groceries", rs(5500)],
      ["Electricity", 0n],
    ]);
    const groceries = groups.find((g) => g.key === "groc")!;
    expect(groceries.items.map((i) => [i.id, i.exists])).toEqual([
      ["atta", true],
      ["oil", false],
    ]);
    expect(defaultTicks(groceries)).toEqual(["oil"]);
  });
});

describe("copyTotal", () => {
  it("adds the chosen amounts, counting bills not issued as zero", () => {
    expect(copyTotal(items, ["atta", "oil", "wapda"])).toBe(rs(5500));
    expect(copyTotal(items, [])).toBe(0n);
  });
});
