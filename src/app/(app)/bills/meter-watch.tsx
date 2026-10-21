"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, Gauge, Loader2, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ledger/field";
import { ResponsiveDialog } from "@/components/ledger/responsive-dialog";
import { shrinkImage } from "@/lib/images";
import { readImageText } from "@/lib/ocr/read-screenshot";
import { readMeterDigits } from "@/lib/utilities/meter-watch";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import type { MeterWatchView } from "@/server/data/meter-watch";
import { addMeterReading, deleteMeterReading, setUnitLimit } from "./actions";

const day = (d: string) => new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const when = (d: string) => new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const monthShort = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("en-GB", { month: "short" });

const BAR = { none: "bg-muted-foreground/30", ok: "bg-success", watch: "bg-warning", over: "bg-destructive" } as const;

export function summary(w: MeterWatchView) {
  if (w.problem === "below_baseline") return `The last reading (${w.latest}) is lower than LESCO's reading (${w.baseline}). Check it, or remove it if it was a mistake.`;
  if (w.used === null) return `No reading yet since LESCO read ${w.baseline} on ${day(w.baselineDate)}. Add one to start tracking.`;
  const left = Math.max(0, w.limit - w.used);
  const pace = w.projected !== null ? ` At this pace about ${w.projected} units by ${day(w.nextReadingDate)}.` : "";
  const allowance = w.allowancePerDay !== null && w.used < w.limit ? ` Keep to about ${w.allowancePerDay} units a day to stay under ${w.limit}.` : "";
  if (w.used >= w.limit) return `${w.used} units used, already over the ${w.limit}-unit limit.`;
  return `${w.used} units used, ${left} left before ${w.limit}.${pace}${allowance}`;
}

