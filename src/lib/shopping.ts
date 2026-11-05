export const SHOPPING_GROUPS = ["Meat", "Chicken", "Fish", "Sabzi"] as const;
export type ShoppingGroup = (typeof SHOPPING_GROUPS)[number];
export type Need = { group: ShoppingGroup; item: string; kg: number };
export type ShoppingRow = Need & { days: string[] };

export const BASE_PEOPLE = 11;

/** What one dish needs for 11 people, read from the dish name and its menu category. */
export function needsFor(dish: string, category: string): Need[] {
  const d = dish.toLowerCase();
  const out: Need[] = [];
  const seasonal = d.includes("seasonal");
  const mutton = /mutton|gosht/.test(d);

  if (d.includes("fish")) out.push({ group: "Fish", item: "Fish", kg: 2.5 });
  if (d.includes("keema")) out.push({ group: "Meat", item: "Keema (mutton)", kg: 2 });
  else if (mutton) out.push({ group: "Meat", item: "Mutton", kg: 3 });
  if (d.includes("chicken") || (d.includes("chinese") && !mutton)) out.push({ group: "Chicken", item: "Chicken", kg: seasonal ? 1.5 : d.includes("chinese") ? 2 : 3 });
  else if (d.includes("yakhni") && !mutton) out.push({ group: "Chicken", item: "Chicken", kg: 2.5 });

  if (seasonal) out.push({ group: "Sabzi", item: "Seasonal sabzi", kg: d.includes("chicken") ? 2 : 3 });
  else if (d.includes("chinese")) out.push({ group: "Sabzi", item: "Gajar, shimla mirch, band gobi", kg: 1.5 });
  else if (d.startsWith("sabzi biryani")) out.push({ group: "Sabzi", item: "Mix sabzi", kg: 3 });
  else if (/sabzi/i.test(category) && !out.length && dish.trim()) out.push({ group: "Sabzi", item: dish.trim(), kg: 3 });
  else {
    if (d.includes("matar")) out.push({ group: "Sabzi", item: "Matar", kg: d.includes("pulao") ? 1.5 : 1 });
    if (d.includes("aloo")) out.push({ group: "Sabzi", item: "Aloo", kg: 1.5 });
  }
  return out;
}

const quarter = (kg: number) => Math.max(0.25, Math.round(kg * 4) / 4);

/** Adds up a week's dishes into one list, scaled to the number of people. */
export function shoppingList(meals: { day: string; dish: string; category: string }[], people = BASE_PEOPLE): ShoppingRow[] {
  const rows = new Map<string, ShoppingRow>();
  for (const m of meals) {
    for (const n of needsFor(m.dish, m.category)) {
      const key = `${n.group}|${n.item.toLowerCase()}`;
      const row = rows.get(key) ?? { ...n, kg: 0, days: [] };
      row.kg += n.kg;
      if (!row.days.includes(m.day)) row.days.push(m.day);
      rows.set(key, row);
    }
  }
  return [...rows.values()]
    .map((r) => ({ ...r, kg: quarter((r.kg * people) / BASE_PEOPLE) }))
    .sort((a, b) => SHOPPING_GROUPS.indexOf(a.group) - SHOPPING_GROUPS.indexOf(b.group) || b.kg - a.kg);
}

/** The daily-food expense category a shopping group belongs to: sabzi to Vegetables, the rest to Chicken & meat. */
export function shoppingCategory<C extends { name: string; active: boolean }>(group: ShoppingGroup, categories: C[]): C | undefined {
  const pattern = group === "Sabzi" ? /sabzi|vegetable/i : /meat|chicken|fish/i;
  return categories.find((c) => c.active && pattern.test(c.name));
}

export const formatKg = (kg: number) => `${Number.isInteger(kg) ? kg : kg.toFixed(2).replace(/0$/, "")} kg`;
