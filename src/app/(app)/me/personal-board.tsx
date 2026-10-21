"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, FileSpreadsheet, FileText, Loader2, Lock, Paperclip, Pencil, Plus, Settings2, Target, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CategoryChart } from "@/components/dashboard/charts";
import { ConfirmButton } from "@/components/ledger/confirm-button";
import { Field } from "@/components/ledger/field";
import { Panel } from "@/components/ledger/page-header";
import { ResponsiveDialog } from "@/components/ledger/responsive-dialog";
import { VoiceButton } from "@/components/ledger/voice-button";
import { shrinkImage } from "@/lib/images";
import { parsePaymentText } from "@/lib/ocr/parse-payment";
import { readImageText } from "@/lib/ocr/read-screenshot";
import { guessPersonalCategory, type BudgetStatus } from "@/lib/personal/budget";
import { parseQuickEntry } from "@/lib/smart/suggest";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { deletePersonalExpense, personalReceiptUrl, savePersonalBudget, savePersonalCategory, savePersonalExpense } from "./actions";

type Category = { id: string; name: string; sort_order: number; active: boolean };
type Expense = { id: string; category_id: string | null; amount: number; spent_on: string; note: string | null; receipt_path: string | null; receipt_mime: string | null; categoryName: string };
type Budget = BudgetStatus & { categoryId: string | null; name: string };

export type PersonalView = {
  userId: string;
  month: string;
  monthLabel: string;
  previousLabel: string;
  prevMonth: string;
  nextMonth: string | null;
  today: string;
  total: number;
  lastTotal: number;
  overallBudget: Budget | null;
  budgets: Budget[];
  categories: Category[];
  breakdown: { name: string; id: string | null; total: number; last: number }[];
  expenses: Expense[];
  history: { note: string | null; categoryName: string | null }[];
};

const rs = (n: number) => `Rs ${Math.round(n).toLocaleString("en-US")}`;
const dayLabel = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

const TONE: Record<BudgetStatus["state"], string> = { ok: "bg-chart-2", pace: "bg-warning", near: "bg-warning", over: "bg-destructive" };

function budgetLine(b: Budget) {
  if (b.state === "over") return `${rs(b.spent - b.budget)} over the ${rs(b.budget)} budget`;
  if (b.state === "near") return `${b.percent}% used, ${rs(b.left)} left`;
  if (b.state === "pace") return `${rs(b.left)} left, but at this pace about ${rs(b.projected ?? 0)} by month-end`;
  return `${rs(b.left)} left of ${rs(b.budget)}`;
}

