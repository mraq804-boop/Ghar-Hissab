"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { Mic, Square } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type Recognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const subscribe = () => () => {};

/** Fills a field from the phone's own speech-to-text. Hidden where the browser has none. */
export function VoiceButton({ onText, lang = "en-IN", className }: { onText: (text: string, final: boolean) => void; lang?: string; className?: string }) {
  const supported = useSyncExternalStore(subscribe, () => recognitionCtor() !== null, () => false);
  const [listening, setListening] = useState(false);
  const active = useRef<Recognition | null>(null);

  if (!supported) return null;

  const toggle = () => {
    if (active.current) {
      active.current.stop();
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = lang;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.continuous = false;
    r.onresult = (e) => {
      const results = Array.from(e.results);
      onText(results.map((x) => x[0].transcript).join(" ").trim(), results.at(-1)?.isFinal ?? false);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") toast.error("Microphone access is off. Allow it for this app in the phone's settings, or type instead.");
      else if (e.error === "network") toast.error("Voice typing needs internet. Type it instead.");
      else if (e.error !== "no-speech" && e.error !== "aborted") toast.error("Couldn't catch that. Try again or type it.");
    };
    r.onend = () => {
      active.current = null;
      setListening(false);
    };
    active.current = r;
    setListening(true);
    r.start();
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={listening ? "Stop listening" : "Say it instead of typing"}
      aria-pressed={listening}
      className={cn(
        "grid size-8 place-items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring",
        listening ? "animate-pulse bg-destructive text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {listening ? <Square className="size-3.5 fill-current" /> : <Mic className="size-4" />}
    </button>
  );
}
