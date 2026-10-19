import { formatPaisa } from "@/lib/finance/money";
import { cn } from "@/lib/utils";

export function Money({
  paisa,
  decimals,
  signed,
  tone,
  className,
}: {
  paisa: bigint | null | undefined;
  decimals?: boolean;
  signed?: boolean;
  tone?: "auto" | "muted";
  className?: string;
}) {
  if (paisa === null || paisa === undefined) {
    return <span className={cn("num text-muted-foreground", className)}>—</span>;
  }
  return (
    <span
      className={cn(
        "num whitespace-nowrap",
        tone === "auto" && paisa > 0n && "text-success",
        tone === "auto" && paisa < 0n && "text-destructive",
        tone === "muted" && "text-muted-foreground",
        className,
      )}
    >
      {formatPaisa(paisa, { decimals, sign: signed })}
    </span>
  );
}