export function MeterWatchPanel({ watch, householdId, admin }: { watch: MeterWatchView; householdId: string; admin: boolean }) {
  const [adding, setAdding] = useState(false);
  const [editingLimit, setEditingLimit] = useState(false);
  const [limit, setLimit] = useState(String(watch.limit));
  const router = useRouter();
  const [pending, start] = useTransition();
  const pct = watch.used === null ? 0 : Math.min(100, Math.round((watch.used / watch.limit) * 100));
  const projectedPct = watch.projected === null ? null : Math.min(100, Math.round((watch.projected / watch.limit) * 100));
  const maxHistory = Math.max(watch.limit, ...watch.history.map((h) => h.units));

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Saved");
      else toast.error(r.error ?? "Couldn't save");
      router.refresh();
    });

  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium"><Gauge className="size-4 text-haldi" /> Meter watch · limit {watch.limit} units</p>
        <div className="flex gap-2">
          {admin ? <Button size="sm" variant="ghost" onClick={() => setEditingLimit((x) => !x)}>Limit</Button> : null}
          <Button size="sm" onClick={() => setAdding(true)}><Camera /> Add reading</Button>
        </div>
      </div>

      {editingLimit ? (
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => setUnitLimit({ meterId: watch.meterId, limit: Number(limit) })); setEditingLimit(false); }}>
          <Field label="Monthly unit limit" htmlFor={`limit-${watch.meterId}`}>
            <Input id={`limit-${watch.meterId}`} inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} className="num h-10 w-28" />
          </Field>
          <Button type="submit" size="sm" disabled={pending}>Save</Button>
        </form>
      ) : null}

      <div className="relative h-3 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`${watch.used ?? 0} of ${watch.limit} units used`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        {projectedPct !== null && projectedPct > pct ? <div className={cn("absolute inset-y-0 left-0 rounded-full opacity-30", BAR[watch.level])} style={{ width: `${projectedPct}%` }} /> : null}
        <div className={cn("absolute inset-y-0 left-0 rounded-full", BAR[watch.level])} style={{ width: `${pct}%` }} />
      </div>

      <p className={cn("flex gap-2 text-sm", watch.level === "over" || watch.problem ? "text-destructive" : watch.level === "watch" ? "text-warning" : "text-muted-foreground")}>
        {watch.level === "over" || watch.level === "watch" || watch.problem ? <TriangleAlert className="mt-0.5 size-4 shrink-0" /> : null}
        <span>{summary(watch)}</span>
      </p>
      <p className="text-xs text-muted-foreground">
        LESCO read {watch.baseline} on {day(watch.baselineDate)}; next reading about {day(watch.nextReadingDate)} ({watch.daysLeft} days).
        {watch.latestAt ? ` Last family reading ${watch.latest} on ${when(watch.latestAt)}.` : ""}
        {watch.stale && watch.used !== null ? " It's been over a week, take a new reading." : ""}
      </p>

      {watch.readings.length ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Readings this cycle ({watch.readings.length})</summary>
          <ul className="mt-2 divide-y rounded-lg border">
            {watch.readings.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-3 py-1.5">
                <span><span className="num font-medium">{r.reading}</span> <span className="text-muted-foreground">· {when(r.readAt)}</span></span>
                {r.mine || admin ? (
                  <Button size="icon" variant="ghost" aria-label="Remove reading" disabled={pending} onClick={() => run(() => deleteMeterReading(r.id))}><Trash2 /></Button>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {watch.history.length ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Last {watch.history.length} months from LESCO</summary>
          <div className="mt-3 flex h-28 items-end gap-1" role="img" aria-label="Units per month">
            {watch.history.map((h) => (
              <div key={h.month} className="flex flex-1 flex-col items-center gap-1">
                <span className="num text-[10px] text-muted-foreground">{h.units}</span>
                <div className={cn("w-full rounded-t", h.units >= watch.limit ? "bg-destructive" : h.units >= watch.limit * 0.85 ? "bg-warning" : "bg-success")} style={{ height: `${Math.max(2, Math.round((h.units / maxHistory) * 80))}px` }} />
                <span className="text-[10px] text-muted-foreground">{monthShort(h.month)}</span>
              </div>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Red months went over {watch.limit} units.</p>
        </details>
      ) : null}

      {adding ? <AddReading watch={watch} householdId={householdId} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); start(() => router.refresh()); }} /> : null}
    </div>
  );
}

function AddReading({ watch, householdId, onClose, onSaved }: { watch: MeterWatchView; householdId: string; onClose: () => void; onSaved: () => void }) {
  const [reading, setReading] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saving, start] = useTransition();

  const snap = async (f: File | undefined) => {
    if (!f) return;
    const small = await shrinkImage(f);
    const mime = small.type || f.type;
    if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) return toast.error("Use a JPG, PNG or WebP photo.");
    const path = `${householdId}/${watch.meterId}/${crypto.randomUUID()}.${mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg"}`;
    const up = await createSupabaseBrowser().storage.from("meter-photos").upload(path, small, { contentType: mime, upsert: false });
    if (!up.error) setPhoto(path);
    setProgress(0);
    const text = await readImageText(small, (p) => setProgress(p));
    setProgress(null);
    const digits = text ? readMeterDigits(text) : null;
    const plausible = digits !== null && digits >= watch.baseline && digits - watch.baseline <= 2000;
    if (plausible) {
      setReading(String(digits));
      setNote("Read from the photo. Check it against the meter (black digits only).");
    } else setNote("Couldn't read the meter clearly. Type the black digits shown on it.");
  };

  const discard = () => {
    if (photo) void createSupabaseBrowser().storage.from("meter-photos").remove([photo]);
    onClose();
  };

  const save = () =>
    start(async () => {
      const r = await addMeterReading({ meterId: watch.meterId, reading, photoPath: photo });
      if (r.ok) {
        toast.success(r.message ?? "Saved");
        onSaved();
      } else toast.error(r.error);
    });

  const n = Number(reading);
  const preview = reading && Number.isFinite(n) && n >= watch.baseline ? `${n - watch.baseline} units since LESCO read ${watch.baseline}` : null;

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && !saving && discard()} title={`Meter reading · ${watch.label}`} description={`LESCO's last reading: ${watch.baseline}`}>
      <div className="space-y-4 pb-4">
        <Field label="Photo of the meter (optional)" htmlFor="meter-photo" hint="Read on this phone. The photo is kept privately for the family.">
          <Input id="meter-photo" type="file" accept="image/*" capture="environment" onChange={(e) => void snap(e.target.files?.[0])} className="h-10" />
        </Field>
        {progress !== null ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Reading the meter… {Math.round(progress * 100)}%</p> : null}
        {note ? <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">{note}</p> : null}
        <Field label="Reading on the meter" htmlFor="meter-reading" hint={preview ?? "Type the black digits, e.g. 901"}>
          <Input id="meter-reading" inputMode="numeric" value={reading} onChange={(e) => setReading(e.target.value.replace(/\D/g, ""))} className="num h-12 text-xl" />
        </Field>
        <div className="flex gap-2">
          <Button variant="outline" className="h-11 flex-1" onClick={discard} disabled={saving}>Cancel</Button>
          <Button className="h-11 flex-[2]" onClick={save} disabled={saving || progress !== null || !reading}>{saving ? <Loader2 className="animate-spin" /> : null} Save reading</Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}
