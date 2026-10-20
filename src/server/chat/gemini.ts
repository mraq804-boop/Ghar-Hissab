import "server-only";

export type ChatTurn = { role: "user" | "assistant"; text: string };

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

export function geminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
};

export class ChatError extends Error {}

/** Sends the conversation to Gemini's generateContent endpoint and returns the reply text. */
export async function askGemini(system: string, turns: ChatTurn[], fetchImpl: typeof fetch = fetch): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new ChatError("Chat isn't set up yet. The administrator needs to add a Gemini key.");
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;

  let res: Response;
  try {
    res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: turns.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.text }] })),
        generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
      }),
      signal: AbortSignal.timeout(45_000),
      cache: "no-store",
    });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") throw new ChatError("Gemini is taking too long to answer right now. Try again in a moment.");
    throw new ChatError("Couldn't reach Gemini. Check the internet connection and try again.");
  }

  const body = (await res.json().catch(() => ({}))) as GeminiResponse;
  if (!res.ok) {
    if (res.status === 429) throw new ChatError("The free Gemini limit is used up for now. Try again in a minute, or tomorrow if it keeps happening.");
    if (res.status === 400 && /api key/i.test(body.error?.message ?? "")) throw new ChatError("The Gemini key isn't valid. The administrator needs to check it.");
    if (res.status === 401 || res.status === 403) throw new ChatError("Gemini refused the key. The administrator needs to check it.");
    if (res.status === 404) throw new ChatError(`The Gemini model "${model}" isn't available. The administrator can set GEMINI_MODEL to a current model.`);
    throw new ChatError("Gemini couldn't answer right now. Try again shortly.");
  }
  if (body.promptFeedback?.blockReason) throw new ChatError("Gemini declined to answer that question. Try asking it differently.");
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
  if (!text) throw new ChatError("Gemini returned an empty answer. Try asking it differently.");
  return text;
}
