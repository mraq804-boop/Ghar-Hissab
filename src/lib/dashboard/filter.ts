export type CategoryKind = "essential" | "variable";
export type FilterCategory = { id: string; name: string; kind: CategoryKind; active: boolean };

export type Selection = {
  ids: Set<string> | null;
  group: CategoryKind | null;
  label: string;
  names: string[];
};

export const KIND_LABEL: Record<CategoryKind, string> = { essential: "Must-pay", variable: "Daily food" };

/**
 * Which categories the dashboard shows, from the address: `group=essential|variable`, `cats=a,b,c`
 * or the older single `cat=a`. `ids` is null when everything is shown.
 */
export function resolveSelection(categories: FilterCategory[], params: { group?: string; cats?: string; cat?: string }): Selection {
  const all: Selection = { ids: null, group: null, label: "All categories", names: [] };
  if (params.group === "essential" || params.group === "variable") {
    const list = categories.filter((c) => c.kind === params.group);
    return { ids: new Set(list.map((c) => c.id)), group: params.group, label: KIND_LABEL[params.group], names: list.map((c) => c.name) };
  }
  const wanted = (params.cats ?? params.cat ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const list = categories.filter((c) => wanted.includes(c.id));
  if (!list.length) return all;
  const label = list.length <= 2 ? list.map((c) => c.name).join(" + ") : `${list.length} categories`;
  return { ids: new Set(list.map((c) => c.id)), group: null, label, names: list.map((c) => c.name) };
}

export function inSelection(selection: Selection, categoryId: string | null) {
  return selection.ids === null || (categoryId !== null && selection.ids.has(categoryId));
}

/** The address value for a chosen set: a whole group becomes `group=…`, everything becomes nothing. */
export function selectionParams(categories: FilterCategory[], chosen: string[]): { group?: CategoryKind; cats?: string } {
  const active = categories.filter((c) => c.active);
  const set = new Set(chosen);
  if (!set.size || active.every((c) => set.has(c.id))) return {};
  for (const kind of ["essential", "variable"] as const) {
    const group = active.filter((c) => c.kind === kind).map((c) => c.id);
    if (group.length && group.length === set.size && group.every((id) => set.has(id))) return { group: kind };
  }
  return { cats: [...set].join(",") };
}

/** Essential vs variable totals (in paisa) for shared expenses that have an amount. */
export function kindTotals(expenses: { categoryId: string | null; amountPaisa: bigint | null; shared: boolean }[], categories: FilterCategory[]) {
  const kindOf = new Map(categories.map((c) => [c.id, c.kind]));
  const totals = { essential: 0n, variable: 0n };
  for (const e of expenses) {
    if (!e.shared || e.amountPaisa === null) continue;
    totals[(e.categoryId && kindOf.get(e.categoryId)) || "essential"] += e.amountPaisa;
  }
  return totals;
}
