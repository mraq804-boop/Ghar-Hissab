"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { ArrowUp, Loader2, Mic, ShieldAlert, Sparkles, Square, Volume2, VolumeX, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { downsample, encodeWav, speakable, SPEECH_RATE, toMono } from "@/lib/audio/wav";
import { askQuestion, transcribeQuestion } from "./actions";

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
  { label: "Chicken rate today", question: "What is the official Lahore chicken rate today, and how does it compare with what we paid? Also the official mutton rate." },
  { label: "Sabzi rates today", question: "What are the official Lahore sabzi rates today for tomato, onion, potato and the sabzi we usually buy?" },
  { label: "Meat rates", question: "What rate per kg did we pay recently for chicken, meat, fish and sabzi? Did any rate go up?" },
  { label: "Rest of month", question: "How much more money do we need for the rest of this month: kitchen from the menu and the bills still to come? Is the purse enough?" },
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

const noop = () => () => {};
const canRecord = () => typeof window !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined";
const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;

async function toWav(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext();
  try {
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
    return new Blob([encodeWav(downsample(toMono(channels), audio.sampleRate), Math.min(audio.sampleRate, SPEECH_RATE))], { type: "audio/wav" });
  } finally {
    void ctx.close();
  }
}

function speak(text: string, onEnd: () => void) {
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(speakable(text));
  const urdu = /[\u0600-\u06FF]/.test(text);
  const voices = synth.getVoices();
  const voice = urdu ? voices.find((v) => v.lang.startsWith("ur")) : (voices.find((v) => v.lang === "en-IN") ?? voices.find((v) => v.lang.startsWith("en")));
  if (voice) u.voice = voice;
  u.lang = voice?.lang ?? (urdu ? "ur-PK" : "en-IN");
  u.onend = onEnd;
  u.onerror = onEnd;
  synth.speak(u);
}

export function ChatBoard({ compact = false }: { compact?: boolean }) {
  const recordable = useSyncExternalStore(noop, canRecord, () => false);
  const canListen = useSyncExternalStore(noop, canSpeak, () => false);
  const [voice, setVoice] = useState<"idle" | "recording" | "hearing">("idle");
  const [speaking, setSpeaking] = useState<number | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, pending]);

  useEffect(
    () => () => {
      if (canSpeak()) window.speechSynthesis.cancel();
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const readAloud = (i: number, text: string) => {
    if (speaking === i) {
      window.speechSynthesis.cancel();
      setSpeaking(null);
      return;
    }
    setSpeaking(i);
    speak(text, () => setSpeaking((s) => (s === i ? null : s)));
  };

  const send = (question: string, spoken = false) => {
    const q = question.trim();
    if (!q || pending) return;
    const next: Turn[] = [...turns, { role: "user", text: q }];
    setTurns(next);
    setDraft("");
    setError(null);
    start(async () => {
      const r = await askQuestion(next.slice(-11));
      if (r.ok) {
        setTurns((t) => [...t, { role: "assistant", text: r.data.answer }]);
        if (spoken && canSpeak()) readAloud(next.length, r.data.answer);
      }
      else {
        setError(r.error);
        setTurns((t) => t.slice(0, -1));
        setDraft(q);
      }
    });
  };

  const stopRecording = () => {
    if (timer.current) clearTimeout(timer.current);
    if (recorder.current?.state === "recording") recorder.current.stop();
  };

  const startRecording = async () => {
    if (canSpeak()) window.speechSynthesis.cancel();
    setSpeaking(null);
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch {
      setError("The microphone is blocked. Allow microphone access for this site in the browser settings, then try again.");
      return;
    }
    const rec = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      recorder.current = null;
      setVoice("hearing");
      try {
        const form = new FormData();
        form.set("audio", await toWav(new Blob(chunks, { type: rec.mimeType })));
        const r = await transcribeQuestion(form);
        if (r.ok) send(r.data.text, true);
        else setError(r.error);
      } catch {
        setError("That recording couldn't be read. Try again or type the question.");
      } finally {
        setVoice("idle");
      }
    };
    recorder.current = rec;
    rec.start();
    setVoice("recording");
    timer.current = setTimeout(stopRecording, 30_000);
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
              {t.role === "user" ? (
                <p className="whitespace-pre-wrap">{t.text}</p>
              ) : (
                <>
                  <Answer text={t.text} />
                  {canListen ? (
                    <button
                      type="button"
                      onClick={() => readAloud(i, t.text)}
                      className="mt-2 -ml-1 flex items-center gap-1.5 rounded-md px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      {speaking === i ? <><VolumeX className="size-3.5" /> Stop</> : <><Volume2 className="size-3.5" /> Listen</>}
                    </button>
                  ) : null}
                </>
              )}
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
          placeholder={voice === "recording" ? "Listening… tap stop when done" : voice === "hearing" ? "Hearing your question…" : "e.g. Doodh pe is mahine kitna kharch hua?"}
          disabled={voice !== "idle"}
          className="max-h-40 min-h-11 resize-none border-0 shadow-none focus-visible:ring-0"
        />
        {recordable ? (
          <Button
            type="button"
            size="icon"
            variant={voice === "recording" ? "destructive" : "outline"}
            className={cn("size-11 shrink-0 rounded-xl", voice === "recording" && "animate-pulse")}
            disabled={pending || voice === "hearing"}
            onClick={voice === "recording" ? stopRecording : startRecording}
            aria-label={voice === "recording" ? "Stop recording" : "Ask by voice"}
            title={voice === "recording" ? "Stop" : "Speak your question"}
          >
            {voice === "hearing" ? <Loader2 className="animate-spin" /> : voice === "recording" ? <Square /> : <Mic />}
          </Button>
        ) : null}
        <Button type="submit" size="icon" className="size-11 shrink-0 rounded-xl" disabled={pending || !draft.trim()} aria-label="Ask">
          {pending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
        </Button>
      </form>
      </div>
    </div>
  );
}
