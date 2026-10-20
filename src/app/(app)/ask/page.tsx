import type { Metadata } from "next";
import { Suspense } from "react";
import { MessagesSquare } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageHeader } from "@/components/ledger/page-header";
import { getContext, isAdmin } from "@/server/auth";
import { geminiConfigured } from "@/server/chat/gemini";
import { ChatBoard } from "./chat-board";

export const metadata: Metadata = { title: "Ask" };

export default function AskPage() {
  return (
    <Suspense fallback={<div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-48 rounded-2xl" /></div>}>
      <Ask />
    </Suspense>
  );
}

async function Ask() {
  const ctx = await getContext();
  return (
    <div className="space-y-6">
      <PageHeader title="Ask" description="Questions about spending, shares and payments, answered from the family's own records." />
      {geminiConfigured() ? (
        <ChatBoard />
      ) : (
        <EmptyState icon={MessagesSquare} title="Chat isn't switched on yet">
          {isAdmin(ctx) ? (
            <>
              Create a free key at Google AI Studio (aistudio.google.com, then &quot;Get API key&quot;). Add it as{" "}
              <code className="rounded bg-muted px-1">GEMINI_API_KEY</code> in .env.local and in Vercel&apos;s Environment Variables, then redeploy.
            </>
          ) : (
            "The family administrator hasn't turned on chat."
          )}
        </EmptyState>
      )}
    </div>
  );
}
