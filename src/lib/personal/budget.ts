export type BudgetState = "ok" | "pace" | "near" | "over";

export type BudgetStatus = {
  state: BudgetState;
  spent: number;
  budget: number;
  left: number;
  percent: number;
  projected: number | null;
};

/**
 * How a month's spending stands against its budget. For the current month it also projects the
 * month-end total at the current pace; `dayOfMonth` is null for a month that has ended.
 */
export function budgetStatus(spent: number, budget: number, dayOfMonth: number | null, daysInMonth: number): BudgetStatus {
  const percent = budget > 0 ? Math.round((spent / budget) * 100) : 0;
  const projected = dayOfMonth && dayOfMonth >= 5 && dayOfMonth < daysInMonth ? Math.round((spent / dayOfMonth) * daysInMonth) : null;
  let state: BudgetState = "ok";
  if (spent > budget) state = "over";
  else if (spent >= budget * 0.8) state = "near";
  else if (projected !== null && projected > budget * 1.05) state = "pace";
  return { state, spent, budget, left: Math.max(0, budget - spent), percent, projected };
}

export function daysIn(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export const DEFAULT_PERSONAL_CATEGORIES = ["Fuel", "Mobile & internet", "Clothes", "Medicine", "Eating out", "Gifts", "Transport", "Other"];

const HINTS: [RegExp, string][] = [
  [/\b(petrol|fuel|diesel|cng)\b/i, "Fuel"],
  [/\b(mobile|load|balance|package|internet|jazz|zong|telenor|ufone)\b/i, "Mobile & internet"],
  [/\b(clothes|kapray|kapre|shoes|joote|suit|shirt)\b/i, "Clothes"],
  [/\b(medicine|dawai|dawa|doctor|clinic|pharmacy|tablet)\b/i, "Medicine"],
  [/\b(restaurant|pizza|burger|lunch|dinner|chai|khana|biryani|eating)\b/i, "Eating out"],
  [/\b(gift|tohfa|eidi)\b/i, "Gifts"],
  [/\b(rickshaw|uber|careem|bykea|bus|fare|kiraya|taxi)\b/i, "Transport"],
];

/** Picks a category for a quick entry: from the person's own history first, then from common words. */
export function guessPersonalCategory(text: string, history: { note: string | null; categoryName: string | null }[], categories: string[]) {
  const words = text.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3);
  for (const h of history) {
    if (!h.categoryName || !h.note) continue;
    const noteWords = h.note.toLowerCase().split(/[^a-z]+/);
    if (words.some((w) => noteWords.includes(w))) return h.categoryName;
  }
  for (const [pattern, name] of HINTS) if (pattern.test(text) && categories.includes(name)) return name;
  return null;
}
