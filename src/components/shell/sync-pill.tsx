import Link from "next/link";
import { CloudAlert, CloudCheck, CloudUpload, CloudOff } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { cn } from "@/lib/utils";

export type SyncSummary = {
  connected: boolean;
  pending: number;
  failed: number;
  lastSuccessAt: string | null;
};

export function SyncPill({ summary }: { summary: SyncSummary }) {
  const { connected, pending, failed, lastSuccessAt } = summary;
  const state = !connected ? "off" : failed > 0 ? "failed" : pending > 0 ? "pending" : "ok";
  const Icon = { off: CloudOff, failed: CloudAlert, pending: CloudUpload, ok: CloudCheck }[state];
  const text = {
    off: "Sheet not connected",
    failed: `${failed} sync ${failed === 1 ? "failure" : "failures"}`,
    pending: `${pending} waiting to sync`,
    ok: lastSuccessAt ? `Synced ${formatDistanceToNowStrict(new Date(lastSuccessAt))} ago` : "Synced",
  }[state];

  return (
    <Link
      href="/sync"
      className={cn(
        "hidden h-9 items-center gap-2 rounded-full border px-3 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex",
        state === "ok" && "border-success/30 bg-success-soft text-success",
        state === "pending" && "border-warning/30 bg-warning-soft text-warning",
        state === "failed" && "border-destructive/30 bg-danger-soft text-destructive",
        state === "off" && "bg-card text-muted-foreground",
      )}
    >
      <Icon className={cn("size-4", state === "pending" && "animate-pulse")} />
      {text}
    </Link>
  );
}
