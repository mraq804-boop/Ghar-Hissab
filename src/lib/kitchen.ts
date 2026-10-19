export type DutyAssignment = {
  day: string;
  breakfast: string | null;
  lunch: string | null;
  dinner: string | null;
  off: string | null;
};

export function daysOfMonth(year: number, month: number): string[] {
  const n = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${year}-${String(month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`);
}

/**
 * Two people cook each day: one takes two meals, the other takes one.
 * Pairs rotate (A+B, B+C, C+A) so everyone gets every third day off,
 * and the single-meal slot rotates breakfast, lunch, dinner.
 * People listed in `away` for a day are skipped for that day.
 */
export function generateRoster(
  people: string[],
  days: string[],
  away: (day: string) => string[] = () => [],
): DutyAssignment[] {
  if (people.length === 0) return days.map((day) => ({ day, breakfast: null, lunch: null, dinner: null, off: null }));
  let pairIndex = 0;
  let slot = 0;
  return days.map((day) => {
    const present = people.filter((p) => !away(day).includes(p));
    const absent = people.filter((p) => !present.includes(p));
    let a: string;
    let b: string;
    let off: string | null;
    if (present.length >= 3) {
      a = present[pairIndex % present.length];
      b = present[(pairIndex + 1) % present.length];
      off = present.find((p) => p !== a && p !== b) ?? null;
      pairIndex++;
    } else if (present.length === 2) {
      [a, b] = slot % 2 === 0 ? [present[0], present[1]] : [present[1], present[0]];
      off = absent[0] ?? null;
    } else if (present.length === 1) {
      a = b = present[0];
      off = absent[0] ?? null;
    } else {
      return { day, breakfast: null, lunch: null, dinner: null, off: absent[0] ?? null };
    }
    const single = slot % 3;
    slot++;
    const meals: [string, string, string] = [a, a, a];
    meals[single] = b;
    return { day, breakfast: meals[0], lunch: meals[1], dinner: meals[2], off };
  });
}

export function mealCounts(rows: DutyAssignment[]) {
  const counts = new Map<string, number>();
  for (const r of rows) for (const m of [r.breakfast, r.lunch, r.dinner]) if (m) counts.set(m, (counts.get(m) ?? 0) + 1);
  return counts;
}
