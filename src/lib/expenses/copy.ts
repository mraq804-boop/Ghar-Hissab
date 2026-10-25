export type CopyItem = {
  id: string;
  title: string;
  categoryId: string | null;
  categoryName: string;
  qtyText: string | null;
  amountPaisa: bigint | null;
};

export type CopyGroup = { key: string; name: string; items: (CopyItem & { exists: boolean })[]; totalPaisa: bigint };

const sameItem = (a: { title: string; categoryId: string | null }, b: { title: string; categoryId: string | null }) =>
  a.categoryId === b.categoryId && a.title.trim().toLowerCase() === b.title.trim().toLowerCase();

/**
 * Last month's items grouped by category, largest group first. Items already in the target month
 * (same title and category) are marked so they aren't copied twice.
 */
export function groupForCopy(source: CopyItem[], target: { title: string; categoryId: string | null }[]): CopyGroup[] {
  const groups = new Map<string, CopyGroup>();
  for (const item of source) {
    const key = item.categoryId ?? "none";
    const g = groups.get(key) ?? { key, name: item.categoryName, items: [], totalPaisa: 0n };
    g.items.push({ ...item, exists: target.some((t) => sameItem(t, item)) });
    g.totalPaisa += item.amountPaisa ?? 0n;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => (b.totalPaisa > a.totalPaisa ? 1 : b.totalPaisa < a.totalPaisa ? -1 : a.name.localeCompare(b.name)));
}

/** The ids to tick when a category is chosen: everything in it that isn't already in the target month. */
export function defaultTicks(group: CopyGroup) {
  return group.items.filter((i) => !i.exists).map((i) => i.id);
}

export function copyTotal(items: CopyItem[], ids: Iterable<string>) {
  const chosen = new Set(ids);
  return items.filter((i) => chosen.has(i.id)).reduce((a, i) => a + (i.amountPaisa ?? 0n), 0n);
}
