"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, CheckCircle2, Droplets, ExternalLink, FileText, Flame, Loader2, Plus, RefreshCw, Trash2, TriangleAlert, Upload, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmButton } from "@/components/ledger/confirm-button";
import { Field } from "@/components/ledger/field";
import { EmptyState, Panel } from "@/components/ledger/page-header";
import { ResponsiveDialog } from "@/components/ledger/responsive-dialog";
import { readImageText } from "@/lib/ocr/read-screenshot";
import { PROVIDER_LIST, PROVIDERS, type Provider } from "@/lib/utilities/providers";
import { readBillText } from "@/lib/utilities/read-bill-text";
import { cn } from "@/lib/utils";
import { addBillToExpenses, addMeter, checkNow, deleteMeter, updateMeter, uploadBill } from "./actions";

export type MeterView = {
  id: string;
  provider: Provider;
  label: string;
  refEnding: string;
  referenceNo: string | null;
  categoryId: string | null;
  categoryName: string | null;
  active: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
};

export type BillView = {
  id: string;
  meterId: string;
  billMonth: string;
  issueDate: string | null;
  dueDate: string | null;
  units: number | null;
  payable: number;
  latePayments: { until: string | null; amount: number }[];
  expenseAmount: number | null;
  linked: boolean;
  uploaded: boolean;
};

const ICONS = { lesco: Zap, wasa: Droplets, sngpl: Flame } as const;
const rs = (n: number) => `Rs ${n.toLocaleString("en-US")}`;
const day = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "-");
const monthLabel = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

type Result = { ok: true; message?: string } | { ok: false; error: string };
type Run = (key: string, fn: () => Promise<Result>) => void;

