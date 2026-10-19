import "server-only";
import { after } from "next/server";
import { excelConfigured } from "@/server/env";
import { runSyncWorker } from "./worker";

export function kickSync() {
  if (!excelConfigured()) return;
  after(async () => {
    try {
      await runSyncWorker({ maxJobs: 4, budgetMs: 45_000 });
    } catch (e) {
      console.error("Excel sync worker failed", e instanceof Error ? e.message : e);
    }
  });
}
