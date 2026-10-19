import type { ExpenseInput, SplitSpec, UnitRef } from "@/lib/finance";

export const UNITS: UnitRef[] = [
  { id: "aq", code: "AQ", sortOrder: 1 },
  { id: "ak", code: "AK", sortOrder: 2 },
  { id: "ab", code: "AB", sortOrder: 3 },
];

export const POOL3: SplitSpec = { type: "equal_units", unitIds: ["aq", "ak", "ab"] };
export const WAPDA: SplitSpec = { type: "equal_units", unitIds: ["ak", "ab"] };
export const SARF: SplitSpec = {
  type: "weights",
  parts: [
    { unitId: "aq", num: 4, den: 9 },
    { unitId: "ak", num: 4, den: 9 },
    { unitId: "ab", num: 1, den: 9 },
  ],
};
export const NONE: SplitSpec = { type: "none" };

const rs = (n: number | null) => (n === null ? null : BigInt(Math.round(n * 100)));

type Row = [section: string, title: string, amount: number | null, split: SplitSpec];

const rows: Row[] = [
  ["SHARED", "Garam Masala", 600, POOL3],
  ["SHARED", "Bonus", 260, POOL3],
  ["SHARED", "Maachis", 100, POOL3],
  ["SHARED", "Bottle", 670, POOL3],
  ["SHARED", "Tea", 1000, POOL3],
  ["SHARED", "Max", 570, POOL3],
  ["SHARED", "Capri", 450, POOL3],
  ["SHARED", "Sarf", 2600, SARF],
  ["SHARED", "Dhaniya", 200, POOL3],
  ["SHARED", "Jeera", 200, POOL3],
  ["SHARED", "Mungi Masal Daal", 400, POOL3],
  ["SHARED", "Dhada Mirchi", 200, POOL3],
  ["SHARED", "Kale Chane", 280, POOL3],
  ["SHARED", "Massar", 320, POOL3],
  ["SHARED", "Colgate", 330, POOL3],
  ["SHARED", "Kali Mirch", 420, POOL3],
  ["SHARED", "Baddi Lachi", 300, POOL3],
  ["SHARED", "Chotilachi", 300, POOL3],
  ["SHARED", "Chini", 700, POOL3],
  ["SHARED", "Oil", 9000, POOL3],
  ["SHARED", "Chawal", 4800, POOL3],
  ["NOT_SHARED", "Pamper", 2350, NONE],
  ["NOT_SHARED", "Shampoo", 900, NONE],
  ["NOT_SHARED", "Hair Spray", 480, NONE],
  ["NOT_SHARED", "Tissue", 780, NONE],
  ["NOT_SHARED", "Capri", 450, NONE],
  ["MILK_MEAT", "Milk", 12000, POOL3],
  ["MILK_MEAT", "Sabzi (vegetables)", 10000, POOL3],
  ["MILK_MEAT", "Chicken", 10500, POOL3],
  ["MILK_MEAT", "Mutton", 10400, POOL3],
  ["MILK_MEAT", "Keema", 5600, POOL3],
  ["HOUSE_HELP", "Maid", 8000, POOL3],
  ["BILLS", "Wapda (electricity)", null, WAPDA],
  ["BILLS", "Gas", null, POOL3],
  ["BILLS", "Water", null, POOL3],
  ["BILLS", "Internet", 2200, POOL3],
];

export const OCTOBER_EXPENSES: (ExpenseInput & { section: string; title: string })[] = rows.map(
  ([section, title, amount, split], i) => ({
    id: `e${i + 1}`,
    section,
    title,
    amountPaisa: rs(amount),
    split,
  }),
);

export const OCTOBER_PAYMENTS = [
  { unitId: "aq", amountPaisa: 2_790_000n },
  { unitId: "ak", amountPaisa: 1_900_000n },
];
