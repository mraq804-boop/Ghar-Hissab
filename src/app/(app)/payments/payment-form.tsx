"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Camera, Check, FileText, ImageUp, Loader2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ledger/field";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { PAYMENT_METHODS, methodLabel } from "@/lib/labels";
import { parseRupeesToPaisa, formatPaisa } from "@/lib/finance/money";
import { ALLOWED_PROOF_TYPES, PROOF_EXT, type ProofType } from "@/lib/validation/payment";
import { cn } from "@/lib/utils";
import { submitPayment } from "./actions";

type Unit = { id: string; code: string };
type PeriodOpt = { id: string; label: string };

const STEPS = ["Details", "Screenshot", "Review"] as const;

async function compress(file: File): Promise<File> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size < 1_200_000) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }) : file;
}

export function PaymentForm({
  householdId,
  userId,
  units,
  fixedUnitId,
  periods,
  defaultPeriodId,
  maxUploadMb,
  onDone,
}: {
  householdId: string;
  userId: string;
  units: Unit[];
  fixedUnitId: string | null;
  periods: PeriodOpt[];
  defaultPeriodId: string;
  maxUploadMb: number;
  onDone: () => void;
}) {
  const [key] = useState(() => crypto.randomUUID());
  const [step, setStep] = useState(0);
  const [payer, setPayer] = useState(fixedUnitId ?? units[0]?.id ?? "");
  const [periodId, setPeriodId] = useState(defaultPeriodId);
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<string>("bank_transfer");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const amountPaisa = (() => {
    try {
      return parseRupeesToPaisa(amount);
    } catch {
      return null;
    }
  })();
  const needsProof = method !== "cash";

  const validateDetails = () => {
    const e: Record<string, string> = {};
    if (!payer) e.payer = "Choose who paid";
    if (amountPaisa === null || amountPaisa <= 0n) e.amount = "Enter the amount paid, e.g. 5000";
    if (!paidOn) e.paidOn = "Choose the payment date";
    if (paidOn > new Date().toISOString().slice(0, 10)) e.paidOn = "The payment date can't be in the future";
    if (method !== "cash" && reference.trim().length === 0) e.reference = "Add the transaction ID from the receipt so it can't be counted twice";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const choose = async (f: File | undefined | null) => {
    if (!f) return;
    if (!ALLOWED_PROOF_TYPES.includes(f.type as ProofType)) {
      setErrors({ file: "Use a JPG, PNG, WebP, HEIC image or a PDF." });
      return;
    }
    const ready = await compress(f);
    if (ready.size > maxUploadMb * 1024 * 1024) {
      setErrors({ file: `The file is ${(ready.size / 1048576).toFixed(1)} MB. The limit is ${maxUploadMb} MB.` });
      return;
    }
    setErrors({});
    setFile(ready);
    setUploadedPath(null);
    setPreview(ready.type.startsWith("image/") && ready.type !== "image/heic" ? URL.createObjectURL(ready) : null);
  };

  const upload = async () => {
    if (!file) return null;
    if (uploadedPath) return uploadedPath;
    setUploading(true);
    try {
      const path = `${householdId}/${userId}/${crypto.randomUUID()}.${PROOF_EXT[file.type as ProofType]}`;
      const { error } = await createSupabaseBrowser().storage.from("payment-proofs").upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      setUploadedPath(path);
      return path;
    } finally {
      setUploading(false);
    }
  };

  const next = async () => {
    if (step === 0 && !validateDetails()) return;
    if (step === 1) {
      if (needsProof && !file) {
        setErrors({ file: "Attach a screenshot of the payment confirmation." });
        return;
      }
      try {
        await upload();
      } catch {
        setErrors({ file: "The upload failed. Check your connection and try again." });
        return;
      }
    }
    setStep((s) => s + 1);
  };

  const submit = () =>
    start(async () => {
      const r = await submitPayment({
        idempotencyKey: key,
        periodId,
        payerUnitId: payer,
        amount,
        paidOn,
        method: method as never,
        reference,
        notes,
        proofPath: uploadedPath,
      });
      if (r.ok) {
        toast.success(r.message);
        if (r.data.duplicateScreenshot) toast.warning("This screenshot was already used for another payment. The administrator will see a warning.");
        onDone();
      } else {
        toast.error(r.error);
        if (r.fieldErrors) setErrors(Object.fromEntries(Object.entries(r.fieldErrors).map(([k, v]) => [k, v[0]])));
        if (/reference/i.test(r.error)) setStep(0);
      }
    });

  return (
    <div className="space-y-6 pb-4">
      <ol className="flex items-center gap-2" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold",
                i < step && "border-success bg-success text-white",
                i === step && "border-haldi bg-accent text-accent-foreground",
              )}
              aria-current={i === step ? "step" : undefined}
            >
              {i < step ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className={cn("text-sm", i === step ? "font-medium" : "text-muted-foreground")}>{s}</span>
            {i < STEPS.length - 1 ? <span className="h-px flex-1 bg-border" /> : null}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Paid by" htmlFor="payer" error={errors.payer}>
              <Select value={payer} onValueChange={setPayer} disabled={!!fixedUnitId}>
                <SelectTrigger id="payer" className="h-10 w-full"><SelectValue placeholder="Household" /></SelectTrigger>
                <SelectContent>{units.map((u) => <SelectItem key={u.id} value={u.id}>{u.code} household</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="For the month of" htmlFor="period">
              <Select value={periodId} onValueChange={setPeriodId}>
                <SelectTrigger id="period" className="h-10 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{periods.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount (Rs)" htmlFor="amount" error={errors.amount}>
              <Input id="amount" inputMode="decimal" className="num h-12 text-lg font-semibold" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!errors.amount} autoFocus />
            </Field>
            <Field label="Payment date" htmlFor="paidOn" error={errors.paidOn}>
              <Input id="paidOn" type="date" className="h-12" value={paidOn} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setPaidOn(e.target.value)} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Method" htmlFor="method">
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger id="method" className="h-10 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{PAYMENT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label={method === "cash" ? "Reference (optional)" : "Transaction ID"} htmlFor="reference" error={errors.reference}>
              <Input id="reference" className="h-10" value={reference} onChange={(e) => setReference(e.target.value)} placeholder={method === "cash" ? "" : "From the app or bank SMS"} />
            </Field>
          </div>
          <Field label="Notes (optional)" htmlFor="notes">
            <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="space-y-3">
          {!file ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void choose(e.dataTransfer.files[0]);
              }}
              className={cn("flex flex-col items-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors", dragging ? "border-haldi bg-accent" : "bg-muted/30")}
            >
              <ImageUp className="size-8 text-muted-foreground" />
              <p className="mt-3 font-medium">Add the payment screenshot</p>
              <p className="mt-1 text-sm text-muted-foreground">JPG, PNG, WebP, HEIC or PDF, up to {maxUploadMb} MB. Large photos are shrunk before upload.</p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Button type="button" variant="outline" onClick={() => fileInput.current?.click()}><ImageUp /> Choose file</Button>
                <Button type="button" variant="outline" className="sm:hidden" onClick={() => cameraInput.current?.click()}><Camera /> Take photo</Button>
              </div>
              {!needsProof ? <p className="mt-4 text-xs text-muted-foreground">Optional for cash payments.</p> : null}
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border">
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="Selected payment screenshot" className="max-h-80 w-full bg-muted object-contain" />
              ) : (
                <div className="flex items-center gap-3 bg-muted p-6"><FileText className="size-8 text-muted-foreground" /><span className="truncate text-sm">{file.name}</span></div>
              )}
              <div className="flex items-center justify-between border-t px-4 py-2 text-sm">
                <span className="truncate text-muted-foreground">{(file.size / 1024).toFixed(0)} KB{uploadedPath ? ", uploaded" : ""}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => { setFile(null); setPreview(null); setUploadedPath(null); }}>
                  <X /> Remove
                </Button>
              </div>
            </div>
          )}
          {errors.file ? <p role="alert" className="text-sm text-destructive">{errors.file}</p> : null}
          <input ref={fileInput} type="file" accept={ALLOWED_PROOF_TYPES.join(",")} className="sr-only" onChange={(e) => void choose(e.target.files?.[0])} />
          <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => void choose(e.target.files?.[0])} />
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-4">
          <div className="rounded-2xl border bg-muted/30 p-5">
            <p className="text-sm text-muted-foreground">{units.find((u) => u.id === payer)?.code} household pays</p>
            <p className="num mt-1 font-heading text-4xl font-bold">{amountPaisa !== null ? formatPaisa(amountPaisa, { decimals: amountPaisa % 100n !== 0n }) : "—"}</p>
            <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Month</dt><dd>{periods.find((p) => p.id === periodId)?.label}</dd>
              <dt className="text-muted-foreground">Date</dt><dd>{new Date(paidOn).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</dd>
              <dt className="text-muted-foreground">Method</dt><dd>{methodLabel(method)}</dd>
              {reference ? (<><dt className="text-muted-foreground">Transaction ID</dt><dd className="truncate">{reference}</dd></>) : null}
              <dt className="text-muted-foreground">Screenshot</dt><dd>{uploadedPath ? "Attached" : "None"}</dd>
            </dl>
          </div>
          <p className="text-sm text-muted-foreground">The payment is marked <strong className="text-foreground">pending verification</strong>. It counts toward your balance once the administrator checks it against the screenshot.</p>
        </div>
      ) : null}

      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t bg-background px-4 pt-4 pb-1">
        {step > 0 ? (
          <Button type="button" variant="outline" className="h-11 flex-1" onClick={() => setStep((s) => s - 1)} disabled={pending || uploading}>
            <RotateCcw /> Back
          </Button>
        ) : (
          <Button type="button" variant="outline" className="h-11 flex-1" onClick={onDone}>Cancel</Button>
        )}
        {step < 2 ? (
          <Button type="button" className="h-11 flex-[2]" onClick={() => void next()} disabled={uploading}>
            {uploading ? <Loader2 className="animate-spin" /> : null}
            {uploading ? "Uploading…" : step === 1 && !file && !needsProof ? "Skip" : "Continue"}
          </Button>
        ) : (
          <Button type="button" className="h-11 flex-[2]" onClick={submit} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Check />}
            Submit payment
          </Button>
        )}
      </div>
    </div>
  );
}
