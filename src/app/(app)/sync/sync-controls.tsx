"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileSpreadsheet, Hammer, Link2, Link2Off, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmButton } from "@/components/ledger/confirm-button";
import { Field } from "@/components/ledger/field";
import { disconnectSheets, linkSheet, rebuildSheet, retrySync, syncNow } from "./actions";

export function SyncNowButton() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      onClick={() =>
        start(async () => {
          const r = await syncNow();
          if (r.ok) (r.data.failed ? toast.warning : toast.success)(r.message);
          else toast.error(r.error);
          router.refresh();
        })
      }
      disabled={pending}
    >
      {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
      {pending ? "Syncing…" : "Sync now"}
    </Button>
  );
}

export function ConnectionActions({ hasToken, hasFile }: { hasToken: boolean; hasFile: boolean }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <div className="flex flex-wrap gap-2">
      {!hasToken ? (
        <Button asChild>
          <a href="/api/excel/oauth/start"><Link2 /> Connect Google</a>
        </Button>
      ) : (
        <>
          <Button variant={hasFile ? "outline" : "default"} onClick={() => setOpen(true)}>
            <FileSpreadsheet /> {hasFile ? "Change sheet" : "Link Google Sheet"}
          </Button>
          <Button asChild variant="ghost">
            <a href="/api/excel/oauth/start"><RotateCcw /> Reconnect</a>
          </Button>
          <ConfirmButton
            variant="ghost"
            title="Disconnect Google?"
            description="Changes keep queuing in the app, but nothing is written to the sheet until you connect again."
            confirmLabel="Disconnect"
            destructive
            onConfirm={async () => {
              const r = await disconnectSheets();
              if (r.ok) toast.success(r.message);
              else toast.error(r.error);
              router.refresh();
            }}
          >
            <Link2Off /> Disconnect
          </ConfirmButton>
        </>
      )}

      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Link the family Google Sheet</DialogTitle>
            <DialogDescription>
              Open the sheet in Google Sheets and copy the link from the address bar. It must be editable by the Google account you connected.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              start(async () => {
                const r = await linkSheet({ url });
                if (r.ok) {
                  toast.success(r.message);
                  setOpen(false);
                  setUrl("");
                  router.refresh();
                } else setError(r.error);
              });
            }}
          >
            <Field label="Google Sheet link" htmlFor="sheet-url" error={error ?? undefined}>
              <Input
                id="sheet-url"
                className="h-10"
                placeholder="https://docs.google.com/spreadsheets/d/…/edit"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                autoFocus
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
              <Button type="submit" disabled={pending || url.trim().length < 10}>
                {pending ? <Loader2 className="animate-spin" /> : null} Link sheet
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ScopeActions({ scope, failed }: { scope: string; failed: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        variant={failed ? "default" : "outline"}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await retrySync(scope);
            if (r.ok) toast.success("Queued for sync");
            else toast.error(r.error);
            router.refresh();
          })
        }
      >
        <RefreshCw /> Retry
      </Button>
      <ConfirmButton
        size="sm"
        variant="ghost"
        title="Rebuild this sheet?"
        description="The app will rewrite the whole sheet from its records, including formatting. Anything typed directly into that sheet will be replaced."
        confirmLabel="Rebuild sheet"
        onConfirm={async () => {
          const r = await rebuildSheet(scope);
          if (r.ok) toast.success(r.message);
          else toast.error(r.error);
          router.refresh();
        }}
      >
        <Hammer /> Rebuild
      </ConfirmButton>
    </div>
  );
}