export function BillsBoard({ admin, meters, bills, today, categories }: { admin: boolean; meters: MeterView[]; bills: BillView[]; today: string; categories: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [uploading, setUploading] = useState<MeterView | null>(null);

  const run: Run = (key, fn) => {
    setBusy(key);
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Done");
      else toast.error(r.error);
      setBusy(null);
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      {meters.length === 0 ? (
        <EmptyState icon={Zap} title="No bills set up yet">
          {admin ? "Add a LESCO, WASA or SNGPL number below." : "The family administrator hasn't added any connections yet."}
        </EmptyState>
      ) : null}

      {meters.map((m) => {
        const p = PROVIDERS[m.provider];
        const Icon = ICONS[m.provider];
        const mine = bills.filter((b) => b.meterId === m.id);
        const latest = mine[0];
        const overdue = latest?.dueDate && latest.dueDate < today;
        return (
          <Panel
            key={m.id}
            title={<span className="flex items-center gap-2"><Icon className="size-4 text-haldi" />{m.label}{!m.active ? <span className="text-xs font-normal text-muted-foreground">(paused)</span> : null}</span>}
            description={`${p.name} ${p.utility.toLowerCase()}, ${p.numberLabel.toLowerCase()} ending ${m.refEnding}${m.categoryName ? ` · goes to ${m.categoryName}` : " · no expense chosen yet"}`}
            actions={
              admin ? (
                p.fetches ? (
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => run(`check-${m.id}`, () => checkNow(m.id))}>
                    {busy === `check-${m.id}` ? <Loader2 className="animate-spin" /> : <RefreshCw />} Check now
                  </Button>
                ) : (
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button asChild size="sm" variant="outline">
                      <a href={p.siteUrl} target="_blank" rel="noopener noreferrer"><ExternalLink /> Get bill</a>
                    </Button>
                    <Button size="sm" onClick={() => setUploading(m)}><Upload /> Upload bill</Button>
                  </div>
                )
              ) : null
            }
          >
            <div className="space-y-4">
              {!p.fetches && admin && !latest ? (
                <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                  {p.name} asks for a CAPTCHA, so this bill isn&apos;t fetched automatically. Tap <strong>Get bill</strong>, enter consumer number{" "}
                  {m.referenceNo ? <span className="num font-medium text-foreground">{m.referenceNo}</span> : null} and the CAPTCHA, then take a screenshot and use{" "}
                  <strong>Upload bill</strong>.
                </p>
              ) : null}

              {m.lastError ? (
                <p className="flex gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                  <span>
                    {m.lastError}{" "}
                    <a href={p.siteUrl} target="_blank" rel="noopener noreferrer" className="underline">Open {p.name}</a>
                  </span>
                </p>
              ) : null}

              {latest ? (
                <div className="grid gap-4 rounded-xl border p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {monthLabel(latest.billMonth)} bill{latest.units !== null ? ` · ${latest.units} units` : ""}{latest.uploaded ? " · uploaded" : ""}
                    </p>
                    <p className="num mt-1 font-heading text-3xl font-bold">{rs(latest.payable)}</p>
                    <p className={cn("mt-1 flex items-center gap-1.5 text-sm", overdue ? "text-destructive" : "text-muted-foreground")}>
                      <CalendarClock className="size-4 shrink-0" /> {latest.dueDate ? `Due ${day(latest.dueDate)}` : "Due date not known"}
                      {latest.latePayments.length ? ` · after that ${latest.latePayments.map((l) => (l.until ? `${rs(l.amount)} until ${day(l.until)}` : rs(l.amount))).join(", then ")}` : ""}
                    </p>
                    <p className="mt-2 text-sm">
                      {latest.linked ? (
                        <span className="inline-flex items-center gap-1.5 text-success">
                          <CheckCircle2 className="size-4" /> In expenses{latest.expenseAmount !== null && latest.expenseAmount !== latest.payable ? ` (shows ${rs(latest.expenseAmount)})` : ""}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Not added to expenses yet</span>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 sm:flex-col">
                    <Button asChild variant="outline"><Link href={`/bills/view?id=${latest.id}`}><FileText /> View bill</Link></Button>
                    {admin && (!latest.linked || latest.expenseAmount !== latest.payable) ? (
                      <Button disabled={pending} onClick={() => run(`add-${latest.id}`, () => addBillToExpenses(latest.id))}>
                        {busy === `add-${latest.id}` ? <Loader2 className="animate-spin" /> : <Plus />} {latest.linked ? "Update expense" : "Add to expenses"}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : p.fetches ? (
                <p className="text-sm text-muted-foreground">No bill fetched yet.{m.lastCheckedAt ? ` Last checked ${new Date(m.lastCheckedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}.` : ""}</p>
              ) : null}

              {mine.length > 1 ? (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Earlier bills ({mine.length - 1})</summary>
                  <ul className="mt-2 divide-y rounded-lg border">
                    {mine.slice(1).map((b) => (
                      <li key={b.id} className="flex items-center justify-between gap-3 px-3 py-2">
                        <span>{monthLabel(b.billMonth)}{b.units !== null ? <span className="text-muted-foreground"> · {b.units} units</span> : null}</span>
                        <span className="flex items-center gap-3">
                          <span className="num">{rs(b.payable)}</span>
                          <Link href={`/bills/view?id=${b.id}`} className="text-primary underline-offset-2 hover:underline">View</Link>
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {admin ? <MeterSettings meter={m} categories={categories} disabled={pending} run={run} /> : null}
            </div>
          </Panel>
        );
      })}

      {admin ? <AddMeter categories={categories} disabled={pending} run={run} busy={busy === "add-meter"} /> : null}

      <p className="text-xs text-muted-foreground">
        LESCO and WASA bills are read from their public bill pages once a day per connection. If a site asks for a CAPTCHA or changes, the app stops and
        links to the site instead. SNGPL bills are uploaded by you.
      </p>

      {uploading ? (
        <UploadBill
          meter={uploading}
          today={today}
          onClose={() => setUploading(null)}
          onSaved={() => {
            setUploading(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function MeterSettings({ meter, categories, disabled, run }: { meter: MeterView; categories: { id: string; name: string }[]; disabled: boolean; run: Run }) {
  const p = PROVIDERS[meter.provider];
  const [label, setLabel] = useState(meter.label);
  const [categoryId, setCategoryId] = useState(meter.categoryId ?? "");
  const changed = label !== meter.label || categoryId !== (meter.categoryId ?? "");
  return (
    <details className="rounded-lg border px-3 py-2 text-sm">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Settings</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor={`label-${meter.id}`}>
          <Input id={`label-${meter.id}`} value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} className="h-10" />
        </Field>
        <Field label="Adds to expense" htmlFor={`cat-${meter.id}`}>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger id={`cat-${meter.id}`} className="h-10 w-full"><SelectValue placeholder="Choose a category" /></SelectTrigger>
            <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      </div>
      {meter.referenceNo ? <p className="mt-2 text-xs text-muted-foreground">{p.numberLabel}: <span className="num">{meter.referenceNo}</span></p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" disabled={disabled || !changed} onClick={() => run(`save-${meter.id}`, () => updateMeter({ id: meter.id, label, categoryId: categoryId || null, active: meter.active }))}>Save</Button>
        {p.fetches ? (
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => run(`pause-${meter.id}`, () => updateMeter({ id: meter.id, label: meter.label, categoryId: meter.categoryId, active: !meter.active }))}>
            {meter.active ? "Pause daily check" : "Resume daily check"}
          </Button>
        ) : null}
        <ConfirmButton
          size="sm"
          variant="ghost"
          className="text-destructive"
          disabled={disabled}
          title={`Remove ${meter.label}?`}
          description="This connection and its saved bill copies are removed. Expenses already added stay as they are."
          confirmLabel="Remove"
          destructive
          onConfirm={() => run(`del-${meter.id}`, () => deleteMeter(meter.id))}
        >
          <Trash2 /> Remove
        </ConfirmButton>
      </div>
    </details>
  );
}

function AddMeter({ categories, disabled, run, busy }: { categories: { id: string; name: string }[]; disabled: boolean; run: Run; busy: boolean }) {
  const [provider, setProvider] = useState<Provider>("lesco");
  const [label, setLabel] = useState("");
  const [ref, setRef] = useState("");
  const p = PROVIDERS[provider];
  const [categoryId, setCategoryId] = useState(categories.find((c) => p.categoryHint.test(c.name))?.id ?? "");
  const digits = ref.replace(/\D/g, "");
  return (
    <Panel title="Add a bill" description="Electricity (LESCO), water (WASA Lahore) or gas (SNGPL).">
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          run("add-meter", async () => {
            const r = await addMeter({ provider, label, referenceNo: ref, categoryId: categoryId || null });
            if (r.ok) {
              setLabel("");
              setRef("");
            }
            return r;
          });
        }}
      >
        <Field label="Company" htmlFor="meter-provider">
          <Select
            value={provider}
            onValueChange={(v) => {
              const next = v as Provider;
              setProvider(next);
              setCategoryId(categories.find((c) => PROVIDERS[next].categoryHint.test(c.name))?.id ?? "");
            }}
          >
            <SelectTrigger id="meter-provider" className="h-10 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{PROVIDER_LIST.map((x) => <SelectItem key={x.id} value={x.id}>{x.name} ({x.utility.toLowerCase()})</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Name" htmlFor="meter-label" hint="e.g. Ground floor">
          <Input id="meter-label" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} className="h-10" required />
        </Field>
        <Field label={p.numberLabel} htmlFor="meter-ref" hint={p.numberHint}>
          <Input id="meter-ref" inputMode="numeric" autoComplete="off" value={ref} onChange={(e) => setRef(e.target.value)} placeholder={p.placeholder} className="num h-10" required />
        </Field>
        <Field label="Adds to expense" htmlFor="meter-cat">
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger id="meter-cat" className="h-10 w-full"><SelectValue placeholder="Choose a category" /></SelectTrigger>
            <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={disabled || !p.pattern.test(digits) || !label.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : <Plus />} {p.fetches ? "Add and fetch bill" : "Add"}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

async function shrink(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.size < 900_000) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.85));
}

function UploadBill({ meter, today, onClose, onSaved }: { meter: MeterView; today: string; onClose: () => void; onSaved: () => void }) {
  const p = PROVIDERS[meter.provider];
  const [file, setFile] = useState<Blob | null>(null);
  const [name, setName] = useState("");
  const [reading, setReading] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [billMonth, setBillMonth] = useState(today.slice(0, 7));
  const [dueDate, setDueDate] = useState("");
  const [payable, setPayable] = useState("");
  const [afterDue, setAfterDue] = useState("");
  const [saving, start] = useTransition();

  const choose = async (f: File | undefined) => {
    if (!f) return;
    setName(f.name);
    const small = await shrink(f);
    setFile(small);
    if (!small.type.startsWith("image/")) {
      setNote("PDFs can't be read automatically. Type the amount and due date below.");
      return;
    }
    setReading(0);
    setNote(null);
    const text = await readImageText(small, (x) => setReading(x));
    setReading(null);
    const read = text ? readBillText(text) : null;
    const found = [read?.billMonth, read?.dueDate, read?.payable, read?.afterDue].filter((x) => x !== null && x !== undefined).length;
    if (read?.billMonth) setBillMonth(read.billMonth);
    if (read?.dueDate) setDueDate(read.dueDate);
    if (read?.payable) setPayable(String(read.payable));
    if (read?.afterDue) setAfterDue(String(read.afterDue));
    setNote(found ? `Filled ${found} detail${found === 1 ? "" : "s"} from the bill. Check them against the picture.` : "Couldn't read the bill automatically. Type the details below.");
  };

  const save = () => {
    if (!file) return toast.error("Choose the bill picture or PDF first.");
    const form = new FormData();
    form.set("file", file, name || "bill");
    form.set("meterId", meter.id);
    form.set("billMonth", billMonth);
    form.set("dueDate", dueDate);
    form.set("payable", payable.replace(/,/g, ""));
    form.set("afterDue", afterDue.replace(/,/g, ""));
    start(async () => {
      const r = await uploadBill(form);
      if (r.ok) {
        toast.success(r.message ?? "Bill saved");
        onSaved();
      } else toast.error(r.error);
    });
  };

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && !saving && onClose()} title={`Upload ${p.name} bill`} description={meter.label}>
      <div className="space-y-4 pb-4">
        <Field label="Bill picture, screenshot or PDF" htmlFor="bill-file" hint="Read on this phone; only the file you save is uploaded.">
          <Input id="bill-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => void choose(e.target.files?.[0])} className="h-10" />
        </Field>
        {reading !== null ? (
          <p role="status" className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Reading the bill on this phone… {Math.round(reading * 100)}%
          </p>
        ) : null}
        {note ? <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">{note}</p> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Bill month" htmlFor="bill-month">
            <Input id="bill-month" type="month" value={billMonth} onChange={(e) => setBillMonth(e.target.value)} className="h-10" />
          </Field>
          <Field label="Due date" htmlFor="bill-due">
            <Input id="bill-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-10" />
          </Field>
          <Field label="Payable within due date (Rs)" htmlFor="bill-payable">
            <Input id="bill-payable" inputMode="decimal" value={payable} onChange={(e) => setPayable(e.target.value)} className="num h-10" />
          </Field>
          <Field label="Payable after due date (Rs, optional)" htmlFor="bill-after">
            <Input id="bill-after" inputMode="decimal" value={afterDue} onChange={(e) => setAfterDue(e.target.value)} className="num h-10" />
          </Field>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="h-11 flex-1" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button className="h-11 flex-[2]" onClick={save} disabled={saving || reading !== null || !file || !payable}>
            {saving ? <Loader2 className="animate-spin" /> : <Upload />} Save bill
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}
