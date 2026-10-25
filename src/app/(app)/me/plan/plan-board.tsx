"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarDays, Check, ChevronLeft, ChevronRight, ClipboardCopy, Loader2, Lock, Pencil, Plus, Repeat, RotateCcw, SkipForward, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmButton } from "@/components/ledger/confirm-button";
import { Field } from "@/components/ledger/field";
import { Panel } from "@/components/ledger/page-header";
import { ResponsiveDialog } from "@/components/ledger/responsive-dialog";
import { VoiceButton } from "@/components/ledger/voice-button";
import { shrinkImage } from "@/lib/images";
import { guessPersonalCategory } from "@/lib/personal/budget";
import type { PlanItem, PlanSummary } from "@/lib/personal/plan";
import { parseQuickEntry } from "@/lib/smart/suggest";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { carryRepeating, copyFromLastMonth, deletePlanItem, markBought, savePlanItem, setPlanStatus } from "../plan-actions";

type Category = { id: string; name: string; active: boolean };

const rs = (n: number) => `Rs ${Math.round(n).toLocaleString("en-US")}`;
const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export function MeTabs({ active }: { active: "spent" | "plan" | "salaries" }) {
  return (
    <div className="inline-flex rounded-full border bg-muted/40 p-1 text-sm" role="tablist" aria-label="My spending">
      {(
        [
          ["spent", "/me", "Spent"],
          ["plan", "/me/plan", "Plan"],
          ["salaries", "/me/salaries", "Salaries"],
        ] as const
      ).map(([key, href, text]) => (
        <Link key={key} href={href} role="tab" aria-selected={active === key} className={cn("rounded-full px-3.5 py-1.5 sm:px-4", active === key ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          {text}
        </Link>
      ))}
    </div>
  );
}

export function PlanBoard({
  userId,
  month,
  monthLabel,
  prevMonth,
  nextMonth,
  today,
  items,
  categories,
  summary,
}: {
  userId: string;
  month: string;
  monthLabel: string;
  prevMonth: string;
  nextMonth: string | null;
  today: string;
  items: PlanItem[];
  categories: Category[];
  summary: PlanSummary;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<PlanItem | "new" | null>(null);
  const [buying, setBuying] = useState<PlanItem | null>(null);

  const groups = useMemo(() => {
    const label = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "Other";
    const m = new Map<string, PlanItem[]>();
    for (const i of items) m.set(label(i.categoryId), [...(m.get(label(i.categoryId)) ?? []), i]);
    return [...m].sort((a, b) => b[1].reduce((x, i) => x + i.estimate, 0) - a[1].reduce((x, i) => x + i.estimate, 0));
  }, [items, categories]);

  const act = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Done");
      else toast.error(r.error ?? "Something went wrong");
      router.refresh();
    });

  const pct = summary.budget ? Math.min(100, Math.round((summary.planned / summary.budget) * 100)) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-3">
          <MeTabs active="plan" />
          <div>
            <h1 className="font-heading text-3xl font-bold">My plan</h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><Lock className="size-3.5" /> Things you plan to buy or pay. Only you can see this.</p>
          </div>
        </div>
        <Button onClick={() => setEditing("new")}><Plus /> Add item</Button>
      </div>

      <section className="rounded-2xl border bg-card p-5">
        <div className="flex items-center justify-between gap-2">
          <Button asChild variant="ghost" size="icon" aria-label="Previous month"><Link href={`/me/plan?m=${prevMonth}`}><ChevronLeft /></Link></Button>
          <p className="font-medium">{monthLabel}</p>
          {nextMonth ? <Button asChild variant="ghost" size="icon" aria-label="Next month"><Link href={`/me/plan?m=${nextMonth}`}><ChevronRight /></Link></Button> : <span className="size-9" />}
        </div>
        <p className="num mt-3 text-center font-heading text-4xl font-bold">{rs(summary.planned)}</p>
        <p className="mt-1 text-center text-sm text-muted-foreground">
          planned across {summary.count} item{summary.count === 1 ? "" : "s"} · {rs(summary.bought)} bought · {rs(summary.remaining)} still to buy ({summary.toBuy})
        </p>
        {summary.budget ? (
          <div className="mx-auto mt-4 max-w-md">
            <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Plan compared with budget" aria-valuenow={pct ?? 0} aria-valuemin={0} aria-valuemax={100}>
              <div className={cn("h-full rounded-full", summary.overBudgetBy ? "bg-destructive" : (pct ?? 0) >= 85 ? "bg-warning" : "bg-success")} style={{ width: `${pct}%` }} />
            </div>
            <p className={cn("mt-1.5 text-center text-sm", summary.overBudgetBy && "text-destructive")}>
              {summary.overBudgetBy ? `${rs(summary.overBudgetBy)} over your ${rs(summary.budget)} monthly budget` : `${rs(summary.budget - summary.planned)} left in your ${rs(summary.budget)} monthly budget`}
            </p>
          </div>
        ) : (
          <p className="mt-3 text-center text-xs text-muted-foreground">Set a monthly budget on the Spent tab to compare your plan with it.</p>
        )}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => copyFromLastMonth(month))}><ClipboardCopy /> Copy from last month&apos;s spending</Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => carryRepeating(month))}><Repeat /> Bring repeating items</Button>
        </div>
      </section>

      {groups.length ? (
        groups.map(([cat, list]) => (
          <Panel key={cat} title={cat} description={`${rs(list.filter((i) => i.status !== "skipped").reduce((a, i) => a + (i.status === "bought" ? (i.actual ?? i.estimate) : i.estimate), 0))} planned`} bodyClassName="p-0">
            <ul className="divide-y">
              {list.map((i) => (
                <li key={i.id} className={cn("flex items-center gap-3 px-5 py-3", i.status !== "planned" && "opacity-70")}>
                  <div className="min-w-0 flex-1">
                    <p className={cn("flex flex-wrap items-center gap-x-2 text-sm font-medium", i.status === "skipped" && "line-through")}>
                      {i.title}
                      {i.repeatMonthly ? <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground"><Repeat className="size-3" />monthly</span> : null}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      {i.status === "bought" ? (
                        <span className="text-success">Bought for {rs(i.actual ?? i.estimate)}{i.actual !== null && i.actual !== i.estimate ? ` (planned ${rs(i.estimate)})` : ""}</span>
                      ) : i.status === "skipped" ? (
                        <span>Skipped</span>
                      ) : (
                        <span className="num">{rs(i.estimate)}</span>
                      )}
                      {i.dueDate && i.status === "planned" ? (
                        <span className={cn("inline-flex items-center gap-1", i.dueDate < today && "text-destructive")}><CalendarDays className="size-3" />{day(i.dueDate)}</span>
                      ) : null}
                    </p>
                  </div>
                  {i.status === "planned" ? (
                    <>
                      <Button size="sm" onClick={() => setBuying(i)}><Check /> Bought</Button>
                      <Button size="icon" variant="ghost" aria-label="Skip this month" disabled={pending} onClick={() => act(() => setPlanStatus(i.id, "skipped"))}><SkipForward /></Button>
                    </>
                  ) : i.status === "skipped" ? (
                    <Button size="icon" variant="ghost" aria-label="Put back on the list" disabled={pending} onClick={() => act(() => setPlanStatus(i.id, "planned"))}><RotateCcw /></Button>
                  ) : null}
                  {i.status !== "bought" ? <Button size="icon" variant="ghost" aria-label="Edit" onClick={() => setEditing(i)}><Pencil /></Button> : null}
                  <ConfirmButton
                    size="icon"
                    variant="ghost"
                    aria-label="Remove from plan"
                    title={`Remove "${i.title}" from the plan?`}
                    description={i.status === "bought" ? "The spending entry it created stays in Spent." : "It's removed from this month's plan."}
                    confirmLabel="Remove"
                    destructive
                    onConfirm={() => act(() => deletePlanItem(i.id))}
                  >
                    <Trash2 />
                  </ConfirmButton>
                </li>
              ))}
            </ul>
          </Panel>
        ))
      ) : (
        <div className="flex flex-col items-center rounded-2xl border px-5 py-10 text-center">
          <p className="text-sm text-muted-foreground">Nothing planned for {monthLabel} yet. Try &quot;petrol 12000&quot; or &quot;school fee 8000&quot;.</p>
          <Button className="mt-3" onClick={() => setEditing("new")}><Plus /> Add the first item</Button>
        </div>
      )}

      {editing ? (
        <ItemDialog month={month} categories={categories} item={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); start(() => router.refresh()); }} />
      ) : null}
      {buying ? (
        <BoughtDialog userId={userId} item={buying} today={today} onClose={() => setBuying(null)} onSaved={() => { setBuying(null); start(() => router.refresh()); }} />
      ) : null}
    </div>
  );
}

