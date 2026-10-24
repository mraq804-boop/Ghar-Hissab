"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, Loader2, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ResponsiveDialog } from "@/components/ledger/responsive-dialog";
import { KIND_LABEL, selectionParams, type CategoryKind, type FilterCategory } from "@/lib/dashboard/filter";
import { cn } from "@/lib/utils";

const KINDS: CategoryKind[] = ["essential", "variable"];
const HINT: Record<CategoryKind, string> = { essential: "Bills, groceries, maid and other fixed costs", variable: "Milk, sabzi, chicken, mutton and keema" };

export function CategoryFilter({ categories, selectedIds, group }: { categories: FilterCategory[]; selectedIds: string[] | null; group: CategoryKind | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const active = categories.filter((c) => c.active);
  const [chosen, setChosen] = useState<Set<string>>(new Set(selectedIds ?? active.map((c) => c.id)));

  const go = (next: { group?: CategoryKind; cats?: string }) => {
    const q = new URLSearchParams(params);
    for (const k of ["cat", "cats", "group"]) q.delete(k);
    if (next.group) q.set("group", next.group);
    if (next.cats) q.set("cats", next.cats);
    start(() => router.replace(`${pathname}${q.size ? `?${q}` : ""}`, { scroll: false }));
  };

  const custom = selectedIds !== null && group === null;
  const chip = (label: string, on: boolean, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn("h-9 rounded-full border px-3.5 text-sm transition-colors", on ? "border-transparent bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}
    >
      {label}
    </button>
  );

  const toggleGroup = (kind: CategoryKind, on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      for (const c of active.filter((x) => x.kind === kind)) {
        if (on) next.add(c.id);
        else next.delete(c.id);
      }
      return next;
    });

  return (
    <div className={cn("flex flex-wrap items-center gap-2", pending && "opacity-70")}>
      {chip("All", selectedIds === null, () => go({}))}
      {KINDS.map((k) => chip(KIND_LABEL[k], group === k, () => go({ group: k })))}
      <Button
        variant="outline"
        size="sm"
        className={cn("h-9 rounded-full", custom && "border-haldi/70")}
        onClick={() => {
          setChosen(new Set(selectedIds ?? active.map((c) => c.id)));
          setOpen(true);
        }}
      >
        {pending ? <Loader2 className="animate-spin" /> : <SlidersHorizontal />} {custom ? `${selectedIds!.length} selected` : "Choose…"}
      </Button>

      <ResponsiveDialog open={open} onOpenChange={setOpen} title="Show categories" description="Changes what the totals and charts show. Shares and balances stay the full month.">
        <div className="space-y-5 pb-4">
          {KINDS.map((kind) => {
            const list = active.filter((c) => c.kind === kind);
            if (!list.length) return null;
            const all = list.every((c) => chosen.has(c.id));
            return (
              <section key={kind} className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{KIND_LABEL[kind]}</p>
                    <p className="text-xs text-muted-foreground">{HINT[kind]}</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => toggleGroup(kind, !all)}>{all ? "Clear" : "Select all"}</Button>
                </div>
                <ul className="grid gap-1 sm:grid-cols-2">
                  {list.map((c) => (
                    <li key={c.id}>
                      <label className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm hover:bg-muted/50">
                        <Checkbox
                          checked={chosen.has(c.id)}
                          onCheckedChange={(v) =>
                            setChosen((prev) => {
                              const next = new Set(prev);
                              if (v) next.add(c.id);
                              else next.delete(c.id);
                              return next;
                            })
                          }
                        />
                        {c.name}
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          <div className="flex gap-2">
            <Button variant="outline" className="h-11 flex-1" onClick={() => setChosen(new Set(active.map((c) => c.id)))}>Show all</Button>
            <Button
              className="h-11 flex-[2]"
              disabled={!chosen.size}
              onClick={() => {
                setOpen(false);
                go(selectionParams(categories, [...chosen]));
              }}
            >
              <Check /> Apply{chosen.size && chosen.size < active.length ? ` (${chosen.size})` : ""}
            </Button>
          </div>
        </div>
      </ResponsiveDialog>
    </div>
  );
}
