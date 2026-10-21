import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PROVIDERS, isProvider } from "@/lib/utilities/providers";
import { getContext } from "@/server/auth";
import { createSupabaseAdmin } from "@/server/supabase/admin";

export const metadata: Metadata = { title: "Bill" };

export default function BillPage({ searchParams }: PageProps<"/bills/view">) {
  return (
    <Suspense fallback={<Skeleton className="h-[70vh] rounded-2xl" />}>
      <Bill searchParams={searchParams} />
    </Suspense>
  );
}

async function Bill({ searchParams }: { searchParams: PageProps<"/bills/view">["searchParams"] }) {
  const { id } = await searchParams;
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await getContext();
  const { data: bill } = await ctx.supabase
    .from("utility_bills")
    .select("id, household_id, bill_month, payable, due_date, snapshot_path, snapshot_mime, source, utility_meters(label, provider)")
    .eq("id", id)
    .maybeSingle();
  if (!bill || bill.household_id !== ctx.householdId) notFound();
  const meter = bill.utility_meters as unknown as { label: string; provider: string };
  const provider = isProvider(meter.provider) ? PROVIDERS[meter.provider] : null;
  const ownPath = bill.snapshot_path?.startsWith(`${ctx.householdId}/`) ? bill.snapshot_path : null;
  const storage = createSupabaseAdmin().storage.from("utility-bills");

  let html: string | null = null;
  let fileUrl: string | null = null;
  if (ownPath && bill.snapshot_mime === "text/html") {
    const { data } = await storage.download(ownPath);
    html = data ? await data.text() : null;
  } else if (ownPath) {
    const { data } = await storage.createSignedUrl(ownPath, 600);
    fileUrl = data?.signedUrl ?? null;
  }
  const month = new Date(`${bill.bill_month}T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="icon" aria-label="Back to bills"><Link href="/bills"><ArrowLeft /></Link></Button>
          <div>
            <h1 className="font-heading text-xl font-bold">{meter.label} · {month}</h1>
            <p className="text-sm text-muted-foreground">
              Rs {Number(bill.payable).toLocaleString("en-US")}
              {bill.due_date ? `, due ${new Date(`${bill.due_date}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}
              {" · "}
              {bill.source === "upload" ? "uploaded copy" : `copy saved from ${provider?.name ?? "the company"}`}
            </p>
          </div>
        </div>
        {provider ? (
          <Button asChild variant="outline" size="sm">
            <a href={provider.siteUrl} target="_blank" rel="noopener noreferrer"><ExternalLink /> Open {provider.name}</a>
          </Button>
        ) : null}
      </div>

      {html ? (
        <div className="@container overflow-hidden rounded-2xl border bg-white">
          <iframe
            title={`${meter.label} bill, ${month}`}
            srcDoc={html}
            sandbox=""
            referrerPolicy="no-referrer"
            className="block h-[1330px] w-full @max-[919px]:h-[1265px] @max-[700px]:h-[985px] @max-[520px]:h-[745px] @max-[420px]:h-[585px]"
          />
        </div>
      ) : fileUrl && bill.snapshot_mime === "application/pdf" ? (
        <div className="space-y-2">
          <iframe title={`${meter.label} bill, ${month}`} src={fileUrl} className="h-[80vh] w-full rounded-2xl border bg-white" />
          <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline-offset-2 hover:underline">Open the PDF</a>
        </div>
      ) : fileUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={fileUrl} alt={`${meter.label} bill, ${month}`} className="mx-auto w-full max-w-3xl rounded-2xl border bg-white" />
      ) : (
        <p className="rounded-xl border bg-muted/40 p-6 text-sm text-muted-foreground">The saved copy of this bill isn&apos;t available.</p>
      )}
      <p className="text-xs text-muted-foreground">Saved bills stay here even after the company replaces them on its site. Pinch to zoom on a phone.</p>
    </div>
  );
}
