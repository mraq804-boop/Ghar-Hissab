"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/ledger/money";
import { ResponsiveDialog } from "@/components/ledger/responsive-dialog";
import { addAbbuEntry, deleteAbbuEntry } from "@/app/(app)/dashboard/abbu-actions";
import { cn } from "@/lib/utils";

type Entry = { id: string; kind: "paid" | "returned"; amountPaisa: bigint; onDate: string; note: string | null; fromExpense: boolean };

export function AbbuMoney({
  admin,
  paidPaisa,
  returnedPaisa,
  owedPaisa,
  entries,
}: {
  admin: boolean;
  paidPaisa: bigint;
  returnedPaisa: bigint;
  owedPaisa: bigint;
  entries: Entry[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState<"paid" | "returned" | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [pending, start] = useTransition();
  const shown = showAll ? entries : entries.slice(0, 6);

  const remove = (id: string) =>
    start(async () => {
      const r = await deleteAbbuEntry({ id });
      if (r.ok) {
        toast.success(r.message);
        router.refresh();
      } else toast.error(r.error);
    });

  return (
    <div>
      <div className="grid grid-cols-3 divide-x border-b">
        <Figure label="Abbu paid" paisa={paidPaisa} />
        <Figure label="Returned" paisa={returnedPaisa} />
        <Figure label="Still to return" paisa={owedPaisa > 0n ? owedPaisa : 0n} tone={owedPaisa > 0n ? "warning" : "success"} />
      </div>

      {admin ? (
        <div className="flex flex-wrap gap-2 px-5 py-3">
          <Button size="sm" onClick={() => setOpen("returned")} disabled={owedPaisa <= 0n}>Return to Abbu</Button>
          <Button size="sm" variant="outline" onClick={() => setOpen("paid")}>Abbu paid</Button>
        </div>
      ) : null}

      {entries.length ? (
        <ol className="divide-y border-t">
          {shown.map((e) => (
            <li key={e.id} className="flex items-center gap-3 px-5 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{e.kind === "paid" ? e.note || "Abbu paid" : `Returned${e.note ? `: ${e.note}` : ""}`}</p>
                <p className="text-xs text-muted-foreground">
                  {format(new Date(`${e.onDate}T00:00:00`), "d MMM yyyy")}
                  {e.fromExpense ? " · from Expenses" : ""}
                </p>
              </div>
              <span className={cn("num text-sm font-semibold", e.kind === "returned" ? "text-success" : "")}>
                {e.kind === "returned" ? "−" : "+"}
                <Money paisa={e.amountPaisa} />
              </span>
              {admin && !e.fromExpense ? (
                <Button size="icon" variant="ghost" className="size-8" aria-label="Remove entry" disabled={pending} onClick={() => remove(e.id)}>
                  <Trash2 className="size-4" />
                </Button>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-5 py-6 text-center text-sm text-muted-foreground">
          Nothing yet. When Abbu pays for something, add it in Expenses with Paid by set to Abbu.
        </p>
      )}
      {entries.length > shown.length ? (
        <div className="border-t px-5 py-2 text-center">
          <Button size="sm" variant="ghost" onClick={() => setShowAll(true)}>Show all {entries.length}</Button>
        </div>
      ) : null}

      {open ? <EntryDialog kind={open} owedPaisa={owedPaisa} onClose={() => setOpen(null)} onSaved={() => router.refresh()} /> : null}
    </div>
  );
}

function Figure({ label, paisa, tone }: { label: string; paisa: bigint; tone?: "warning" | "success" }) {
  return (
    <div className="px-3 py-4 text-center sm:px-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("num mt-1 font-heading text-lg font-bold sm:text-xl", tone === "warning" && "text-warning", tone === "success" && "text-success")}>
        <Money paisa={paisa} />
      </p>
    </div>
  );
}

function EntryDialog({ kind, owedPaisa, onClose, onSaved }: { kind: "paid" | "returned"; owedPaisa: bigint; onClose: () => void; onSaved: () => void }) {
  const today = format(new Date(), "yyyy-MM-dd");
  const [amount, setAmount] = useState(kind === "returned" && owedPaisa > 0n ? (Number(owedPaisa) / 100).toString() : "");
  const [onDate, setOnDate] = useState(today);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      const r = await addAbbuEntry({ kind, amount: amount.replace(/,/g, ""), onDate, note });
      if (r.ok) {
        toast.success(r.message);
        onSaved();
        onClose();
      } else toast.error(r.error);
    });

  return (
    <ResponsiveDialog
      open
      onOpenChange={(o) => !o && !pending && onClose()}
      title={kind === "returned" ? "Return money to Abbu" : "Abbu paid"}
      description={
        kind === "returned"
          ? "Money given back to Abbu from the purse."
          : "For a home item, add it in Expenses with Paid by set to Abbu instead, so it is shared and shows here by itself. Use this only for money that isn't an expense."
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="abbu-amount">Amount (Rs)</Label>
            <Input id="abbu-amount" inputMode="decimal" className="h-10" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="abbu-date">Date</Label>
            <Input id="abbu-date" type="date" className="h-10" value={onDate} max={today} onChange={(e) => setOnDate(e.target.value)} required />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="abbu-note">Note (optional)</Label>
          <Input id="abbu-note" className="h-10" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === "returned" ? "Cash, bank transfer…" : "What it was for"} />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" disabled={pending || !amount}>{pending ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
}
