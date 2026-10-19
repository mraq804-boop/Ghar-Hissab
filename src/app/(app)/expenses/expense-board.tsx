"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, Download, Lock, LockOpen, MoreHorizontal, Pencil, Plus, Receipt, Search, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Money } from "@/components/ledger/money";
import { EmptyState, PageHeader } from "@/components/ledger/page-header";
import { ResponsiveDialog } from "@/components/ledger/responsive-dialog";
import { StatusBadge, syncBadgeKey } from "@/components/ledger/status-badge";
import { ConfirmButton } from "@/components/ledger/confirm-button";
import { cn } from "@/lib/utils";
import { deleteExpense, setPeriodStatus } from "./actions";
import { ExpenseForm, type FormRef } from "./expense-form";
import { StartMonth } from "./start-month";

export type ExpenseView = {
  id: string;
  version: number;
  title: string;
  sectionId: string;
  categoryId: string | null;
  categoryName: string | null;
  qtyText: string | null;
  qtyNum: string | null;
  rate: string | null;
  amount: string | null;
  amountPaisa: bigint | null;
  splitLabel: string;
  splitRuleId: string | null;
  splitOverride: { type: string; unitIds?: string[]; parts?: { unitId: string; percent?: number; amountPaisa?: string | number }[] } | null;
  shares: { code: string; sharePaisa: bigint }[];
  paidByUnitId: string | null;
  paidByCode: string | null;
  notes: string | null;
  expenseDate: string | null;
  sync: "synced" | "pending" | "failed" | "off" | null;
};

type Sort = "workbook" | "amount" | "name";

