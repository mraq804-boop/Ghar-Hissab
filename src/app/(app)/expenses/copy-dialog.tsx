"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ClipboardCopy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Money } from "@/components/ledger/money";
import { ResponsiveDialog } from "@/components/ledger/responsive-dialog";
import { copyTotal, defaultTicks, groupForCopy } from "@/lib/expenses/copy";
import { cn } from "@/lib/utils";
import { copyExpenses, copySource, type CopySource } from "./copy-actions";

export function CopyDialog({ open, onOpenChange, toPeriod, months }: { open: boolean; onOpenChange: (o: boolean) => void; toPeriod: { id: string; label: string }; months: { id: string; label: string }[] }) {
  const router = useRouter();
  const [fromId, setFromId] = useState(months[0]?.id ?? "");
  const [source, setSource] = useState<CopySource | null>(null);
  const [loadedFor, setLoadedFor] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [loading, startLoad] = useTransition();
  const [saving, startSave] = useTransition();

  useEffect(() => {
    if (!open || !fromId || loadedFor === fromId) return;
    startLoad(async () => {
      const r = await copySource({ fromPeriodId: fromId, toPeriodId: toPeriod.id });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setSource(r.data);
      setLoadedFor(fromId);
      setChosen(new Set());
    });
  }, [open, fromId, loadedFor, toPeriod.id]);

  const groups = useMemo(() => (source ? groupForCopy(source.items, source.target) : []), [source]);
  const total = source ? copyTotal(source.items, chosen) : 0n;
  const fromLabel = months.find((m) => m.id === fromId)?.label ?? "";

  const setMany = (ids: string[], on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const apply = () =>
    startSave(async () => {
      const r = await copyExpenses({ fromPeriodId: fromId, toPeriodId: toPeriod.id, ids: [...chosen] });
      if (r.ok) {
        toast.success(r.message);
        onOpenChange(false);
        setLoadedFor("");
      } else toast.error(r.error);
      router.refresh();
    });

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => !saving && onOpenChange(o)}
      title={`Copy into ${toPeriod.label}`}
      description="Pick a category, untick anything you don't need. Amounts and sharing are copied; dates, receipts and notes are not, and the purse pays."
    >
      <div className="space-y-4">
        {months.length > 1 ? (
          <Select value={fromId} onValueChange={(v) => setFromId(v)}>
            <SelectTrigger className="h-10 w-full" aria-label="Copy from"><SelectValue /></SelectTrigger>
            <SelectContent>{months.map((m) => <SelectItem key={m.id} value={m.id}>From {m.label}</SelectItem>)}</SelectContent>
          </Select>
        ) : (
          <p className="text-sm text-muted-foreground">From {fromLabel}</p>
        )}

        {loading || !source ? (
          <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading {fromLabel}…</p>
        ) : !groups.length ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{fromLabel} has no expenses to copy.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Categories">
              {groups.map((g) => {
                const ticks = defaultTicks(g);
                const on = ticks.length > 0 && ticks.every((id) => chosen.has(id));
                return (
                  <button
                    key={g.key}
                    type="button"
                    aria-pressed={on}
                    disabled={!ticks.length}
                    onClick={() => setMany(ticks, !on)}
                    className={cn("rounded-full border px-3 py-1.5 text-sm transition-colors disabled:opacity-50", on ? "border-transparent bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}
                  >
                    {g.name} <span className={cn("text-xs", on ? "opacity-80" : "text-muted-foreground")}>· {g.items.length}</span>
                  </button>
                );
              })}
            </div>

            <div className="space-y-4">
              {groups
                .filter((g) => g.items.some((i) => chosen.has(i.id)))
                .map((g) => (
                  <section key={g.key}>
                    <p className="mb-1.5 flex items-baseline justify-between text-sm font-medium">
                      {g.name}
                      <Money paisa={g.totalPaisa} className="text-xs text-muted-foreground" />
                    </p>
                    <ul className="divide-y rounded-xl border">
                      {g.items.map((i) => (
                        <li key={i.id}>
                          <label className={cn("flex items-center gap-3 px-3 py-2.5 text-sm", i.exists && "text-muted-foreground")}>
                            <Checkbox checked={chosen.has(i.id)} onCheckedChange={(v) => setMany([i.id], v === true)} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate">{i.title}</span>
                              {i.qtyText || i.exists ? (
                                <span className="block text-xs text-muted-foreground">
                                  {[i.qtyText, i.exists ? "already added" : null].filter(Boolean).join(" · ")}
                                </span>
                              ) : null}
                            </span>
                            {i.amountPaisa === null ? <span className="text-xs text-muted-foreground">not issued</span> : <Money paisa={i.amountPaisa} className="shrink-0" />}
                          </label>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              {!chosen.size ? <p className="py-6 text-center text-sm text-muted-foreground">Tap a category above to choose its items.</p> : null}
            </div>
          </>
        )}

        <div className="sticky bottom-0 -mx-4 flex gap-2 border-t bg-popover px-4 pt-3 pb-2">
          <Button variant="outline" className="h-11 flex-1" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button className="h-11 flex-[2]" disabled={saving || !chosen.size} onClick={apply}>
            {saving ? <Loader2 className="animate-spin" /> : <ClipboardCopy />}
            {chosen.size ? <>Copy {chosen.size} item{chosen.size === 1 ? "" : "s"} · <Money paisa={total} /></> : "Copy"}
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}
