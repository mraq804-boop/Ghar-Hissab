"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarPlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MONTHS_LONG } from "@/lib/periods";
import { startPeriod } from "./actions";

export function StartMonth({ year, month, variant = "default" }: { year: number; month: number; variant?: "default" | "outline" }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant={variant}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await startPeriod({ year, month });
          if (r.ok) {
            toast.success(`${MONTHS_LONG[month - 1]} ${year} started`);
            router.push(`/expenses?m=${year}-${String(month).padStart(2, "0")}`);
          } else toast.error(r.error);
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <CalendarPlus />}
      Start {MONTHS_LONG[month - 1]} {year}
    </Button>
  );
}
