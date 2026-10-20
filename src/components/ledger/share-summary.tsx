"use client";

import { useState } from "react";
import { Check, Copy, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "./responsive-dialog";

export function ShareSummary({ text, monthLabel }: { text: string; monthLabel: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Summary copied. Paste it in the family group.");
    } catch {
      toast.error("Couldn't copy. Select the text and copy it instead.");
    }
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <MessageCircle /> WhatsApp summary
      </Button>
      <ResponsiveDialog open={open} onOpenChange={setOpen} title="WhatsApp summary" description={`${monthLabel}, ready to send to the family group`}>
        <div className="space-y-4 pb-4">
          <pre className="max-h-[50dvh] overflow-y-auto rounded-xl border bg-muted/40 p-4 font-sans text-sm leading-relaxed whitespace-pre-wrap select-all">{text}</pre>
          <div className="flex gap-2">
            <Button asChild className="h-11 flex-[2] bg-[#25D366] text-[#0b2e17] hover:bg-[#25D366]/90">
              <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">
                <MessageCircle /> Open WhatsApp
              </a>
            </Button>
            <Button variant="outline" className="h-11 flex-1" onClick={() => void copy()}>
              {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">WhatsApp opens with the message ready. You choose the chat and press send yourself.</p>
        </div>
      </ResponsiveDialog>
    </>
  );
}
