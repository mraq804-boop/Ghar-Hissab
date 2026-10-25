import { describe, expect, it } from "vitest";
import { dueStaff, payDate, salaryMonth, salaryNote, staffLabels, type SalaryPayment, type Staff } from "@/lib/personal/salaries";

const driver: Staff = { id: "d", name: "Aslam", role: "Driver", monthlySalary: 25000, payDay: 1, active: true };
const maid: Staff = { id: "m", name: "Bushra", role: null, monthlySalary: 8000, payDay: 31, active: true };
const pay = (staffId: string, kind: SalaryPayment["kind"], amount: number): SalaryPayment => ({ id: `${staffId}-${kind}-${amount}`, staffId, month: "2026-10", kind, amount, paidOn: "2026-10-01", note: null });

describe("salaryMonth", () => {
  it("counts advances toward the salary and bonus as extra", () => {
    expect(salaryMonth(driver, [pay("d", "advance", 5000)])).toMatchObject({ advances: 5000, left: 20000, settled: false });
    expect(salaryMonth(driver, [pay("d", "advance", 5000), pay("d", "salary", 20000), pay("d", "bonus", 2000), pay("m", "salary", 8000)])).toMatchObject({
      salary: 20000,
      bonus: 2000,
      paid: 27000,
      left: 0,
      settled: true,
      overAdvanced: false,
    });
  });

  it("never shows a negative amount left and flags advances above the salary", () => {
    expect(salaryMonth(maid, [pay("m", "advance", 9000)])).toMatchObject({ left: 0, settled: true, overAdvanced: true });
  });
});

describe("pay dates", () => {
  it("moves a late pay day to the end of a short month", () => {
    expect(payDate(31, "2026-02")).toBe("2026-02-28");
    expect(payDate(5, "2026-10")).toBe("2026-10-05");
  });

  it("lists staff whose pay date has come and who are not fully paid", () => {
    expect(dueStaff([driver, maid], [], "2026-10-25").map((s) => s.name)).toEqual(["Aslam"]);
    expect(dueStaff([driver, maid], [pay("d", "salary", 25000)], "2026-10-31")).toEqual([maid]);
    expect(dueStaff([{ ...driver, active: false }, { ...maid, payDay: null }], [], "2026-10-31")).toEqual([]);
  });
});

describe("salaryNote", () => {
  it("names the person and role", () => {
    expect(salaryNote("advance", driver)).toBe("Advance – Aslam (Driver)");
    expect(salaryNote("salary", maid, "October")).toBe("Salary – Bushra: October");
  });
});

describe("staffLabels", () => {
  it("describes staff by their work, never by name", () => {
    const labels = staffLabels([
      { id: "a", role: "Maid" },
      { id: "b", role: "maid" },
      { id: "c", role: null },
      { id: "d", role: "Driver" },
    ]);
    expect([...labels.values()]).toEqual(["Maid", "maid 2", "Staff 3", "Driver"]);
  });
});
