import type { Metadata } from "next";
import { Suspense } from "react";
import { formatDistanceToNowStrict, format } from "date-fns";
import { CheckCircle2, CircleAlert, FileSpreadsheet, ShieldAlert } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageHeader, Panel } from "@/components/ledger/page-header";
import { StatusBadge, syncBadgeKey } from "@/components/ledger/status-badge";
import { getContext, isAdmin } from "@/server/auth";
import { getConnection, getScopeStates, scopeStatus } from "@/server/data/sync";
import { getReference } from "@/server/data/ledger";
import { excelConfigured } from "@/server/env";
import { periodLabel } from "@/lib/periods";
import { MONTHS_LONG } from "@/lib/periods";
import { ConnectionActions, ScopeActions, SyncNowButton } from "./sync-controls";

export const metadata: Metadata = { title: "Excel sync" };

export default function SyncPage({ searchParams }: PageProps<"/sync">) {
  return (
    <>
      <PageHeader
        title="Excel sync"
        description="Every change in the app is written to the family Google Sheet. A sheet only shows as synced after its totals have been read back from Google and match."
        actions={<Suspense fallback={null}><SyncNowSlot /></Suspense>}
      />
      <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
        <SyncContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function SyncNowSlot() {
  const ctx = await getContext();
  return isAdmin(ctx) && excelConfigured() ? <SyncNowButton /> : null;
}

const ERRORS: Record<string, string> = {
  forbidden: "Only administrators can connect Google.",
  not_configured: "The server is missing its Google app credentials. See docs/EXCEL_SYNC.md.",
  denied: "Google sign-in was cancelled.",
  state: "The sign-in response could not be verified. Try connecting again.",
  exchange: "Google did not accept the sign-in. Try again, or check the OAuth client settings.",
  save: "The connection could not be saved.",
  scope: "Google did not grant access to spreadsheets. Connect again and tick the Sheets permission.",
  no_refresh: "Google did not return a long-lived token. Remove the app at myaccount.google.com/permissions, then connect again.",
};

function scopeLabel(scope: string, periods: { id: string; year: number; month: number }[]) {
  if (scope === "menu") return "Weekly food schedule";
  if (scope.startsWith("duties:")) {
    const [y, m] = scope.slice(7).split("-").map(Number);
    return `Kitchen duties, ${MONTHS_LONG[m - 1]} ${y}`;
  }
  const p = periods.find((x) => x.id === scope.slice(7));
  return p ? `Expenses, ${periodLabel(p, true)}` : "Deleted month";
}

async function SyncContent({ searchParams }: { searchParams: PageProps<"/sync">["searchParams"] }) {
  const ctx = await getContext();
  if (!isAdmin(ctx)) {
    return <EmptyState icon={ShieldAlert} title="Administrators only">Ask the family administrator about the Google Sheet.</EmptyState>;
  }
  const sp = await searchParams;
  const [connection, states, ref, runs, sheets] = await Promise.all([
    getConnection(),
    getScopeStates(),
    getReference(),
    ctx.supabase.from("sync_runs").select("id, scope, started_at, finished_at, ok, message").order("started_at", { ascending: false }).limit(15),
    ctx.supabase.from("excel_sheets").select("scope, worksheet_name, last_synced_at"),
  ]);
  const configured = excelConfigured();
  const connected = Boolean(connection?.has_token && connection.item_id);
  const error = typeof sp.error === "string" ? ERRORS[sp.error] : null;

  return (
    <div className="space-y-6">
      {error ? <p role="alert" className="rounded-xl border border-destructive/30 bg-danger-soft px-4 py-3 text-sm text-destructive">{error}</p> : null}
      {sp.connected ? <p role="status" className="rounded-xl border border-success/30 bg-success-soft px-4 py-3 text-sm text-success">Google is connected. Now link the Google Sheet.</p> : null}

      <Panel title="Workbook" description="The live Google Sheet copy of Grocery_Shopping_List.xlsx">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <span className={`grid size-12 shrink-0 place-items-center rounded-xl ${connected ? "bg-success-soft text-success" : "bg-muted text-muted-foreground"}`}>
              <FileSpreadsheet className="size-6" />
            </span>
            <div className="min-w-0">
              {!configured ? (
                <>
                  <p className="font-medium">Google integration not configured</p>
                  <p className="text-sm text-muted-foreground">Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and EXCEL_TOKEN_ENC_KEY on the server. Until then changes are queued and nothing is written to the sheet.</p>
                </>
              ) : !connection?.has_token ? (
                <>
                  <p className="font-medium">Google not connected</p>
                  <p className="text-sm text-muted-foreground">Sign in with the Google account that can edit the family sheet.</p>
                </>
              ) : (
                <>
                  <p className="font-medium">
                    {connection.file_name ? (
                      <a href={connection.web_url ?? "#"} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">{connection.file_name}</a>
                    ) : (
                      "No sheet linked yet"
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {connection.account_email ?? "Google account"}, connected {formatDistanceToNowStrict(new Date(connection.connected_at))} ago
                  </p>
                </>
              )}
            </div>
          </div>
          {configured ? <ConnectionActions hasToken={Boolean(connection?.has_token)} hasFile={Boolean(connection?.item_id)} /> : null}
        </div>
      </Panel>

      <Panel title="Sheets" bodyClassName="p-0">
        {states.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">Nothing has been queued for Excel yet.</p>
        ) : (
          <ul className="divide-y">
            {states
              .sort((a, b) => b.last_change_at.localeCompare(a.last_change_at))
              .map((s) => {
                const st = scopeStatus(s, connected);
                const sheet = sheets.data?.find((x) => x.scope === s.scope);
                return (
                  <li key={s.scope} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{scopeLabel(s.scope, ref.periods)}</p>
                        <StatusBadge status={syncBadgeKey(st)} />
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {sheet?.worksheet_name ? `Sheet "${sheet.worksheet_name}". ` : ""}
                        {s.last_success_at ? `Last confirmed ${formatDistanceToNowStrict(new Date(s.last_success_at))} ago.` : "Never synced."}
                      </p>
                      {st === "failed" && s.last_error ? <p className="mt-1 text-sm text-destructive">{s.last_error}</p> : null}
                    </div>
                    <ScopeActions scope={s.scope} failed={st === "failed"} />
                  </li>
                );
              })}
          </ul>
        )}
      </Panel>

      <Panel title="Recent sync runs" bodyClassName="p-0">
        {runs.data?.length ? (
          <ol className="divide-y">
            {runs.data.map((r) => (
              <li key={r.id} className="flex gap-3 px-5 py-3">
                {r.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : r.ok === false ? <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" /> : <span className="mt-1 size-3 shrink-0 animate-pulse rounded-full bg-warning" />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{r.message ?? "Running…"}</p>
                  <p className="text-xs text-muted-foreground">{scopeLabel(r.scope, ref.periods)}, {format(new Date(r.started_at), "d MMM, h:mm a")}</p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">No sync runs yet.</p>
        )}
      </Panel>
    </div>
  );
}
