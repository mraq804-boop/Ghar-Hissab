export type SalaryKind = "salary" | "advance" | "bonus";
export type Staff = { id: string; name: string; role: string | null; monthlySalary: number; payDay: number | null; active: boolean };
export type SalaryPayment = { id: string; staffId: string; month: string; kind: SalaryKind; amount: number; paidOn: string; note: string | null };

export const KIND_TEXT: Record<SalaryKind, string> = { salary: "Salary", advance: "Advance", bonus: "Bonus" };

/**
 * One person's month: advances count toward the salary, a bonus is extra.
 * `left` never goes below zero; `overAdvanced` says the advances alone went past the salary.
 */
export function salaryMonth(staff: Staff, payments: SalaryPayment[]) {
  const mine = payments.filter((p) => p.staffId === staff.id);
  const sum = (k: SalaryKind) => mine.filter((p) => p.kind === k).reduce((a, p) => a + p.amount, 0);
  const salary = sum("salary");
  const advances = sum("advance");
  const bonus = sum("bonus");
  const covered = salary + advances;
  return {
    salary,
    advances,
    bonus,
    paid: covered + bonus,
    left: Math.max(0, staff.monthlySalary - covered),
    settled: covered >= staff.monthlySalary,
    overAdvanced: advances > staff.monthlySalary,
  };
}

/** The pay date for a month, moved back to the month's last day when it's shorter (e.g. 31 in February). */
export function payDate(payDay: number, month: string) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(Math.min(payDay, last)).padStart(2, "0")}`;
}

/** Active staff whose pay date this month has come and whose salary isn't fully paid. */
export function dueStaff(staff: Staff[], payments: SalaryPayment[], today: string) {
  const month = today.slice(0, 7);
  return staff.filter((s) => s.active && s.payDay !== null && payDate(s.payDay, month) <= today && !salaryMonth(s, payments).settled);
}

/** The note written on the matching personal expense, e.g. "Salary – Aslam (Driver)". */
export function salaryNote(kind: SalaryKind, staff: { name: string; role: string | null }, extra?: string) {
  const who = staff.role ? `${staff.name} (${staff.role})` : staff.name;
  return `${KIND_TEXT[kind]} – ${who}${extra ? `: ${extra}` : ""}`.slice(0, 200);
}

/** Labels that say what each person does without their name, e.g. "Driver", "Maid", "Maid 2", "Staff 3". */
export function staffLabels(staff: { id: string; role: string | null }[]) {
  const seen = new Map<string, number>();
  const labels = new Map<string, string>();
  staff.forEach((s, i) => {
    const base = s.role?.trim() || "Staff";
    const n = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), n);
    labels.set(s.id, base === "Staff" ? `Staff ${i + 1}` : n > 1 ? `${base} ${n}` : base);
  });
  return labels;
}
