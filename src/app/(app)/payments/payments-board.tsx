"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Loader2, Plus, Search, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Money } from "@/components/ledger/money";
import { EmptyState, PageHeader } from "@/components/ledger/page-header";
import { ResponsiveDialog } from "@/components/ledger/responsive-dialog";
import { StatusBadge } from "@/components/ledger/status-badge";
import { UrlSelect } from "@/components/ledger/url-select";
import { methodLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { reviewPayment } from "./actions";
import { PaymentForm } from "./payment-form";
import { ProofViewer } from "./proof-viewer";
import { ScreenshotCheck } from "./screenshot-check";
import { READABLE_TYPES } from "@/lib/ocr/read-screenshot";

export type PaymentView = {
  id: string;
  version: number;
  unitId: string;
  unitCode: string;
  amountPaisa: bigint;
  paidOn: string;
  method: string;
  reference: string | null;
  notes: string | null;
  status: "pending" | "approved" | "rejected";
  source: "app" | "import";
  createdAt: string;
  hasProof: boolean;
  proofMime: string | null;
  warnings: string[];
  reviewReason: string | null;
  reviewedAt: string | null;
  periodLabel: string;
  relatedExpense: boolean;
  mine: boolean;
};

type Props = {
  admin: boolean;
  householdId: string;
  userId: string;
  myUnitId: string | null;
  units: { id: string; code: string }[];
  formUnits: { id: string; code: string }[];
  periods: { id: string; label: string }[];
  currentPeriodId: string;
  periodTitle: string;
  rows: PaymentView[];
  counts: { all: number; pending: number; approved: number; rejected: number };
  page: number;
  pages: number;
  total: number;
  maxUploadMb: number;
  openNew: boolean;
};

const TABS = [
  { key: "", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
] as const;

export function PaymentsBoard(p: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(p.rows[0]?.id ?? null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [creating, setCreating] = useState(p.openNew);
  const [seenOpenNew, setSeenOpenNew] = useState(p.openNew);
  const [query, setQuery] = useState(params.get("q") ?? "");
  const selected = p.rows.find((r) => r.id === selectedId) ?? p.rows[0] ?? null;
  const status = params.get("status") ?? "";

  if (p.openNew !== seenOpenNew) {
    setSeenOpenNew(p.openNew);
    if (p.openNew) setCreating(true);
  }

  const setParam = useCallback(
    (k: string, v: string | null) => {
      const next = new URLSearchParams(params);
      if (v) next.set(k, v);
      else next.delete(k);
      if (k !== "page") next.delete("page");
      next.delete("new");
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get("q") ?? "") !== query) setParam("q", query || null);
    }, 300);
    return () => clearTimeout(t);
  }, [query, params, setParam]);

  const [rejecting, setRejecting] = useState(false);

  useEffect(() => {
    if (!p.admin) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [role=dialog], [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = p.rows.findIndex((r) => r.id === selected?.id);
      if (e.key === "j" && idx < p.rows.length - 1) setSelectedId(p.rows[idx + 1].id);
      if (e.key === "k" && idx > 0) setSelectedId(p.rows[idx - 1].id);
      if (selected?.status === "pending" && e.key === "a") document.getElementById("approve-btn")?.click();
      if (selected?.status === "pending" && e.key === "r") setRejecting(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p.admin, p.rows, selected]);

  return (
    <>
      <PageHeader
        title={<>Payments <span className="text-muted-foreground">· {p.periodTitle}</span></>}
        description={p.admin ? "Check each payment against its screenshot. Only approved payments count toward balances." : "Payments you have sent to the purse-holder, and whether they have been verified."}
        actions={
          <>
            <Button asChild variant="outline"><Link href={`${pathname}?m=all`}>All months</Link></Button>
            <Button onClick={() => setCreating(true)} className="hidden sm:inline-flex"><Plus /> Record payment</Button>
          </>
        }
      />

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div role="tablist" aria-label="Status" className="flex gap-1 overflow-x-auto rounded-full border bg-card p-1">
          {TABS.map((t) => {
            const n = t.key ? p.counts[t.key] : p.counts.all;
            const active = status === t.key;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={active}
                onClick={() => setParam("status", t.key || null)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
                <span className={cn("num rounded-full px-1.5 text-xs", active ? "bg-primary-foreground/15" : "bg-muted", t.key === "pending" && n > 0 && !active && "bg-warning-soft text-warning")}>{n}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Transaction ID or note" className="h-9 rounded-full bg-card pl-9" aria-label="Search payments" />
          </div>
          {p.units.length > 1 ? <UrlSelect param="unit" label="Household" allLabel="All households" options={p.units.map((u) => ({ value: u.code, label: `${u.code} household` }))} /> : null}
        </div>
      </div>

      {p.rows.length === 0 ? (
        <EmptyState icon={Wallet} title={status === "pending" ? "Nothing waiting for verification" : "No payments here yet"} action={<Button onClick={() => setCreating(true)}><Plus /> Record a payment</Button>}>
          {status === "pending" ? "New payments appear here as soon as they are submitted." : "Record a payment with its screenshot and it will appear here."}
        </EmptyState>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <div className="overflow-hidden rounded-2xl border bg-card">
            <ul className="divide-y" aria-label="Payments">
              {p.rows.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(r.id);
                      setMobileDetail(true);
                    }}
                    aria-current={r.id === selected?.id ? "true" : undefined}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-3 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted",
                      r.id === selected?.id && "lg:bg-accent/60 lg:shadow-[inset_3px_0_0_var(--haldi)]",
                    )}
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted font-heading text-xs font-bold">{r.unitCode}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                        {r.reference ? r.reference : methodLabel(r.method)}
                        {r.warnings.length ? <AlertTriangle className="size-3.5 text-warning" aria-label="Possible duplicate" /> : null}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">{format(new Date(r.paidOn), "d MMM yyyy")}, {methodLabel(r.method)}</span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <Money paisa={r.amountPaisa} className="text-sm font-semibold" />
                      <StatusBadge status={r.status} compact />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {p.pages > 1 ? (
              <nav className="flex items-center justify-between border-t px-4 py-2 text-sm" aria-label="Pages">
                <Button variant="ghost" size="sm" disabled={p.page <= 1} onClick={() => setParam("page", String(p.page - 1))}><ChevronLeft /> Newer</Button>
                <span className="text-muted-foreground">Page {p.page} of {p.pages}</span>
                <Button variant="ghost" size="sm" disabled={p.page >= p.pages} onClick={() => setParam("page", String(p.page + 1))}>Older <ChevronRight /></Button>
              </nav>
            ) : null}
          </div>

          <div className="hidden lg:block">
            {selected ? (
              <div className="sticky top-24 rounded-2xl border bg-card p-5">
                <PaymentDetail payment={selected} admin={p.admin} rejecting={rejecting} setRejecting={setRejecting} onReviewed={() => router.refresh()} />
              </div>
            ) : null}
          </div>
        </div>
      )}

      <div className="lg:hidden">
        <ResponsiveDialog open={mobileDetail && !!selected} onOpenChange={setMobileDetail} title={selected ? `${selected.unitCode} payment` : "Payment"}>
          {selected ? (
            <PaymentDetail
              payment={selected}
              admin={p.admin}
              rejecting={rejecting}
              setRejecting={setRejecting}
              onReviewed={() => {
                setMobileDetail(false);
                router.refresh();
              }}
            />
          ) : null}
        </ResponsiveDialog>
      </div>

      <Button
        onClick={() => setCreating(true)}
        size="icon"
        className="fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 size-14 rounded-full bg-haldi text-[#1b2340] shadow-lg hover:bg-haldi/90 sm:hidden"
        aria-label="Record payment"
      >
        <Plus className="size-6" />
      </Button>

      <ResponsiveDialog open={creating} onOpenChange={setCreating} title="Record a payment" description="Money handed to the purse-holder">
        {creating ? (
          <PaymentForm
            householdId={p.householdId}
            userId={p.userId}
            units={p.formUnits}
            fixedUnitId={p.admin ? null : p.myUnitId}
            periods={p.periods}
            defaultPeriodId={p.currentPeriodId}
            maxUploadMb={p.maxUploadMb}
            onDone={() => {
              setCreating(false);
              setParam("new", null);
              router.refresh();
            }}
          />
        ) : null}
      </ResponsiveDialog>
    </>
  );
}

function PaymentDetail({
  payment: r,
  admin,
  rejecting,
  setRejecting,
  onReviewed,
}: {
  payment: PaymentView;
  admin: boolean;
  rejecting: boolean;
  setRejecting: (v: boolean) => void;
  onReviewed: () => void;
}) {
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const canReview = admin && r.status === "pending";

  const decide = (decision: "approved" | "rejected") =>
    start(async () => {
      const res = await reviewPayment({ paymentId: r.id, decision, version: r.version, reason });
      if (res.ok) {
        toast.success(res.message);
        setRejecting(false);
        setReason("");
        onReviewed();
      } else toast.error(res.error);
    });

  const facts = useMemo(
    () => [
      ["Household", `${r.unitCode}`],
      ["For", r.periodLabel],
      ["Paid on", format(new Date(r.paidOn), "d MMMM yyyy")],
      ["Method", methodLabel(r.method)],
      ["Transaction ID", r.reference ?? "None"],
      ["Submitted", format(new Date(r.createdAt), "d MMM, h:mm a")],
    ],
    [r],
  );

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{r.unitCode} household paid</p>
          <Money paisa={r.amountPaisa} decimals={r.amountPaisa % 100n !== 0n} className="font-heading text-3xl font-bold" />
        </div>
        <StatusBadge status={r.status} />
      </div>

      {r.warnings.map((w) => (
        <p key={w} className="flex gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {w}
        </p>
      ))}
      {r.source === "import" ? <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">Imported from the workbook&apos;s Paid column. There is no screenshot for it.</p> : null}
      {r.relatedExpense ? <p className="rounded-lg bg-info-soft px-3 py-2 text-sm text-info">Recorded automatically for an expense this household paid directly.</p> : null}

      <ProofViewer key={r.id} paymentId={r.id} hasProof={r.hasProof} />
      {admin && r.hasProof && r.proofMime && READABLE_TYPES.includes(r.proofMime) ? (
        <ScreenshotCheck key={`check-${r.id}`} paymentId={r.id} auto={r.status === "pending"} amountPaisa={r.amountPaisa} paidOn={r.paidOn} reference={r.reference} />
      ) : null}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="truncate">{v}</dd>
          </div>
        ))}
      </dl>
      {r.notes ? <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm">{r.notes}</p> : null}
      {r.status === "rejected" && r.reviewReason ? (
        <p className="rounded-lg border border-destructive/30 bg-danger-soft px-3 py-2 text-sm text-destructive">Rejected: {r.reviewReason}</p>
      ) : null}

      {canReview ? (
        rejecting ? (
          <div className="space-y-2 rounded-xl border p-3">
            <label htmlFor="reason" className="text-sm font-medium">Why is it being rejected?</label>
            <Textarea id="reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Amount on the screenshot is Rs 5,000, not Rs 50,000" autoFocus />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setRejecting(false)} disabled={pending}>Cancel</Button>
              <Button variant="destructive" className="flex-1" onClick={() => decide("rejected")} disabled={pending || reason.trim().length === 0}>
                {pending ? <Loader2 className="animate-spin" /> : <X />} Reject payment
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" className="h-11 flex-1" onClick={() => setRejecting(true)} disabled={pending}>
              <X /> Reject <kbd className="ml-1 hidden rounded border px-1 text-[10px] lg:inline">R</kbd>
            </Button>
            <Button id="approve-btn" className="h-11 flex-[2] bg-success text-white hover:bg-success/90" onClick={() => decide("approved")} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <Check />} Approve <kbd className="ml-1 hidden rounded border border-white/40 px-1 text-[10px] lg:inline">A</kbd>
            </Button>
          </div>
        )
      ) : null}
    </div>
  );
}
