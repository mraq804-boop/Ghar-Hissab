"use client";

import { WifiOff } from "lucide-react";
import { useOffline } from "next/offline";

export function OfflineBanner() {
  const offline = useOffline();
  if (!offline) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-[#1b2340] px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-sm text-white"
    >
      <WifiOff className="size-4 shrink-0 text-[#e2a322]" />
      You&apos;re offline. Anything you just saved will be sent when the connection is back.
    </div>
  );
}
