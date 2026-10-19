import {
  CheckCircle2,
  CircleDashed,
  Clock3,
  CloudAlert,
  CloudCheck,
  CloudOff,
  CloudUpload,
  ArrowDownLeft,
  ArrowUpRight,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "success" | "warning" | "danger" | "neutral" | "info";

const TONES: Record<Tone, string> = {
  success: "bg-success-soft text-success border-success/25",
  warning: "bg-warning-soft text-warning border-warning/25",
  danger: "bg-danger-soft text-destructive border-destructive/25",
  info: "bg-info-soft text-info border-info/25",
  neutral: "bg-muted text-muted-foreground border-border",
};

const STATUS: Record<string, { label: string; tone: Tone; icon: LucideIcon }> = {
  pending: { label: "Pending verification", tone: "warning", icon: Clock3 },
  approved: { label: "Approved", tone: "success", icon: CheckCircle2 },
  rejected: { label: "Rejected", tone: "danger", icon: XCircle },
  gets_back: { label: "Gets back", tone: "success", icon: ArrowDownLeft },
  to_pay: { label: "To pay", tone: "danger", icon: ArrowUpRight },
  settled: { label: "Settled", tone: "info", icon: CheckCircle2 },
  not_paid: { label: "Not paid", tone: "neutral", icon: CircleDashed },
  synced: { label: "Synced", tone: "success", icon: CloudCheck },
  sync_pending: { label: "Pending sync", tone: "warning", icon: CloudUpload },
  sync_failed: { label: "Sync failed", tone: "danger", icon: CloudAlert },
  sync_off: { label: "Not connected", tone: "neutral", icon: CloudOff },
  open: { label: "Open", tone: "info", icon: CircleDashed },
  closed: { label: "Closed", tone: "neutral", icon: CheckCircle2 },
  bill_pending: { label: "Bill not issued", tone: "neutral", icon: Clock3 },
};

export function StatusBadge({ status, label, compact, className }: { status: keyof typeof STATUS | string; label?: string; compact?: boolean; className?: string }) {
  const s = STATUS[status] ?? { label: status, tone: "neutral" as Tone, icon: CircleDashed };
  const Icon = s.icon;
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-medium whitespace-nowrap",
        TONES[s.tone],
        compact && "h-5 px-1.5 text-[11px]",
        className,
      )}
      title={compact ? (label ?? s.label) : undefined}
    >
      <Icon className={compact ? "size-3" : "size-3.5"} aria-hidden />
      {compact ? <span className="sr-only">{label ?? s.label}</span> : (label ?? s.label)}
    </span>
  );
}

export function syncBadgeKey(s: "synced" | "pending" | "failed" | "off") {
  return s === "synced" ? "synced" : s === "pending" ? "sync_pending" : s === "failed" ? "sync_failed" : "sync_off";
}
