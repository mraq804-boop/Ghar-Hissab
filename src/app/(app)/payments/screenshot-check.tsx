"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleHelp, Loader2, ScanText, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { paisaToDecimalString } from "@/lib/finance/money";
import { compareWithScreenshot, type CheckResult } from "@/lib/ocr/parse-payment";
import { readPaymentScreenshot } from "@/lib/ocr/read-screenshot";
import { cn } from "@/lib/utils";
import { proofUrl } from "./actions";

type State = { kind: "idle" } | { kind: "reading"; progress: number } | { kind: "done"; results: CheckResult[] } | { kind: "failed"; message: string };

/**
 * Reads the payment screenshot on the administrator's own device and compares it with what was entered.
 * Advisory only: it never approves or rejects anything.
 */
export function ScreenshotCheck({
  paymentId,
  auto,
  amountPaisa,
  paidOn,
  reference,
}: {
  paymentId: string;
  auto: boolean;
  amountPaisa: bigint;
  paidOn: string;
  reference: string | null;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const started = useRef(false);

  const run = useCallback(async () => {
    setState({ kind: "reading", progress: 0 });
    const link = await proofUrl(paymentId);
    if (!link.ok) return setState({ kind: "failed", message: link.error });
    const res = await fetch(link.data.url).catch(() => null);
    if (!res?.ok) return setState({ kind: "failed", message: "The screenshot couldn't be downloaded for checking." });
    const blob = await res.blob();
    const read = await readPaymentScreenshot(new Blob([blob], { type: link.data.mime }), (p) => setState({ kind: "reading", progress: p }));
    if (!read) return setState({ kind: "failed", message: "Couldn't read this screenshot automatically. Check it by eye." });
    setState({ kind: "done", results: compareWithScreenshot(read, { amount: paisaToDecimalString(amountPaisa), paidOn, reference }) });
  }, [paymentId, amountPaisa, paidOn, reference]);

  useEffect(() => {
    if (!auto || started.current) return;
    started.current = true;
    const t = setTimeout(() => void run(), 0);
    return () => clearTimeout(t);
  }, [auto, run]);

  if (state.kind === "idle") {
    return (
      <Button variant="outline" size="sm" onClick={() => void run()}>
        <ScanText /> Check screenshot against the details
      </Button>
    );
  }
  if (state.kind === "reading") {
    return (
      <p role="status" className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Checking the screenshot on this device… {Math.round(state.progress * 100)}%
      </p>
    );
  }
  if (state.kind === "failed") {
    return <p className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"><CircleHelp className="size-4" /> {state.message}</p>;
  }
  return (
    <div className="rounded-xl border p-3">
      <p className="mb-2 flex items-center gap-2 text-sm font-medium"><ScanText className="size-4" /> Screenshot check</p>
      <ul className="space-y-1.5 text-sm">
        {state.results.map((r) => (
          <li
            key={r.field}
            className={cn(
              "flex gap-2",
              r.status === "match" && "text-success",
              r.status === "mismatch" && "text-warning",
              r.status === "unread" && "text-muted-foreground",
            )}
          >
            {r.status === "match" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : r.status === "mismatch" ? <TriangleAlert className="mt-0.5 size-4 shrink-0" /> : <CircleHelp className="mt-0.5 size-4 shrink-0" />}
            {r.message}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">Read automatically on this device and can be wrong. Always look at the screenshot before deciding.</p>
    </div>
  );
}
