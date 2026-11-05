"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { flushSync } from "react-dom";
import { ChevronLeft, ChevronRight, Loader2, Plus, Printer, Receipt, Share2, ShoppingBasket, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Field } from "@/components/ledger/field";
import { ResponsiveDialog } from "@/components/ledger/responsive-dialog";
import { menuWeek, menuWeekday, weekOf, weeksOfMonth } from "@/lib/kitchen";
import { MONTHS_LONG } from "@/lib/periods";
import { BASE_PEOPLE, SHOPPING_GROUPS, formatKg, shoppingList, type ShoppingRow } from "@/lib/shopping";
import { cn } from "@/lib/utils";
import { addShoppingToExpenses, addSabzi, fillRoster, removeSabzi, saveDayCategory, saveDish, saveDutyDay } from "./actions";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const NONE = "__none";

type Slot = { week: number; weekday: number; fixed_category: string; dish: string };
type Member = { id: string; label: string; name: string; active: boolean; hasLabel: boolean };
type Duty = { day: string; breakfast_member_id: string | null; lunch_member_id: string | null; dinner_member_id: string | null; off_member_id: string | null; off_note: string | null };

export function KitchenBoard(props: {
  admin: boolean;
  tab: "menu" | "duties";
  slots: Slot[];
  sabzi: { id: string; name: string }[];
  month: { year: number; month: number; key: string };
  days: string[];
  duties: Duty[];
  members: Member[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const setTab = (t: string) => {
    const n = new URLSearchParams(params);
    n.set("tab", t);
    router.replace(`${pathname}?${n}`, { scroll: false });
  };
  return (
    <Tabs value={props.tab} onValueChange={setTab}>
      <TabsList className="mb-5">
        <TabsTrigger value="menu">4-week menu</TabsTrigger>
        <TabsTrigger value="duties">Duty roster</TabsTrigger>
      </TabsList>
      <TabsContent value="menu"><MenuBoard {...props} /></TabsContent>
      <TabsContent value="duties"><DutyBoard {...props} /></TabsContent>
    </Tabs>
  );
}

function MenuBoard({ admin, slots, sabzi }: { admin: boolean; slots: Slot[]; sabzi: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [newSabzi, setNewSabzi] = useState("");
  const slot = (w: number, d: number) => slots.find((s) => s.week === w && s.weekday === d);

  const setDish = (week: number, weekday: number, dish: string) =>
    start(async () => {
      const r = await saveDish({ week, weekday, dish });
      if (!r.ok) toast.error(r.error);
      router.refresh();
    });

  return (
    <div className="space-y-4">
    <PrintWeek slot={slot} admin={admin} />
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="overflow-hidden rounded-2xl border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="w-28 px-4 py-2.5 font-medium">Day</th>
                <th className="w-40 px-3 py-2.5 font-medium">Fixed category</th>
                {[1, 2, 3, 4].map((w) => <th key={w} className="px-3 py-2.5 font-medium">Week {w}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y">
              {WEEKDAYS.map((day, i) => {
                const wd = i + 1;
                return (
                  <tr key={day} className="align-top">
                    <th scope="row" className="px-4 py-3 text-left font-heading font-semibold">{day}</th>
                    <td className="px-3 py-2">
                      {admin ? (
                        <EditableText
                          value={slot(1, wd)?.fixed_category ?? ""}
                          label={`${day} category`}
                          onSave={(v) => start(async () => {
                            const r = await saveDayCategory({ weekday: wd, category: v });
                            if (!r.ok) toast.error(r.error);
                            router.refresh();
                          })}
                          muted
                        />
                      ) : (
                        <span className="text-muted-foreground">{slot(1, wd)?.fixed_category}</span>
                      )}
                    </td>
                    {[1, 2, 3, 4].map((w) => {
                      const key = `${w}-${wd}`;
                      return (
                        <td
                          key={w}
                          className={cn("px-3 py-2 transition-colors", dragOver === key && "bg-accent")}
                          onDragOver={admin ? (e) => { e.preventDefault(); setDragOver(key); } : undefined}
                          onDragLeave={() => setDragOver(null)}
                          onDrop={admin ? (e) => {
                            e.preventDefault();
                            setDragOver(null);
                            const name = e.dataTransfer.getData("text/plain");
                            if (name) setDish(w, wd, name);
                          } : undefined}
                        >
                          {admin ? (
                            <EditableText value={slot(w, wd)?.dish ?? ""} label={`${day} week ${w}`} onSave={(v) => setDish(w, wd, v)} />
                          ) : (
                            <span>{slot(w, wd)?.dish || <span className="text-muted-foreground">—</span>}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {pending ? <p className="flex items-center gap-2 border-t px-4 py-2 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Saving…</p> : null}
      </div>

      <aside className="rounded-2xl border bg-card p-5">
        <h2 className="font-heading font-semibold">Sabzi options</h2>
        <p className="mt-1 text-sm text-muted-foreground">{admin ? "Drag one onto a day, or click a day to type." : "Pick by season and market."}</p>
        <ul className="mt-4 flex flex-wrap gap-2">
          {sabzi.map((s) => (
            <li key={s.id}>
              <span
                draggable={admin}
                onDragStart={(e) => e.dataTransfer.setData("text/plain", s.name)}
                className={cn("inline-flex items-center gap-1 rounded-full border bg-background py-1 pr-1 pl-3 text-sm", admin && "cursor-grab active:cursor-grabbing")}
              >
                {s.name}
                {admin ? (
                  <button
                    type="button"
                    aria-label={`Remove ${s.name}`}
                    className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => start(async () => {
                      const r = await removeSabzi(s.id);
                      if (!r.ok) toast.error(r.error);
                      router.refresh();
                    })}
                  >
                    <X className="size-3" />
                  </button>
                ) : <span className="w-2" />}
              </span>
            </li>
          ))}
        </ul>
        {admin ? (
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const r = await addSabzi(newSabzi);
                if (r.ok) setNewSabzi("");
                else toast.error(r.error);
                router.refresh();
              });
            }}
          >
            <Input value={newSabzi} onChange={(e) => setNewSabzi(e.target.value)} placeholder="Add a vegetable" className="h-9" aria-label="New sabzi option" />
            <Button type="submit" size="icon" className="size-9" aria-label="Add" disabled={!newSabzi.trim()}><Plus /></Button>
          </form>
        ) : null}
      </aside>
    </div>
    </div>
  );
}

function ShoppingToExpenses({ open, onOpenChange, list }: { open: boolean; onOpenChange: (o: boolean) => void; list: ShoppingRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const today = new Date();
  const [date, setDate] = useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`);
  const [rows, setRows] = useState(list.map((r) => ({ group: r.group, item: r.item, kg: String(r.kg), amount: "" })));
  const priced = rows.filter((r) => r.amount.trim() && Number(r.kg) > 0);
  const total = priced.reduce((a, r) => a + (Number(r.amount.replace(/,/g, "")) || 0), 0);
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = () =>
    start(async () => {
      const r = await addShoppingToExpenses({ date, items: priced.map((x) => ({ group: x.group, item: x.item, kg: Number(x.kg), amount: x.amount })) });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(r.message);
      onOpenChange(false);
      router.refresh();
    });

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Add shopping to expenses" description="Type what you paid for each item. Items left blank are skipped. Paid from the purse.">
      <div className="space-y-4">
        <Field label="Shopping date" htmlFor="shop-date">
          <Input id="shop-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-10 w-44" />
        </Field>
        <ul className="divide-y rounded-xl border">
          {rows.map((r, i) => (
            <li key={`${r.group}-${r.item}`} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 basis-40">
                {r.item}
                <span className="block text-xs text-muted-foreground">{r.group}</span>
              </span>
              <label className="flex items-center gap-1 text-sm">
                <Input aria-label={`${r.item} kg`} type="number" inputMode="decimal" step="0.25" min={0} value={r.kg} onChange={(e) => set(i, { kg: e.target.value })} className="h-9 w-20" />
                kg
              </label>
              <label className="flex items-center gap-1 text-sm">
                Rs
                <Input aria-label={`${r.item} price`} inputMode="numeric" placeholder="Price" value={r.amount} onChange={(e) => set(i, { amount: e.target.value })} className="h-9 w-28" />
              </label>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">
            {priced.length} item{priced.length === 1 ? "" : "s"} · Rs {total.toLocaleString("en-US")}
          </span>
          <Button onClick={save} disabled={pending || !priced.length || !date}>
            {pending ? <Loader2 className="animate-spin" /> : <Receipt />} Add {priced.length || ""} to expenses
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}

function PrintWeek({ slot, admin }: { slot: (week: number, weekday: number) => Slot | undefined; admin: boolean }) {
  const [addOpen, setAddOpen] = useState(false);
  const [which, setWhich] = useState<"this" | "next" | "month" | "nextMonth">("next");
  const [sheet, setSheet] = useState<"menu" | "list">("menu");
  const [listOpen, setListOpen] = useState(false);
  const [people, setPeople] = useState(String(BASE_PEOPLE));
  const monthMode = which === "month" || which === "nextMonth";
  const { weeks, monthTitle } = useMemo(() => {
    const now = new Date();
    if (which === "month" || which === "nextMonth") {
      const first = new Date(now.getFullYear(), now.getMonth() + (which === "nextMonth" ? 1 : 0), 1);
      return { weeks: weeksOfMonth(first.getFullYear(), first.getMonth() + 1), monthTitle: `${MONTHS_LONG[first.getMonth()]} ${first.getFullYear()}` };
    }
    if (which === "next") now.setDate(now.getDate() + 7);
    const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return { weeks: [weekOf(local)], monthTitle: "" };
  }, [which]);
  const days = weeks[0];
  const show = (day: string, opts: Intl.DateTimeFormatOptions) => new Date(`${day}T00:00:00`).toLocaleDateString("en-GB", opts);
  const rangeOf = (w: string[]) => `${show(w[0], { day: "numeric", month: "short" })} – ${show(w[6], { day: "numeric", month: "short", year: "numeric" })}`;
  const range = rangeOf(days);
  const headcount = Math.min(100, Math.max(1, Number(people) || BASE_PEOPLE));
  const mealsOf = (w: string[]) =>
    w.map((day) => {
      const s = slot(menuWeek(day), menuWeekday(day));
      return { day, dish: s?.dish ?? "", category: s?.fixed_category ?? "" };
    });
  const list = shoppingList(mealsOf(days), headcount);
  const dayNames = (r: ShoppingRow) => r.days.map((d) => show(d, { weekday: "short" })).join(", ");
  const print = (target: "menu" | "list") => {
    flushSync(() => setSheet(target));
    window.print();
  };
  const shareText = [
    `*Shopping list ${range}* (${headcount} people)`,
    ...SHOPPING_GROUPS.flatMap((g) => {
      const rows = list.filter((r) => r.group === g);
      return rows.length ? ["", `*${g}*`, ...rows.map((r) => `• ${r.item}: ${formatKg(r.kg)} (${dayNames(r)})`)] : [];
    }),
  ].join("\n");

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Select value={which} onValueChange={(v) => setWhich(v as typeof which)}>
          <SelectTrigger className="h-9 w-40" aria-label="Week or month"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="this">This week</SelectItem>
            <SelectItem value="next">Next week</SelectItem>
            <SelectItem value="month">This month</SelectItem>
            <SelectItem value="nextMonth">Next month</SelectItem>
          </SelectContent>
        </Select>
        {monthMode ? null : (
          <Button variant={listOpen ? "secondary" : "outline"} className="h-9" onClick={() => setListOpen((o) => !o)} aria-expanded={listOpen}>
            <ShoppingBasket /> Shopping list
          </Button>
        )}
        <Button variant="outline" className="h-9" onClick={() => print("menu")}>
          <Printer /> Print {monthMode ? `${monthTitle} (${weeks.length} weeks)` : range}
        </Button>
      </div>

      {listOpen && !monthMode ? (
        <section className="rounded-2xl border bg-card p-4 shadow-sm" aria-label="Shopping list">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-semibold">Sunday shopping · {range}</h2>
              <p className="text-sm text-muted-foreground">Meat, chicken, fish and sabzi for this menu. Quantities are a guide, rounded to ¼ kg.</p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              People
              <Input type="number" inputMode="numeric" min={1} max={100} value={people} onChange={(e) => setPeople(e.target.value)} className="h-9 w-20" />
            </label>
          </div>
          {list.length ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {SHOPPING_GROUPS.map((g) => {
                const rows = list.filter((r) => r.group === g);
                if (!rows.length) return null;
                return (
                  <div key={g}>
                    <h3 className="text-sm font-medium text-muted-foreground">{g}</h3>
                    <ul className="mt-1 divide-y rounded-xl border">
                      {rows.map((r) => (
                        <li key={r.item} className="flex items-baseline justify-between gap-3 px-3 py-2">
                          <span>
                            {r.item}
                            <span className="block text-xs text-muted-foreground">{dayNames(r)}</span>
                          </span>
                          <span className="font-semibold tabular-nums whitespace-nowrap">{formatKg(r.kg)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">No meat, fish or sabzi dishes on the menu this week.</p>
          )}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button variant="outline" className="h-9" asChild>
              <a href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer">
                <Share2 /> Share on WhatsApp
              </a>
            </Button>
            <Button variant={admin ? "outline" : "default"} className="h-9" onClick={() => print("list")} disabled={!list.length}>
              <Printer /> Print list
            </Button>
            {admin ? (
              <Button className="h-9" onClick={() => setAddOpen(true)} disabled={!list.length}>
                <Receipt /> Add to expenses
              </Button>
            ) : null}
          </div>
          {admin ? <ShoppingToExpenses key={`${range}-${headcount}-${addOpen}`} open={addOpen} onOpenChange={setAddOpen} list={list} /> : null}
        </section>
      ) : null}

      <div data-print-sheet={sheet === "list" ? "" : undefined} className={cn("hidden", sheet === "list" && "print:block")}>
        <h1 className="text-2xl font-bold">Sunday shopping list</h1>
        <p className="mt-1 text-base">{range} · {headcount} people</p>
        <table className="mt-5 w-full border-collapse text-lg">
          <thead>
            <tr className="text-left text-sm">
              <th className="border border-black px-3 py-2">Item</th>
              <th className="border border-black px-3 py-2">Quantity</th>
              <th className="border border-black px-3 py-2">For</th>
              <th className="border border-black px-3 py-2">Bought</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={`${r.group}-${r.item}`}>
                <td className="border border-black px-3 py-3">
                  <span className="font-semibold">{r.item}</span> <span className="text-sm">({r.group})</span>
                </td>
                <td className="border border-black px-3 py-3 whitespace-nowrap font-semibold">{formatKg(r.kg)}</td>
                <td className="border border-black px-3 py-3 text-sm">{dayNames(r)}</td>
                <td className="w-20 border border-black px-3 py-3"></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div data-print-sheet={sheet === "menu" ? "" : undefined} className={cn("hidden", sheet === "menu" && "print:block")}>
        <h1 className="text-2xl font-bold">{monthMode ? `Kitchen menu · ${monthTitle}` : "Weekly kitchen menu"}</h1>
        <p className="mt-1 text-base">{monthMode ? `${weeks.length} weeks of 7 days, Monday to Sunday · buy on the Sunday before each week (${headcount} people)` : range}</p>
        {weeks.map((w, i) => {
          const buy = monthMode ? shoppingList(mealsOf(w), headcount) : [];
          return (
            <section key={w[0]} className={cn("break-inside-avoid", monthMode ? "mt-4" : "mt-5")}>
              {monthMode ? (
                <h2 className="text-base font-bold">
                  Week {i + 1} · {rangeOf(w)}
                </h2>
              ) : null}
              <table className={cn("w-full border-collapse", monthMode ? "mt-1 text-sm" : "text-lg")}>
                <thead>
                  <tr className="text-left text-sm">
                    <th className={cn("border border-black px-3", monthMode ? "w-28 py-1" : "py-2")}>Day</th>
                    <th className={cn("border border-black px-3", monthMode ? "w-20 py-1" : "py-2")}>Date</th>
                    <th className={cn("border border-black px-3", monthMode ? "py-1" : "py-2")}>Dish</th>
                  </tr>
                </thead>
                <tbody>
                  {w.map((day) => {
                    const s = slot(menuWeek(day), menuWeekday(day));
                    const cell = cn("border border-black px-3", monthMode ? "py-1" : "py-3");
                    return (
                      <tr key={day}>
                        <td className={cn(cell, "font-semibold")}>{show(day, { weekday: "long" })}</td>
                        <td className={cn(cell, "whitespace-nowrap")}>{show(day, { day: "numeric", month: "short" })}</td>
                        <td className={cell}>
                          {s?.dish || "—"}
                          {s?.fixed_category ? <span className="ml-2 text-xs">({s.fixed_category})</span> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {buy.length ? (
                <p className="mt-1 text-xs">
                  <span className="font-semibold">Buy: </span>
                  {buy.map((r) => `${r.item} ${formatKg(r.kg)}`).join(" · ")}
                </p>
              ) : null}
            </section>
          );
        })}
      </div>
    </>
  );
}

function EditableText({ value, label, onSave, muted }: { value: string; label: string; onSave: (v: string) => void; muted?: boolean }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setDraft(value); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Edit ${label}`}
          className={cn("-mx-1.5 w-[calc(100%+0.75rem)] rounded-md px-1.5 py-1 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring", muted && "text-muted-foreground")}
        >
          {value || <span className="text-muted-foreground/60">Add…</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64" align="start">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim() !== value) onSave(draft.trim());
            setOpen(false);
          }}
          className="space-y-2"
        >
          <label className="text-xs font-medium text-muted-foreground" htmlFor={`edit-${label}`}>{label}</label>
          <Input id={`edit-${label}`} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus maxLength={80} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" size="sm">Save</Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function DutyBoard({ admin, month, days, duties, members }: { admin: boolean; month: { year: number; month: number; key: string }; days: string[]; duties: Duty[]; members: Member[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [filling, setFilling] = useState(false);
  const [pending, start] = useTransition();
  const label = (id: string | null) => members.find((m) => m.id === id)?.label ?? "";
  const cooks = members.filter((m) => m.active);
  const byDay = new Map(duties.map((d) => [d.day, d]));

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const d of duties) for (const id of [d.breakfast_member_id, d.lunch_member_id, d.dinner_member_id]) if (id) c.set(id, (c.get(id) ?? 0) + 1);
    return [...c].map(([id, n]) => ({ id, label: label(id), n })).sort((a, b) => a.label.localeCompare(b.label));
  }, [duties]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (delta: number) => {
    const d = new Date(Date.UTC(month.year, month.month - 1 + delta, 1));
    const n = new URLSearchParams(params);
    n.set("tab", "duties");
    n.set("month", `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
    router.replace(`${pathname}?${n}`, { scroll: false });
  };

  const update = (day: string, patch: Partial<Duty>) => {
    const cur = byDay.get(day) ?? { day, breakfast_member_id: null, lunch_member_id: null, dinner_member_id: null, off_member_id: null, off_note: null };
    const next = { ...cur, ...patch };
    start(async () => {
      const r = await saveDutyDay({ day, breakfast: next.breakfast_member_id, lunch: next.lunch_member_id, dinner: next.dinner_member_id, off: next.off_member_id, offNote: next.off_note ?? "" });
      if (!r.ok) toast.error(r.error);
      router.refresh();
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => go(-1)} aria-label="Previous month"><ChevronLeft /></Button>
          <h2 className="min-w-44 text-center font-heading text-xl font-bold">{MONTHS_LONG[month.month - 1]} {month.year}</h2>
          <Button variant="ghost" size="icon" onClick={() => go(1)} aria-label="Next month"><ChevronRight /></Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {counts.map((c) => (
            <span key={c.id} className="num rounded-full border bg-card px-3 py-1 text-sm"><span className="font-semibold">{c.label}</span> {c.n} meals</span>
          ))}
          {admin ? <Button onClick={() => setFilling(true)}><Sparkles /> Fill month</Button> : null}
        </div>
      </div>

      {duties.length === 0 && !admin ? (
        <p className="rounded-2xl border border-dashed py-12 text-center text-sm text-muted-foreground">No duties planned for this month yet.</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-2 py-2.5 font-medium">Breakfast</th>
                  <th className="px-2 py-2.5 font-medium">Lunch</th>
                  <th className="px-2 py-2.5 font-medium">Dinner</th>
                  <th className="px-2 py-2.5 font-medium">Off duty</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {days.map((day) => {
                  const d = byDay.get(day);
                  const date = new Date(`${day}T00:00:00`);
                  const weekend = date.getDay() === 0 || date.getDay() === 6;
                  return (
                    <tr key={day} className={cn(weekend && "bg-muted/25")}>
                      <th scope="row" className="px-4 py-1.5 text-left font-normal whitespace-nowrap">
                        <span className="num font-semibold">{date.getDate()}</span>{" "}
                        <span className="text-muted-foreground">{date.toLocaleDateString("en-GB", { weekday: "short" })}</span>
                      </th>
                      {(["breakfast_member_id", "lunch_member_id", "dinner_member_id", "off_member_id"] as const).map((k) => (
                        <td key={k} className="px-2 py-1.5">
                          {admin ? (
                            <Select value={d?.[k] ?? NONE} onValueChange={(v) => update(day, { [k]: v === NONE ? null : v })} disabled={pending}>
                              <SelectTrigger size="sm" className="h-8 w-full min-w-24" aria-label={`${k.split("_")[0]} on ${day}`}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NONE}>—</SelectItem>
                                {cooks.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          ) : (
                            <span>{label(d?.[k] ?? null) || <span className="text-muted-foreground">—</span>}</span>
                          )}
                          {k === "off_member_id" && d?.off_note ? <span className="ml-1 text-xs text-muted-foreground">({d.off_note})</span> : null}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ResponsiveDialog open={filling} onOpenChange={setFilling} title={`Fill ${MONTHS_LONG[month.month - 1]}`} description="Two people cook each day, pairs rotate and the single meal moves between breakfast, lunch and dinner.">
        {filling ? <FillForm month={month} members={cooks} hasExisting={duties.length > 0} onDone={() => { setFilling(false); router.refresh(); }} /> : null}
      </ResponsiveDialog>
    </div>
  );
}

function FillForm({ month, members, hasExisting, onDone }: { month: { year: number; month: number }; members: Member[]; hasExisting: boolean; onDone: () => void }) {
  const [people, setPeople] = useState<string[]>(members.filter((m) => m.hasLabel).map((m) => m.id));
  const [away, setAway] = useState<string>(NONE);
  const [until, setUntil] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-5 pb-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await fillRoster({ year: month.year, month: month.month, people, awayMember: away === NONE ? null : away, awayUntil: away === NONE || !until ? null : until, overwrite });
          if (r.ok) {
            toast.success(r.message);
            onDone();
          } else toast.error(r.error);
        });
      }}
    >
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Who cooks, in rotation order</legend>
        <div className="flex flex-wrap gap-2">
          {members.map((m) => (
            <label key={m.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
              <Checkbox checked={people.includes(m.id)} onCheckedChange={(c) => setPeople((p) => (c ? [...p, m.id] : p.filter((x) => x !== m.id)))} />
              {m.label} <span className="text-muted-foreground">{m.hasLabel ? m.name : ""}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Someone away? (optional)" htmlFor="away">
          <Select value={away} onValueChange={setAway}>
            <SelectTrigger id="away" className="h-10 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Nobody</SelectItem>
              {members.filter((m) => people.includes(m.id)).map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Away until" htmlFor="until">
          <Input id="until" type="date" className="h-10" value={until} onChange={(e) => setUntil(e.target.value)} disabled={away === NONE} />
        </Field>
      </div>
      {hasExisting ? (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={overwrite} onCheckedChange={(c) => setOverwrite(Boolean(c))} /> Replace the duties already planned for this month
        </label>
      ) : null}
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="h-11 flex-1" onClick={onDone}>Cancel</Button>
        <Button type="submit" className="h-11 flex-[2]" disabled={pending || people.length === 0 || (hasExisting && !overwrite)}>
          {pending ? <Loader2 className="animate-spin" /> : <Sparkles />} Fill month
        </Button>
      </div>
    </form>
  );
}
