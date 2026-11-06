"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowUp, Loader2, ShieldAlert, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { askQuestion } from "./actions";

type Turn = { role: "user" | "assistant"; text: string };

const SUGGESTIONS = [
  "How much did we spend on chicken and meat this month?",
  "AK ne is mahine kitna diya aur kitna baqi hai?",
  "What was our biggest expense this month?",
  "Which bills are not entered yet?",
  "Compare this month with last month",
];

const QUICK = [
  { label: "Purse balance", question: "How much money is left in the purse right now?" },
  { label: "Collected", question: "How much has been collected into the purse this month, and from whom?" },
  { label: "Who owes", question: "Who still has to pay, and how much does each household owe?" },
  { label: "Spent this month", question: "How much have we spent this month in total, by category?" },
  { label: "Bills due", question: "Which bills are due or not entered yet?" },
  { label: "Meat & sabzi", question: "How much did we spend on chicken, meat, fish and sabzi this month?" },
  { label: "Next week shopping", question: "What do we need to buy on Sunday for next week (meat, chicken, fish and sabzi), and what is on the menu?" },
  { label: "Meat rates", question: "What rate per kg did we pay recently for chicken, meat, fish and sabzi? Did any rate go up?" },
  { label: "Vs last month", question: "Compare this month with last month" },
];

function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return <>{parts.map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>))}</>;
}

function Answer({ text }: { text: string }) {
  const blocks: { list: boolean; lines: string[] }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+/.test(line);
    const last = blocks.at(-1);
    if (!line.trim()) {
      blocks.push({ list: false, lines: [] });
      continue;
    }
    const clean = bullet ? line.replace(/^\s*[-*•]\s+/, "") : line;
    if (last && last.list === bullet && (bullet || last.lines.length)) last.lines.push(clean);
    else blocks.push({ list: bullet, lines: [clean] });
  }
  return (
    <div className="space-y-2">
      {blocks.filter((b) => b.lines.length).map((b, i) =>
        b.list ? (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {b.lines.map((l, j) => <li key={j}><Inline text={l} /></li>)}
          </ul>
        ) : (
          <p key={i}>{b.lines.map((l, j) => <span key={j} className="block"><Inline text={l} /></span>)}</p>
        ),
      )}
    </div>
  );
}

export function ChatBoard({ compact = false }: { compact?: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, pending]);

  const send = (question: string) => {
    const q = question.trim();
    if (!q || pending) return;
    const next: Turn[] = [...turns, { role: "user", text: q }];
    setTurns(next);
    setDraft("");
    setError(null);
    start(async () => {
      const r = await askQuestion(next.slice(-11));
      if (r.ok) setTurns((t) => [...t, { role: "assistant", text: r.data.answer }]);
      else {
        setError(r.error);
        setTurns((t) => t.slice(0, -1));
        setDraft(q);
      }
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      {compact ? (
        <p className="flex gap-2 text-xs text-muted-foreground">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Answered by Google Gemini from the household&apos;s figures (codes only, no names). Answers can be wrong, so check important numbers.{" "}
            <Link href="/ask" className="underline underline-offset-2">More</Link>
          </span>
        </p>
      ) : (
        <p className="flex gap-2 rounded-xl border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs text-warning">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            Questions are answered by Google Gemini (free). Each question sends this household&apos;s figures, and your own personal spending (amounts and categories, no notes), to Google using household codes
            only: no names, phone numbers, notes or transaction IDs. Google may keep and review free-tier questions. Answers can be wrong, so
            check important numbers in the app.
          </span>
        </p>
      )}

      {turns.length === 0 && !compact ? (
        <div className="rounded-2xl border bg-card p-5">
          <p className="flex items-center gap-2 font-heading text-lg font-semibold"><Sparkles className="size-5 text-haldi" /> Ask about the household money</p>
          <p className="mt-1 text-sm text-muted-foreground">English, Roman Urdu or Urdu. Try one of these:</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => send(s)} className="rounded-full border px-3 py-1.5 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <ol className="space-y-3" aria-live="polite">
        {turns.map((t, i) => (
          <li key={i} className={cn("flex", t.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[88%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                t.role === "user" ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm border bg-card",
              )}
            >
              {t.role === "user" ? <p className="whitespace-pre-wrap">{t.text}</p> : <Answer text={t.text} />}
            </div>
          </li>
        ))}
        {pending ? (
          <li className="flex justify-start">
            <p role="status" className="flex items-center gap-2 rounded-2xl rounded-bl-sm border bg-card px-4 py-2.5 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Working it out…
            </p>
          </li>
        ) : null}
      </ol>
      <div ref={end} />

      {error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-danger-soft px-3 py-2 text-sm text-destructive">{error}</p> : null}

      <div className={cn("sticky space-y-2 bg-background/95 pt-1 backdrop-blur", compact ? "bottom-0 pb-2" : "bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-4")}>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]" role="group" aria-label="Quick questions">
        {QUICK.map((q) => (
          <button
            key={q.label}
            type="button"
            onClick={() => send(q.question)}
            disabled={pending}
            title={q.question}
            className="flex shrink-0 items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-sm whitespace-nowrap hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
          >
            <Zap className="size-3.5 text-haldi" /> {q.label}
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
        className="flex items-end gap-2 rounded-2xl border bg-background p-2 shadow-sm"
      >
        <label htmlFor="question" className="sr-only">Your question</label>
        <Textarea
          id="question"
          rows={1}
          maxLength={500}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
          placeholder="e.g. Doodh pe is mahine kitna kharch hua?"
          className="max-h-40 min-h-11 resize-none border-0 shadow-none focus-visible:ring-0"
        />
        <Button type="submit" size="icon" className="size-11 shrink-0 rounded-xl" disabled={pending || !draft.trim()} aria-label="Ask">
          {pending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
        </Button>
      </form>
      </div>
    </div>
  );
}
