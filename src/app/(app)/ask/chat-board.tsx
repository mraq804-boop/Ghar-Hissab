"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowUp, Loader2, ShieldAlert, Sparkles } from "lucide-react";
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

export function ChatBoard() {
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
      <p className="flex gap-2 rounded-xl border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs text-warning">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
        <span>
          Questions are answered by Google Gemini (free). Each question sends this household&apos;s figures, and your own personal spending (amounts and categories, no notes), to Google using household codes
          only: no names, phone numbers, notes or transaction IDs. Google may keep and review free-tier questions. Answers can be wrong, so
          check important numbers in the app.
        </span>
      </p>

      {turns.length === 0 ? (
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

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
        className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] flex items-end gap-2 rounded-2xl border bg-background p-2 shadow-sm md:bottom-4"
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
  );
}