export function PersonalBoard({ view }: { view: PersonalView }) {
  const [editing, setEditing] = useState<Expense | "new" | null>(null);
  const [budgetsOpen, setBudgetsOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const router = useRouter();
  const [pending, start] = useTransition();

  const byDay = useMemo(() => {
    const m = new Map<string, Expense[]>();
    for (const e of view.expenses) m.set(e.spent_on, [...(m.get(e.spent_on) ?? []), e]);
    return [...m];
  }, [view.expenses]);

  const change = view.lastTotal > 0 ? Math.round(((view.total - view.lastTotal) / view.lastTotal) * 100) : null;
  const warnings = [view.overallBudget, ...view.budgets].filter((b): b is Budget => Boolean(b && b.state !== "ok"));

  const openReceipt = (id: string) =>
    start(async () => {
      const r = await personalReceiptUrl(id);
      if (r.ok) window.open(r.data.url, "_blank", "noopener,noreferrer");
      else toast.error(r.error);
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold">My spending</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><Lock className="size-3.5" /> Only you can see this. It isn&apos;t shared with the family or added to the household sheet.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setEditing("new")}><Plus /> Add</Button>
          <Button variant="outline" onClick={() => setBudgetsOpen(true)}><Target /> Budgets</Button>
          <Button variant="outline" onClick={() => setCategoriesOpen(true)} aria-label="Categories"><Settings2 /></Button>
        </div>
      </div>

      <section className="rounded-2xl border bg-card p-5">
        <div className="flex items-center justify-between gap-2">
          <Button asChild variant="ghost" size="icon" aria-label={`Show ${view.previousLabel}`}><Link href={`/me?m=${view.prevMonth}`}><ChevronLeft /></Link></Button>
          <p className="font-medium">{view.monthLabel}</p>
          {view.nextMonth ? (
            <Button asChild variant="ghost" size="icon" aria-label="Next month"><Link href={`/me?m=${view.nextMonth}`}><ChevronRight /></Link></Button>
          ) : <span className="size-9" />}
        </div>
        <p className="num mt-3 text-center font-heading text-4xl font-bold">{rs(view.total)}</p>
        <p className="mt-1 text-center text-sm text-muted-foreground">
          {change === null ? "spent this month" : `${change === 0 ? "same as" : change > 0 ? `${change}% more than` : `${-change}% less than`} ${view.previousLabel} (${rs(view.lastTotal)})`}
        </p>
        {view.overallBudget ? (
          <div className="mx-auto mt-4 max-w-md">
            <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.min(100, view.overallBudget.percent)} aria-valuemin={0} aria-valuemax={100} aria-label="Monthly budget used">
              <div className={cn("h-full rounded-full", TONE[view.overallBudget.state])} style={{ width: `${Math.min(100, view.overallBudget.percent)}%` }} />
            </div>
            <p className="mt-1.5 text-center text-sm">{budgetLine(view.overallBudget)}</p>
          </div>
        ) : null}
        <div className="mt-4 flex justify-center gap-2">
          <Button asChild variant="ghost" size="sm"><a href={`/api/export/personal?m=${view.month}&format=xlsx`}><FileSpreadsheet /> Excel</a></Button>
          <Button asChild variant="ghost" size="sm"><a href={`/api/export/personal?m=${view.month}&format=pdf`}><FileText /> PDF</a></Button>
        </div>
      </section>

      {warnings.length ? (
        <ul className="space-y-2">
          {warnings.map((b) => (
            <li key={b.name} className={cn("flex gap-2 rounded-lg border px-3 py-2 text-sm", b.state === "over" ? "border-destructive/30 bg-danger-soft text-destructive" : "border-warning/30 bg-warning-soft text-warning")}>
              <TriangleAlert className="mt-0.5 size-4 shrink-0" /> <span><strong>{b.name}:</strong> {budgetLine(b)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel className="lg:col-span-3" title="By category" description={`${view.monthLabel} compared with ${view.previousLabel}`}>
          {view.breakdown.some((c) => c.total > 0) ? (
            <>
              <CategoryChart data={view.breakdown.filter((c) => c.total > 0).map((c) => ({ name: c.name, value: c.total }))} />
              <table className="num mt-4 w-full text-sm">
                <thead className="text-muted-foreground"><tr><th className="py-1 text-left font-medium">Category</th><th className="py-1 text-right font-medium">This month</th><th className="py-1 text-right font-medium">Last month</th></tr></thead>
                <tbody>
                  {view.breakdown.map((c) => (
                    <tr key={c.name} className="border-t"><td className="py-1.5">{c.name}</td><td className="py-1.5 text-right">{rs(c.total)}</td><td className="py-1.5 text-right text-muted-foreground">{c.last ? rs(c.last) : "-"}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">Nothing recorded in {view.monthLabel} yet.</p>
          )}
        </Panel>

        <Panel className="lg:col-span-2" title="Category budgets" actions={<Button size="sm" variant="ghost" onClick={() => setBudgetsOpen(true)}>Edit</Button>}>
          {view.budgets.length ? (
            <ul className="space-y-3">
              {view.budgets.map((b) => (
                <li key={b.name}>
                  <div className="flex justify-between text-sm"><span className="font-medium">{b.name}</span><span className="num">{rs(b.spent)} / {rs(b.budget)}</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", TONE[b.state])} style={{ width: `${Math.min(100, b.percent)}%` }} /></div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No category budgets. Set one to get a warning before you overspend.</p>
          )}
        </Panel>
      </div>

      <Panel title="Entries" description={`${view.expenses.length} in ${view.monthLabel}`} bodyClassName="p-0">
        {byDay.length ? (
          <ol>
            {byDay.map(([d, rows]) => (
              <li key={d} className="border-t first:border-t-0">
                <p className="flex justify-between bg-muted/40 px-5 py-1.5 text-xs font-medium text-muted-foreground"><span>{dayLabel(d)}</span><span className="num">{rs(rows.reduce((a, r) => a + r.amount, 0))}</span></p>
                <ul className="divide-y">
                  {rows.map((e) => (
                    <li key={e.id} className="flex items-center gap-3 px-5 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{e.note || e.categoryName}</p>
                        <p className="text-xs text-muted-foreground">{e.categoryName}</p>
                      </div>
                      {e.receipt_path ? (
                        <Button size="icon" variant="ghost" aria-label="Open receipt" disabled={pending} onClick={() => openReceipt(e.id)}><Paperclip /></Button>
                      ) : null}
                      <span className="num text-sm font-semibold">{rs(e.amount)}</span>
                      <Button size="icon" variant="ghost" aria-label="Edit" onClick={() => setEditing(e)}><Pencil /></Button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        ) : (
          <div className="flex flex-col items-center px-5 py-10 text-center">
            <p className="text-sm text-muted-foreground">Try &quot;petrol 3000&quot; or &quot;dawai 850&quot;.</p>
            <Button className="mt-3" onClick={() => setEditing("new")}><Plus /> Add your first entry</Button>
          </div>
        )}
      </Panel>

      {editing ? (
        <EntryDialog
          view={view}
          entry={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
      {budgetsOpen ? <BudgetsDialog view={view} onClose={() => { setBudgetsOpen(false); router.refresh(); }} /> : null}
      {categoriesOpen ? <CategoriesDialog categories={view.categories} onClose={() => { setCategoriesOpen(false); router.refresh(); }} /> : null}
    </div>
  );
}

function EntryDialog({ view, entry, onClose, onSaved }: { view: PersonalView; entry: Expense | null; onClose: () => void; onSaved: () => void }) {
  const active = view.categories.filter((c) => c.active || c.id === entry?.category_id);
  const [quick, setQuick] = useState("");
  const [amount, setAmount] = useState(entry ? String(entry.amount) : "");
  const [spentOn, setSpentOn] = useState(entry?.spent_on ?? (view.month === view.today.slice(0, 7) ? view.today : `${view.month}-01`));
  const [categoryId, setCategoryId] = useState(entry?.category_id ?? active.find((c) => c.name === "Other")?.id ?? "");
  const [note, setNote] = useState(entry?.note ?? "");
  const [receipt, setReceipt] = useState<{ path: string; mime: string } | null | undefined>(undefined);
  const [reading, setReading] = useState<number | null>(null);
  const [saving, start] = useTransition();

  const applyQuick = (text: string) => {
    setQuick(text);
    const q = parseQuickEntry(text);
    if (q.amount) setAmount(q.amount);
    if (q.name) setNote(q.name);
    const guess = guessPersonalCategory(text, view.history, active.map((c) => c.name));
    const cat = guess ? active.find((c) => c.name === guess) : null;
    if (cat) setCategoryId(cat.id);
  };

  const attach = async (f: File | undefined) => {
    if (!f) return;
    const small = await shrinkImage(f);
    const mime = small.type || f.type;
    if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(mime)) return toast.error("Upload a JPG, PNG, WebP or PDF receipt.");
    if (small.size > 5 * 1024 * 1024) return toast.error("That file is bigger than 5 MB.");
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" }[mime];
    const path = `${view.userId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await createSupabaseBrowser().storage.from("personal-receipts").upload(path, small, { contentType: mime, upsert: false });
    if (error) return toast.error("The receipt couldn't be uploaded. Try again.");
    setReceipt({ path, mime });
    if (mime.startsWith("image/")) {
      setReading(0);
      const text = await readImageText(small, (p) => setReading(p));
      setReading(null);
      const read = text ? parsePaymentText(text) : null;
      if (read?.amount && !amount) setAmount(String(Number(read.amount)));
      if (read?.paidOn) setSpentOn(read.paidOn);
      toast.success(read?.amount ? `Receipt attached. Read Rs ${Number(read.amount).toLocaleString("en-US")} from it; check it.` : "Receipt attached.");
    } else toast.success("Receipt attached.");
  };

  const save = () =>
    start(async () => {
      const r = await savePersonalExpense({
        id: entry?.id,
        categoryId: categoryId || null,
        amount,
        spentOn,
        note,
        ...(receipt === undefined ? {} : { receiptPath: receipt?.path ?? null, receiptMime: (receipt?.mime ?? null) as "image/jpeg" | null }),
      });
      if (r.ok) {
        toast.success(r.message ?? "Saved");
        onSaved();
      } else toast.error(r.error);
    });

  const discard = () => {
    if (receipt?.path) void createSupabaseBrowser().storage.from("personal-receipts").remove([receipt.path]);
    onClose();
  };

  const remove = async () => {
    if (!entry) return;
    const r = await deletePersonalExpense(entry.id);
    if (r.ok) {
      toast.success(r.message ?? "Deleted");
      onSaved();
    } else toast.error(r.error);
  };

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && !saving && discard()} title={entry ? "Edit entry" : "Add personal spending"} description="Only you can see this">
      <div className="space-y-4 pb-4">
        {!entry ? (
          <Field label="Quick add" htmlFor="quick" hint='Type or say it, e.g. "petrol 3000" or "dawai 850"'>
            <div className="relative">
              <Input id="quick" value={quick} onChange={(e) => applyQuick(e.target.value)} autoComplete="off" className="h-10 pr-11" placeholder="petrol 3000" />
              <VoiceButton className="absolute top-1 right-1" onText={(t) => applyQuick(t)} />
            </div>
          </Field>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount (Rs)" htmlFor="amount">
            <Input id="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="num h-10" />
          </Field>
          <Field label="Date" htmlFor="date">
            <Input id="date" type="date" value={spentOn} max={view.today} onChange={(e) => setSpentOn(e.target.value)} className="h-10" />
          </Field>
          <Field label="Category" htmlFor="category">
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id="category" className="h-10 w-full"><SelectValue placeholder="Choose" /></SelectTrigger>
              <SelectContent>{active.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Note (optional)" htmlFor="note">
            <Input id="note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} className="h-10" />
          </Field>
        </div>
        <Field label="Receipt (optional)" htmlFor="receipt" hint={entry?.receipt_path && receipt === undefined ? "A receipt is attached. Choose a file to replace it." : "Read on this phone; private to you."}>
          <Input id="receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => void attach(e.target.files?.[0])} className="h-10" />
        </Field>
        {reading !== null ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Reading the receipt on this phone… {Math.round(reading * 100)}%</p>
        ) : null}
        {entry?.receipt_path && receipt === undefined ? (
          <Button variant="ghost" size="sm" onClick={() => setReceipt(null)}><Trash2 /> Remove receipt</Button>
        ) : null}
        <div className="flex gap-2">
          {entry ? (
            <ConfirmButton variant="outline" className="h-11 text-destructive" title="Delete this entry?" description="It and its receipt are removed." confirmLabel="Delete" destructive onConfirm={remove}>
              <Trash2 />
            </ConfirmButton>
          ) : null}
          <Button variant="outline" className="h-11 flex-1" onClick={discard} disabled={saving}>Cancel</Button>
          <Button className="h-11 flex-[2]" onClick={save} disabled={saving || reading !== null || !amount}>
            {saving ? <Loader2 className="animate-spin" /> : null} {entry ? "Save" : "Add"}
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}

function BudgetsDialog({ view, onClose }: { view: PersonalView; onClose: () => void }) {
  const current = new Map([view.overallBudget, ...view.budgets].filter((b): b is Budget => Boolean(b)).map((b) => [b.categoryId ?? "all", String(b.budget)]));
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(current));
  const [saving, start] = useTransition();
  const rows = [{ key: "all", id: null as string | null, name: "All spending (monthly)" }, ...view.categories.filter((c) => c.active).map((c) => ({ key: c.id, id: c.id as string | null, name: c.name }))];

  const save = () =>
    start(async () => {
      for (const r of rows) {
        const before = current.get(r.key) ?? "";
        const after = (values[r.key] ?? "").trim();
        if (before === after) continue;
        const res = await savePersonalBudget({ categoryId: r.id, amount: after });
        if (!res.ok) return void toast.error(`${r.name}: ${res.error}`);
      }
      toast.success("Budgets saved");
      onClose();
    });

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && !saving && onClose()} title="Monthly budgets" description="Leave a box empty for no budget. The same budgets apply every month.">
      <div className="space-y-3 pb-4">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-3">
            <label htmlFor={`b-${r.key}`} className={cn("flex-1 text-sm", r.id === null && "font-medium")}>{r.name}</label>
            <Input id={`b-${r.key}`} inputMode="decimal" placeholder="Rs" value={values[r.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [r.key]: e.target.value }))} className="num h-10 w-36" />
          </div>
        ))}
        <div className="flex gap-2 pt-2">
          <Button variant="outline" className="h-11 flex-1" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button className="h-11 flex-[2]" onClick={save} disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : null} Save budgets</Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}

function CategoriesDialog({ categories, onClose }: { categories: Category[]; onClose: () => void }) {
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Saved");
      else toast.error(r.error ?? "Couldn't save");
    });
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && !pending && onClose()} title="My categories">
      <div className="space-y-3 pb-4">
        <ul className="divide-y rounded-lg border">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span className={cn(!c.active && "text-muted-foreground line-through")}>{c.name}</span>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => savePersonalCategory({ id: c.id, name: c.name, active: !c.active }))}>{c.active ? "Hide" : "Show"}</Button>
            </li>
          ))}
        </ul>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const r = await savePersonalCategory({ name });
              if (r.ok) setName("");
              return r;
            });
          }}
        >
          <Input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="New category, e.g. Car" className="h-10" aria-label="New category name" />
          <Button type="submit" disabled={pending || !name.trim()}><Plus /> Add</Button>
        </form>
        <Button variant="outline" className="h-11 w-full" onClick={onClose}>Done</Button>
      </div>
    </ResponsiveDialog>
  );
}