function ItemDialog({ month, categories, item, onClose, onSaved }: { month: string; categories: Category[]; item: PlanItem | null; onClose: () => void; onSaved: () => void }) {
  const active = categories.filter((c) => c.active || c.id === item?.categoryId);
  const [quick, setQuick] = useState("");
  const [title, setTitle] = useState(item?.title ?? "");
  const [estimate, setEstimate] = useState(item ? String(item.estimate) : "");
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? active.find((c) => c.name === "Other")?.id ?? "");
  const [dueDate, setDueDate] = useState(item?.dueDate ?? "");
  const [repeat, setRepeat] = useState(item?.repeatMonthly ?? false);
  const [saving, start] = useTransition();
  const [y, m] = month.split("-").map(Number);
  const lastDay = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;

  const applyQuick = (text: string) => {
    setQuick(text);
    const q = parseQuickEntry(text);
    if (q.amount) setEstimate(q.amount);
    if (q.name) setTitle(q.name);
    const guess = guessPersonalCategory(text, [], active.map((c) => c.name));
    const cat = guess ? active.find((c) => c.name === guess) : null;
    if (cat) setCategoryId(cat.id);
  };

  const save = () =>
    start(async () => {
      const r = await savePlanItem({ id: item?.id, month, title, categoryId: categoryId || null, estimate, dueDate, repeatMonthly: repeat });
      if (r.ok) {
        toast.success(r.message ?? "Saved");
        onSaved();
      } else toast.error(r.error);
    });

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && !saving && onClose()} title={item ? "Edit planned item" : "Plan an item"} description="Only you can see this">
      <div className="space-y-4 pb-4">
        {!item ? (
          <Field label="Quick add" htmlFor="plan-quick" hint='Type or say it, e.g. "petrol 12000"'>
            <div className="relative">
              <Input id="plan-quick" value={quick} onChange={(e) => applyQuick(e.target.value)} autoComplete="off" className="h-10 pr-11" placeholder="petrol 12000" />
              <VoiceButton className="absolute top-1 right-1" onText={(t) => applyQuick(t)} />
            </div>
          </Field>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Item" htmlFor="plan-title"><Input id="plan-title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} className="h-10" /></Field>
          <Field label="Estimated amount (Rs)" htmlFor="plan-estimate"><Input id="plan-estimate" inputMode="decimal" value={estimate} onChange={(e) => setEstimate(e.target.value)} className="num h-10" /></Field>
          <Field label="Category" htmlFor="plan-category">
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id="plan-category" className="h-10 w-full"><SelectValue placeholder="Choose" /></SelectTrigger>
              <SelectContent>{active.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Date (optional)" htmlFor="plan-date" hint="You'll get a reminder that day">
            <Input id="plan-date" type="date" min={`${month}-01`} max={lastDay} value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-10" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={repeat} onCheckedChange={(v) => setRepeat(v === true)} /> Repeat every month
        </label>
        <div className="flex gap-2">
          <Button variant="outline" className="h-11 flex-1" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button className="h-11 flex-[2]" onClick={save} disabled={saving || !title.trim() || !estimate}>{saving ? <Loader2 className="animate-spin" /> : null} {item ? "Save" : "Add to plan"}</Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}

function BoughtDialog({ userId, item, today, onClose, onSaved }: { userId: string; item: PlanItem; today: string; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState(String(item.estimate));
  const [spentOn, setSpentOn] = useState(item.dueDate && item.dueDate <= today ? item.dueDate : today);
  const [receipt, setReceipt] = useState<{ path: string; mime: string } | null>(null);
  const [saving, start] = useTransition();

  const attach = async (f: File | undefined) => {
    if (!f) return;
    const small = await shrinkImage(f);
    const mime = small.type || f.type;
    if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(mime)) return toast.error("Upload a JPG, PNG, WebP or PDF receipt.");
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" }[mime];
    const path = `${userId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await createSupabaseBrowser().storage.from("personal-receipts").upload(path, small, { contentType: mime, upsert: false });
    if (error) return toast.error("The receipt couldn't be uploaded. Try again.");
    setReceipt({ path, mime });
    toast.success("Receipt attached");
  };

  const discard = () => {
    if (receipt) void createSupabaseBrowser().storage.from("personal-receipts").remove([receipt.path]);
    onClose();
  };

  const save = () =>
    start(async () => {
      const r = await markBought({ id: item.id, amount, spentOn, receiptPath: receipt?.path ?? null, receiptMime: (receipt?.mime ?? null) as "image/jpeg" | null });
      if (r.ok) {
        toast.success(r.message ?? "Saved");
        onSaved();
      } else toast.error(r.error);
    });

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && !saving && discard()} title={`Bought: ${item.title}`} description={`Planned ${rs(item.estimate)}. It's added to Spent.`}>
      <div className="space-y-4 pb-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Actual amount (Rs)" htmlFor="buy-amount"><Input id="buy-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="num h-10" /></Field>
          <Field label="Date" htmlFor="buy-date"><Input id="buy-date" type="date" max={today} value={spentOn} onChange={(e) => setSpentOn(e.target.value)} className="h-10" /></Field>
        </div>
        <Field label="Receipt (optional)" htmlFor="buy-receipt">
          <Input id="buy-receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => void attach(e.target.files?.[0])} className="h-10" />
        </Field>
        <div className="flex gap-2">
          <Button variant="outline" className="h-11 flex-1" onClick={discard} disabled={saving}>Cancel</Button>
          <Button className="h-11 flex-[2]" onClick={save} disabled={saving || !amount}>{saving ? <Loader2 className="animate-spin" /> : <Check />} Mark bought</Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}