export function ExpenseBoard(props: {
  admin: boolean;
  period: { id: string; label: string; status: "open" | "closed"; slug: string };
  startNext: { year: number; month: number } | null;
  expenses: ExpenseView[];
  sectionTotals: Record<string, bigint>;
  grandTotal: bigint;
  splitTotal: bigint;
  refData: FormRef;
  openNew: boolean;
}) {
  const { admin, period, expenses, refData } = props;
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState<Sort>("workbook");
  const closed = period.status === "closed";
  const [editing, setEditing] = useState<ExpenseView | "new" | null>(props.openNew && admin && !closed ? "new" : null);
  const [seenOpenNew, setSeenOpenNew] = useState(props.openNew);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();

  if (props.openNew !== seenOpenNew) {
    setSeenOpenNew(props.openNew);
    if (props.openNew && admin && !closed) setEditing("new");
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = expenses.filter(
      (e) =>
        (category === "all" || e.categoryId === category) &&
        (!q || e.title.toLowerCase().includes(q) || e.notes?.toLowerCase().includes(q) || e.categoryName?.toLowerCase().includes(q)),
    );
    if (sort === "amount") list.sort((a, b) => Number((b.amountPaisa ?? -1n) - (a.amountPaisa ?? -1n)));
    if (sort === "name") list.sort((a, b) => a.title.localeCompare(b.title));
    return list;
  }, [expenses, query, category, sort]);

  const close = () => {
    setEditing(null);
    router.replace(`/expenses?m=${period.slug}`, { scroll: false });
    router.refresh();
  };

  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const sectionKey = (id: string) => refData.sections.find((s) => s.id === id)?.key ?? "";

  return (
    <>
      <PageHeader
        title={<>Expenses <span className="text-muted-foreground">· {period.label}</span></>}
        description={
          <>
            <Money paisa={props.grandTotal} className="font-semibold text-foreground" /> recorded, of which{" "}
            <Money paisa={props.splitTotal} className="font-semibold text-foreground" /> is shared.
            {closed ? " This month is closed." : ""}
          </>
        }
        actions={
          <>
            {props.startNext ? <StartMonth {...props.startNext} variant="outline" /> : null}
            <Button asChild variant="outline">
              <a href={`/api/export/expenses?m=${period.slug}`}><Download /> Excel</a>
            </Button>
            {admin ? (
              <ConfirmButton
                variant="outline"
                title={closed ? `Reopen ${period.label}?` : `Close ${period.label}?`}
                description={closed ? "Expenses for this month can be edited again." : "Expenses for this month become read-only. Payments can still be recorded against it."}
                confirmLabel={closed ? "Reopen month" : "Close month"}
                onConfirm={async () => {
                  const r = await setPeriodStatus({ periodId: period.id, status: closed ? "open" : "closed" });
                  if (r.ok) toast.success(r.message);
                  else toast.error(r.error);
                  router.refresh();
                }}
              >
                {closed ? <LockOpen /> : <Lock />}
                {closed ? "Reopen" : "Close month"}
              </ConfirmButton>
            ) : null}
            {admin && !closed ? (
              <Button onClick={() => setEditing("new")} className="hidden sm:inline-flex">
                <Plus /> Add expense
              </Button>
            ) : null}
          </>
        }
      />

      <div className="sticky top-14 z-20 -mx-4 mb-5 flex flex-wrap items-center gap-2 border-b bg-background/90 px-4 py-3 backdrop-blur md:top-16 md:-mx-6 md:px-6">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search items or notes" className="h-9 rounded-full bg-card pl-9" aria-label="Search expenses" />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-9 w-auto min-w-36 rounded-full bg-card" aria-label="Category"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {refData.categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(s) => setSort(s as Sort)}>
          <SelectTrigger className="h-9 w-auto rounded-full bg-card" aria-label="Sort"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="workbook">Workbook order</SelectItem>
            <SelectItem value="amount">Largest first</SelectItem>
            <SelectItem value="name">A to Z</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {expenses.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={`No expenses in ${period.label} yet`}
          action={admin && !closed ? <Button onClick={() => setEditing("new")}><Plus /> Add the first expense</Button> : null}
        >
          Add groceries, bills and wages as they happen. Shares update instantly.
        </EmptyState>
      ) : filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed py-12 text-center text-sm text-muted-foreground">No expenses match. Clear the search or category filter.</p>
      ) : (
        <div className="space-y-6">
          {refData.sections.map((s) => {
            const rows = filtered.filter((e) => e.sectionId === s.id);
            if (!rows.length) return null;
            return (
              <section key={s.id} aria-labelledby={`sec-${s.id}`} className="overflow-hidden rounded-2xl border bg-card">
                <header className="flex items-baseline justify-between gap-3 border-b bg-muted/40 px-4 py-3 md:px-5">
                  <h2 id={`sec-${s.id}`} className="font-heading text-base font-semibold">
                    {s.title} <span className="text-sm font-normal text-muted-foreground">{rows.length}</span>
                  </h2>
                  <Money paisa={props.sectionTotals[sectionKey(s.id)] ?? 0n} className="font-semibold" />
                </header>

                <div role="table" aria-label={s.title} className="hidden md:block">
                  <div role="row" className="grid grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.5fr)_8rem_7rem_2.5rem] gap-3 border-b px-5 py-2 text-xs font-medium text-muted-foreground">
                    <span role="columnheader">Item</span>
                    <span role="columnheader">Quantity</span>
                    <span role="columnheader">Shared</span>
                    <span role="columnheader" className="text-right">Amount</span>
                    <span role="columnheader">{admin ? "Excel" : ""}</span>
                    <span role="columnheader" className="sr-only">Actions</span>
                  </div>
                  <ul role="rowgroup" className="divide-y">
                    {rows.map((e) => (
                      <li key={e.id} role="row">
                        <div className="grid grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.5fr)_8rem_7rem_2.5rem] items-center gap-3 px-5 py-2.5 text-sm hover:bg-muted/40">
                          <button type="button" onClick={() => toggle(e.id)} aria-expanded={expanded.has(e.id)} className="flex min-w-0 items-center gap-2 text-left outline-none focus-visible:underline">
                            <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", expanded.has(e.id) && "rotate-180")} />
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{e.title}</span>
                              <span className="block truncate text-xs text-muted-foreground">{[e.categoryName, e.notes].filter(Boolean).join(", ") || " "}</span>
                            </span>
                          </button>
                          <span className="num truncate text-muted-foreground">{qtyLabel(e)}</span>
                          <span className="truncate text-muted-foreground">{e.splitLabel}</span>
                          <span className="text-right">
                            {e.amountPaisa === null ? <StatusBadge status="bill_pending" compact /> : <Money paisa={e.amountPaisa} className="font-medium" />}
                          </span>
                          <span>{e.sync ? <StatusBadge status={syncBadgeKey(e.sync)} compact /> : null}</span>
                          <span>{admin && !closed ? <RowMenu e={e} onEdit={() => setEditing(e)} onDeleted={() => router.refresh()} /> : null}</span>
                        </div>
                        {expanded.has(e.id) ? <Allocation e={e} /> : null}
                      </li>
                    ))}
                  </ul>
                </div>

                <ul className="divide-y md:hidden">
                  {rows.map((e) => (
                    <li key={e.id} className="px-4 py-3">
                      <div className="flex items-start gap-3">
                        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => toggle(e.id)} aria-expanded={expanded.has(e.id)}>
                          <p className="truncate font-medium">{e.title}</p>
                          <p className="truncate text-xs text-muted-foreground">{[qtyLabel(e), e.splitLabel].filter(Boolean).join(", ")}</p>
                        </button>
                        <div className="flex flex-col items-end gap-1">
                          {e.amountPaisa === null ? <StatusBadge status="bill_pending" compact /> : <Money paisa={e.amountPaisa} className="font-semibold" />}
                          {e.sync && e.sync !== "synced" ? <StatusBadge status={syncBadgeKey(e.sync)} compact /> : null}
                        </div>
                        {admin && !closed ? <RowMenu e={e} onEdit={() => setEditing(e)} onDeleted={() => router.refresh()} /> : null}
                      </div>
                      {expanded.has(e.id) ? <Allocation e={e} mobile /> : null}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {admin && !closed ? (
        <Button
          onClick={() => setEditing("new")}
          size="icon"
          className="fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 size-14 rounded-full bg-haldi text-[#1b2340] shadow-lg hover:bg-haldi/90 sm:hidden"
          aria-label="Add expense"
        >
          <Plus className="size-6" />
        </Button>
      ) : null}

      <ResponsiveDialog
        open={editing !== null}
        onOpenChange={(o) => !o && !pending && close()}
        title={editing === "new" ? "Add expense" : "Edit expense"}
        description={period.label}
      >
        {editing ? (
          <ExpenseForm
            key={editing === "new" ? "new" : editing.id}
            refData={refData}
            periodId={period.id}
            initial={editing === "new" ? undefined : toInitial(editing)}
            onDone={() => start(close)}
          />
        ) : null}
      </ResponsiveDialog>
    </>
  );
}

function qtyLabel(e: ExpenseView) {
  if (e.rate && e.qtyNum) return `${Number(e.qtyNum)} × Rs ${Number(e.rate).toLocaleString("en-US")}`;
  return e.qtyText ?? "";
}

function Allocation({ e, mobile }: { e: ExpenseView; mobile?: boolean }) {
  return (
    <div className={cn("bg-muted/30 text-sm", mobile ? "mt-3 rounded-lg px-3 py-2" : "px-5 py-3 pl-11")}>
      {e.shares.length === 0 ? (
        <p className="text-muted-foreground">{e.amountPaisa === null ? "Shares are calculated once the bill amount is entered." : "Not shared. Recorded only."}</p>
      ) : (
        <dl className="flex flex-wrap gap-x-6 gap-y-1">
          {e.shares.map((s) => (
            <div key={s.code} className="flex gap-2">
              <dt className="font-semibold">{s.code}</dt>
              <dd><Money paisa={s.sharePaisa} decimals={s.sharePaisa % 100n !== 0n} /></dd>
            </div>
          ))}
          {e.paidByCode ? <div className="text-muted-foreground">Paid by {e.paidByCode}</div> : null}
          {e.expenseDate ? <div className="text-muted-foreground">{new Date(e.expenseDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</div> : null}
        </dl>
      )}
    </div>
  );
}

function RowMenu({ e, onEdit, onDeleted }: { e: ExpenseView; onEdit: () => void; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${e.title}`}><MoreHorizontal /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onEdit}><Pencil /> Edit</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirm(true)}><Trash2 /> Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {confirm ? (
        <AutoConfirm
          title={`Delete ${e.title}?`}
          description="It is removed from this month's shares and from the workbook. The change is kept in the audit log."
          onCancel={() => setConfirm(false)}
          onConfirm={async () => {
            const r = await deleteExpense({ id: e.id, version: e.version });
            if (r.ok) {
              toast.success("Expense deleted");
              onDeleted();
            } else toast.error(r.error);
            setConfirm(false);
          }}
        />
      ) : null}
    </>
  );
}

function AutoConfirm({ title, description, onConfirm, onCancel }: { title: string; description: string; onConfirm: () => Promise<void>; onCancel: () => void }) {
  const [pending, start] = useTransition();
  return (
    <AlertDialog open onOpenChange={(o) => !o && !pending && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={pending} onClick={() => start(onConfirm)}>Delete expense</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function toInitial(e: ExpenseView) {
  const o = e.splitOverride;
  const percents: Record<string, string> = {};
  const customAmounts: Record<string, string> = {};
  if (o?.type === "percentage") for (const p of o.parts ?? []) percents[p.unitId] = String(p.percent ?? "");
  if (o?.type === "custom_amounts") for (const p of o.parts ?? []) customAmounts[p.unitId] = (Number(p.amountPaisa ?? 0) / 100).toString();
  return {
    id: e.id,
    expectedVersion: e.version,
    sectionId: e.sectionId,
    categoryId: e.categoryId,
    title: e.title,
    qtyText: e.qtyText ?? "",
    pricing: (e.rate ? "rate" : e.amount === null ? "pending" : "amount") as "rate" | "pending" | "amount",
    qty: e.qtyNum ? String(Number(e.qtyNum)) : "",
    rate: e.rate ? String(Number(e.rate)) : "",
    amount: e.amount ? String(Number(e.amount)) : "",
    expenseDate: e.expenseDate ?? "",
    paidByUnitId: e.paidByUnitId ?? undefined,
    notes: e.notes ?? "",
    splitMode: (o ? (o.type === "weights" ? "rule" : o.type) : "rule") as "rule" | "equal_units" | "percentage" | "custom_amounts",
    ruleId: e.splitRuleId ?? "",
    equalUnits: o?.type === "equal_units" ? (o.unitIds ?? []) : undefined,
    percents,
    customAmounts,
  };
}
