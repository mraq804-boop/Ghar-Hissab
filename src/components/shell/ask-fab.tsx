"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Sparkles } from "lucide-react";
import { ResponsiveDialog } from "@/components/ledger/responsive-dialog";
import { ChatBoard } from "@/app/(app)/ask/chat-board";

export function AskFab() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  if (pathname === "/ask" || pathname.startsWith("/ask/")) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ask about the household money"
        title="Ask"
        className="fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 grid size-14 place-items-center rounded-full border bg-card shadow-lg transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-95 md:right-6 md:bottom-6"
      >
        <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-sky-400 via-violet-500 to-amber-400 shadow-sm">
          <Sparkles className="size-5 text-white" />
        </span>
      </button>
      <ResponsiveDialog open={open} onOpenChange={setOpen} title="Ask" description="Tap a quick question or type your own.">
        <ChatBoard compact />
      </ResponsiveDialog>
    </>
  );
}
