export const SECTIONS = [
  { key: "SHARED", title: "Shared", sortOrder: 1 },
  { key: "NOT_SHARED", title: "Not shared", sortOrder: 2 },
  { key: "MILK_MEAT", title: "Milk, sabzi, chicken & meat", sortOrder: 3 },
  { key: "HOUSE_HELP", title: "House help & services", sortOrder: 4 },
  { key: "BILLS", title: "Bills", sortOrder: 5 },
] as const;

export type SectionKey = (typeof SECTIONS)[number]["key"];

export const SECTION_SHEET_TITLES: Record<SectionKey, string> = {
  SHARED: "SHARED",
  NOT_SHARED: "NOT SHARED",
  MILK_MEAT: "MILK, SABZI, CHICKEN & MEAT  (ALL SHARED)",
  HOUSE_HELP: "HOUSE HELP & SERVICES  (SHARED)",
  BILLS: "BILLS",
};

export const SECTION_TOTAL_LABELS: Record<SectionKey, string> = {
  SHARED: "Shared Total:",
  NOT_SHARED: "Not Shared Total:",
  MILK_MEAT: "Milk / Sabzi / Meat Total:",
  HOUSE_HELP: "House Help Total:",
  BILLS: "Bills Total:",
};

export const DEFAULT_UNITS = [
  { code: "AQ", name: "AQ", sortOrder: 1, isPurseHolder: true },
  { code: "AK", name: "AK", sortOrder: 2, isPurseHolder: false },
  { code: "AB", name: "AB", sortOrder: 3, isPurseHolder: false },
];

export const DEFAULT_RULES = [
  {
    key: "POOL3",
    name: "Three-way pool",
    type: "equal_units",
    description: "Equal 3-way between AQ, AK and AB",
    parts: [{ unit: "AQ" }, { unit: "AK" }, { unit: "AB" }],
  },
  {
    key: "WAPDA",
    name: "Two-way (Wapda)",
    type: "equal_units",
    description: "AK + AB only",
    parts: [{ unit: "AK" }, { unit: "AB" }],
  },
  {
    key: "SARF",
    name: "Sarf (special)",
    type: "weights",
    description: "AB 1/9, AQ & AK 4/9 each",
    parts: [
      { unit: "AQ", num: 4, den: 9 },
      { unit: "AK", num: 4, den: 9 },
      { unit: "AB", num: 1, den: 9 },
    ],
  },
  { key: "NONE", name: "Not shared", type: "none", description: "Personal, nobody is charged", parts: [] },
] as const;

export type RuleKey = (typeof DEFAULT_RULES)[number]["key"];

export const DEFAULT_CATEGORIES = [
  { key: "groceries", name: "Groceries", section: "SHARED", rule: "POOL3", icon: "shopping-basket", sortOrder: 1 },
  { key: "detergent", name: "Detergent (Sarf)", section: "SHARED", rule: "SARF", icon: "sparkles", sortOrder: 2 },
  { key: "toiletries", name: "Toiletries", section: "SHARED", rule: "POOL3", icon: "bath", sortOrder: 3 },
  { key: "personal", name: "Personal items", section: "NOT_SHARED", rule: "NONE", icon: "user", sortOrder: 4 },
  { key: "milk", name: "Milk", section: "MILK_MEAT", rule: "POOL3", icon: "milk", sortOrder: 5 },
  { key: "vegetables", name: "Vegetables (Sabzi)", section: "MILK_MEAT", rule: "POOL3", icon: "carrot", sortOrder: 6 },
  { key: "meat", name: "Chicken & meat", section: "MILK_MEAT", rule: "POOL3", icon: "drumstick", sortOrder: 7 },
  { key: "domestic_staff", name: "Domestic staff", section: "HOUSE_HELP", rule: "POOL3", icon: "hand-helping", sortOrder: 8 },
  { key: "electricity", name: "Electricity (Wapda)", section: "BILLS", rule: "WAPDA", icon: "zap", sortOrder: 9 },
  { key: "gas", name: "Gas", section: "BILLS", rule: "POOL3", icon: "flame", sortOrder: 10 },
  { key: "water", name: "Water", section: "BILLS", rule: "POOL3", icon: "droplet", sortOrder: 11 },
  { key: "internet", name: "Internet", section: "BILLS", rule: "POOL3", icon: "wifi", sortOrder: 12 },
  { key: "maintenance", name: "Maintenance & repairs", section: "SHARED", rule: "POOL3", icon: "wrench", sortOrder: 13 },
  { key: "other", name: "Other household", section: "SHARED", rule: "POOL3", icon: "package", sortOrder: 14 },
] as const;

export function bootstrapPayload(name: string) {
  return {
    name,
    units: DEFAULT_UNITS,
    sections: SECTIONS,
    rules: DEFAULT_RULES.map((r) => ({ ...r, isSystem: true })),
    categories: DEFAULT_CATEGORIES,
  };
}
