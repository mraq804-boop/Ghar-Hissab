"use client";

import { useEffect, useState } from "react";
import { ExternalLink, FileText, ImageOff, Loader2, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { proofUrl } from "./actions";

export function ProofViewer({ paymentId, hasProof }: { paymentId: string; hasProof: boolean }) {
  const [state, setState] = useState<{ url: string; mime: string } | { error: string } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rotate, setRotate] = useState(0);

  useEffect(() => {
    if (!hasProof) return;
    let live = true;
    proofUrl(paymentId).then((r) => live && setState(r.ok ? r.data : { error: r.error }));
    return () => {
      live = false;
    };
  }, [paymentId, hasProof]);

  if (!hasProof) {
    return (
      <div className="flex h-56 flex-col items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
        <ImageOff className="mb-2 size-6" /> No screenshot attached
      </div>
    );
  }
  if (!state) {
    return <div className="flex h-72 items-center justify-center rounded-xl bg-muted"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  }
  if ("error" in state) {
    return <div className="flex h-56 items-center justify-center rounded-xl border border-dashed px-6 text-center text-sm text-destructive">{state.error}</div>;
  }
  if (state.mime === "application/pdf" || state.mime === "image/heic") {
    return (
      <a href={state.url} target="_blank" rel="noreferrer" className="flex h-40 items-center justify-center gap-2 rounded-xl border bg-muted text-sm font-medium hover:bg-muted/70">
        <FileText className="size-5" /> Open {state.mime === "application/pdf" ? "PDF" : "HEIC image"} <ExternalLink className="size-4" />
      </a>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-[length:20px_20px]">
      <div className="flex h-[22rem] items-center justify-center overflow-auto lg:h-[30rem]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={state.url}
          alt="Payment screenshot"
          className="max-h-full max-w-full object-contain transition-transform duration-200"
          style={{ transform: `scale(${zoom}) rotate(${rotate}deg)` }}
          draggable={false}
        />
      </div>
      <div className="flex items-center justify-between border-t bg-card px-3 py-1.5">
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="size-8" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} aria-label="Zoom out"><ZoomOut /></Button>
          <Button variant="ghost" size="icon" className="size-8" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} aria-label="Zoom in"><ZoomIn /></Button>
          <Button variant="ghost" size="icon" className="size-8" onClick={() => setRotate((r) => (r + 90) % 360)} aria-label="Rotate"><RotateCw /></Button>
        </div>
        <a href={state.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          Full size <ExternalLink className="size-3" />
        </a>
      </div>
    </div>
  );
}
