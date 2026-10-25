"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BadgeCheck, ChevronLeft, ChevronRight, HandCoins, Loader2, Lock, Pencil, Plus, Trash2, UserRound, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmButton } from "@/components/ledger/confirm-button";
import { Field } from "@/components/ledger/field";
import { ResponsiveDialog } from "@/components/ledger/responsive-dialog";
import { KIND_TEXT, payDate, salaryMonth, type SalaryKind, type SalaryPayment, type Staff } from "@/lib/personal/salaries";
import { cn } from "@/lib/utils";
import { MeTabs } from "../plan/plan-board";
import { deleteSalaryPayment, deleteStaff, paySalary, saveStaff } from "../salary-actions";

const rs = (n: number) => `Rs ${Math.round(n).toLocaleString("en-US")}`;
const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

export function SalariesBoard({
  month,
  monthLabel,
  year,
  prevMonth,
  nextMonth,
  today,
  staff,
  payments,
  yearTotals,
}: {
  month: string;
  monthLabel: string;
  year: string;
  prevMonth: string;
  nextMonth: string | null;
  today: string;
  staff: Staff[];
  payments: SalaryPayment[];
  yearTotals: Record<string, number>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<Staff | "new" | null>(null);
  const [paying, setPaying] = useState<{ staff: Staff; kind: SalaryKind } | null>(null);
  const [showPast, setShowPast] = useState(false);

  const shown = staff.filter((s) => s.active || payments.some((p) => p.staffId === s.id));
  const past = staff.filter((s) => !shown.includes(s));
  const rows = shown.map((s) => ({ s, m: salaryMonth(s, payments) }));
  const paidTotal = payments.reduce((a, p) => a + p.amount, 0);
  const leftTotal = rows.filter((r) => r.s.active).reduce((a, r) => a + r.m.left, 0);

  const act = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Done");
      else toast.error(r.error ?? "Something went wrong");
      router.refresh();
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-3">
          <MeTabs active="salaries" />
          <div>
            <h1 className="font-heading text-3xl font-bold">Salaries</h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><Lock className="size-3.5" /> Staff you pay yourself. Only you can see this.</p>
          </div>
        </div>
        <Button onClick={() => setEditing("new")}><Plus /> Add staff</Button>
      </div>

      <section className="rounded-2xl border bg-card p-5">
        <div className="flex items-center justify-between gap-2">
          <Button asChild variant="ghost" size="icon" aria-label="Previous month"><Link href={`/me/salaries?m=${prevMonth}`}><ChevronLeft /></Link></Button>
          <p className="font-medium">{monthLabel}</p>
          {nextMonth ? <Button asChild variant="ghost" size="icon" aria-label="Next month"><Link href={`/me/salaries?m=${nextMonth}`}><ChevronRight /></Link></Button> : <span className="size-9" />}
        </div>
        <p className="num mt-3 text-center font-heading text-4xl font-bold">{rs(paidTotal)}</p>
        <p className="mt-1 text-center text-sm text-muted-foreground">
          paid in salaries{leftTotal > 0 ? <> · <span className="font-medium text-warning">{rs(leftTotal)} still to pay</span></> : rows.length ? " · everyone is paid" : ""}
        </p>
        <p className="mt-3 text-center text-xs text-muted-foreground">Each payment is also added to your Spent tab under Salaries.</p>
      </section>

      {rows.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map(({ s, m }) => {
            const pct = Math.min(100, Math.round(((m.salary + m.advances) / s.monthlySalary) * 100));
            const list = payments.filter((p) => p.staffId === s.id);
            const due = s.active && s.payDay !== null && !m.settled && payDate(s.payDay, month) <= today;
            return (
              <article key={s.id} className={cn("rounded-2xl border bg-card p-4 sm:p-5", !s.active && "opacity-75")}>
                <header className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted"><UserRound className="size-5 text-muted-foreground" /></span>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate font-heading text-lg font-semibold">{s.name}</h2>
                    <p className="text-xs text-muted-foreground">
                      {[s.role, `${rs(s.monthlySalary)} a month`, s.payDay ? `paid on the ${ordinal(s.payDay)}` : null, s.active ? null : "left"].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <Button size="icon" variant="ghost" aria-label={`Edit ${s.name}`} onClick={() => setEditing(s)}><Pencil /></Button>
                </header>

                <div className="mt-4 flex items-baseline justify-between text-sm">
                  {m.settled ? (
                    <span className="inline-flex items-center gap-1.5 font-medium text-success"><BadgeCheck className="size-4" /> Paid for {monthLabel.split(" ")[0]}</span>
                  ) : (
                    <span className={cn("font-medium", due && "text-warning")}>{rs(m.left)} left{due ? " · due now" : ""}</span>
                  )}
                  <span className="num text-xs text-muted-foreground">{pct}%</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`${s.name} has been paid ${pct}% of this month's salary`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  <div className={cn("h-full rounded-full", m.settled ? "bg-success" : "bg-chart-2")} style={{ width: `${pct}%` }} />
                </div>
                {m.advances || m.bonus ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {m.advances ? `Advance ${rs(m.advances)} taken` : null}
                    {m.advances && m.bonus ? " · " : null}
                    {m.bonus ? `Bonus ${rs(m.bonus)}` : null}
                    {m.overAdvanced ? <span className="text-warning"> · advance is more than the salary</span> : null}
                  </p>
                ) : null}

                {s.active ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {!m.settled ? <Button size="sm" onClick={() => setPaying({ staff: s, kind: "salary" })}><Wallet /> Pay salary</Button> : null}
                    <Button size="sm" variant="outline" onClick={() => setPaying({ staff: s, kind: "advance" })}><HandCoins /> Give advance</Button>
                    <Button size="sm" variant="ghost" onClick={() => setPaying({ staff: s, kind: "bonus" })}><Plus /> Bonus</Button>
                  </div>
                ) : null}

                {list.length ? (
                  <ul className="mt-4 divide-y rounded-xl border text-sm">
                    {list.map((p) => (
                      <li key={p.id} className="flex items-center gap-2 px-3 py-2">
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{KIND_TEXT[p.kind]}</span>
                          <span className="text-muted-foreground"> · {day(p.paidOn)}{p.note ? ` · ${p.note}` : ""}</span>
                        </span>
                        <span className="num shrink-0">{rs(p.amount)}</span>
                        <ConfirmButton
                          size="icon"
                          variant="ghost"
                          aria-label="Remove payment"
                          title={`Remove this ${KIND_TEXT[p.kind].toLowerCase()} of ${rs(p.amount)}?`}
                          description="It's also removed from your Spent tab."
                          confirmLabel="Remove"
                          destructive
                          onConfirm={() => act(() => deleteSalaryPayment(p.id))}
                        >
                          <Trash2 />
                        </ConfirmButton>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p className="mt-3 text-xs text-muted-foreground">{rs(yearTotals[s.id] ?? 0)} paid in {year}</p>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed p-10 text-center">
          <UserRound className="mx-auto size-7 text-muted-foreground" />
          <p className="mt-2 font-medium">No staff yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Add your driver, maid, tutor or anyone you pay a monthly salary.</p>
          <Button className="mt-4" onClick={() => setEditing("new")}><Plus /> Add staff</Button>
        </div>
      )}

      {past.length ? (
        <div>
          <Button variant="ghost" size="sm" onClick={() => setShowPast((v) => !v)}>{showPast ? "Hide" : "Show"} past staff ({past.length})</Button>
          {showPast ? (
            <ul className="mt-2 divide-y rounded-2xl border bg-card text-sm">
              {past.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex-1">{s.name}{s.role ? <span className="text-muted-foreground"> · {s.role}</span> : null}</span>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => saveStaff({ id: s.id, name: s.name, role: s.role ?? "", monthlySalary: String(s.monthlySalary), payDay: s.payDay, active: true }))}>Bring back</Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {editing ? (
        <StaffDialog
          staff={editing === "new" ? null : editing}
          pending={pending}
          onClose={() => setEditing(null)}
          onRemove={(id) => {
            setEditing(null);
            act(() => deleteStaff(id));
          }}
          onSaved={() => {
            setEditing(null);
            start(() => router.refresh());
          }}
        />
      ) : null}
      {paying ? (
        <PayDialog
          {...paying}
          month={month}
          monthLabel={monthLabel}
          today={today}
          left={salaryMonth(paying.staff, payments).left}
          onClose={() => setPaying(null)}
          onSaved={() => {
            setPaying(null);
            start(() => router.refresh());
          }}
        />
      ) : null}
    </div>
  );
}

function StaffDialog({ staff, pending, onClose, onRemove, onSaved }: { staff: Staff | null; pending: boolean; onClose: () => void; onRemove: (id: string) => void; onSaved: () => void }) {
  const [name, setName] = useState(staff?.name ?? "");
  const [role, setRole] = useState(staff?.role ?? "");
  const [salary, setSalary] = useState(staff ? String(staff.monthlySalary) : "");
  const [payDay, setPayDay] = useState(staff?.payDay ? String(staff.payDay) : "");
  const [saving, startSave] = useTransition();

  const save = () =>
    startSave(async () => {
      const r = await saveStaff({ id: staff?.id, name, role, monthlySalary: salary, payDay: payDay ? Number(payDay) : null, active: staff?.active ?? true });
      if (r.ok) {
        toast.success(r.message);
        onSaved();
      } else toast.error(r.error);
    });

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && !saving && onClose()} title={staff ? `Edit ${staff.name}` : "Add staff"} description="Only you can see this">
      <div className="space-y-4 pb-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="staff-name"><Input id="staff-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} className="h-10" autoFocus /></Field>
          <Field label="Work (optional)" htmlFor="staff-role"><Input id="staff-role" value={role} maxLength={40} placeholder="Driver, maid, tutor…" onChange={(e) => setRole(e.target.value)} className="h-10" /></Field>
          <Field label="Monthly salary (Rs)" htmlFor="staff-salary"><Input id="staff-salary" inputMode="decimal" value={salary} onChange={(e) => setSalary(e.target.value)} className="num h-10" /></Field>
          <Field label="Pay day (optional)" htmlFor="staff-day" hint="You'll get a reminder that day">
            <Select value={payDay || "none"} onValueChange={(v) => setPayDay(v === "none" ? "" : v)}>
              <SelectTrigger id="staff-day" className="h-10 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No fixed day</SelectItem>
                {Array.from({ length: 31 }, (_, i) => <SelectItem key={i + 1} value={String(i + 1)}>{ordinal(i + 1)} of the month</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="flex gap-2">
          {staff ? (
            <Button variant="ghost" className="h-11 text-destructive" disabled={saving || pending} onClick={() => onRemove(staff.id)}>Left job</Button>
          ) : null}
          <Button variant="outline" className="h-11 flex-1" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button className="h-11 flex-[2]" onClick={save} disabled={saving || !name.trim() || !salary}>{saving ? <Loader2 className="animate-spin" /> : null} {staff ? "Save" : "Add"}</Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}

function PayDialog({ staff, kind, month, monthLabel, today, left, onClose, onSaved }: { staff: Staff; kind: SalaryKind; month: string; monthLabel: string; today: string; left: number; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState(kind === "salary" && left > 0 ? String(left) : "");
  const [paidOn, setPaidOn] = useState(today.startsWith(month) || month > today.slice(0, 7) ? today : `${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`);
  const [note, setNote] = useState("");
  const [saving, startSave] = useTransition();
  const title = kind === "salary" ? `Pay ${staff.name}` : kind === "advance" ? `Advance to ${staff.name}` : `Bonus for ${staff.name}`;
  const hint = kind === "advance" ? "Counted toward this month's salary." : kind === "bonus" ? "Extra, on top of the salary (Eid, overtime…)." : `${monthLabel} salary`;

  const save = () =>
    startSave(async () => {
      const r = await paySalary({ staffId: staff.id, month, kind, amount, paidOn, note });
      if (r.ok) {
        toast.success(r.message);
        onSaved();
      } else toast.error(r.error);
    });

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && !saving && onClose()} title={title} description={`${hint} It's added to your Spent tab.`}>
      <div className="space-y-4 pb-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount (Rs)" htmlFor="pay-amount"><Input id="pay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="num h-10" autoFocus /></Field>
          <Field label="Date" htmlFor="pay-date"><Input id="pay-date" type="date" max={today} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className="h-10" /></Field>
        </div>
        <Field label="Note (optional)" htmlFor="pay-note"><Input id="pay-note" value={note} maxLength={120} placeholder={kind === "bonus" ? "Eid bonus" : ""} onChange={(e) => setNote(e.target.value)} className="h-10" /></Field>
        <div className="flex gap-2">
          <Button variant="outline" className="h-11 flex-1" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button className="h-11 flex-[2]" onClick={save} disabled={saving || !amount || !paidOn}>{saving ? <Loader2 className="animate-spin" /> : null} Record {KIND_TEXT[kind].toLowerCase()}</Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}
