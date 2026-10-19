import "server-only";
import { getContext, isAdmin } from "@/server/auth";
import type { SyncSummary } from "@/components/shell/sync-pill";

export type ScopeState = {
  scope: string;
  last_change_at: string;
  last_success_at: string | null;
  last_success_started_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
};

export type RecordSyncState = "synced" | "pending" | "failed" | "off";

export async function getScopeStates(): Promise<ScopeState[]> {
  const ctx = await getContext();
  const { data, error } = await ctx.supabase
    .from("sync_scope_state")
    .select("scope, last_change_at, last_success_at, last_success_started_at, last_failure_at, last_error");
  if (error) throw error;
  return data as ScopeState[];
}

export async function getConnection() {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return null;
  const { data } = await ctx.supabase.from("excel_connection_public").select("*").maybeSingle();
  return data as null | {
    account_email: string | null;
    file_name: string | null;
    web_url: string | null;
    item_id: string | null;
    has_token: boolean;
    connected_at: string;
    token_updated_at: string | null;
  };
}

export function scopeStatus(state: ScopeState | undefined, connected: boolean): RecordSyncState {
  if (!connected) return "off";
  if (!state) return "pending";
  const success = state.last_success_started_at ? Date.parse(state.last_success_started_at) : 0;
  const failure = state.last_failure_at ? Date.parse(state.last_failure_at) : 0;
  if (failure > success) return "failed";
  return Date.parse(state.last_change_at) <= success ? "synced" : "pending";
}

export function recordStatus(updatedAt: string, state: ScopeState | undefined, connected: boolean): RecordSyncState {
  if (!connected) return "off";
  const s = scopeStatus(state, connected);
  if (s === "failed") return "failed";
  const success = state?.last_success_started_at ? Date.parse(state.last_success_started_at) : 0;
  return Date.parse(updatedAt) <= success ? "synced" : "pending";
}

export async function getSyncSummary(): Promise<SyncSummary> {
  const [states, connection] = await Promise.all([getScopeStates(), getConnection()]);
  const connected = Boolean(connection?.has_token && connection.item_id);
  let pending = 0;
  let failed = 0;
  let last: string | null = null;
  for (const s of states) {
    const st = scopeStatus(s, connected);
    if (st === "pending") pending++;
    if (st === "failed") failed++;
    if (s.last_success_at && (!last || s.last_success_at > last)) last = s.last_success_at;
  }
  return { connected, pending, failed, lastSuccessAt: last };
}
