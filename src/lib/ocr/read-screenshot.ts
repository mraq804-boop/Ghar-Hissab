"use client";

import type { Worker } from "tesseract.js";
import { parsePaymentText, type PaymentRead } from "./parse-payment";

let workerPromise: Promise<Worker> | null = null;

function getWorker(onProgress?: (p: number) => void) {
  workerPromise ??= import("tesseract.js").then(({ createWorker, OEM }) =>
    createWorker("eng", OEM.LSTM_ONLY, {
      workerPath: "/tesseract/worker.min.js",
      corePath: "/tesseract/core",
      langPath: "/tesseract/lang",
      workerBlobURL: false,
      logger: (m: { status: string; progress: number }) => {
        if (m.status === "recognizing text") onProgress?.(m.progress);
      },
    }),
  ).catch((e) => {
    workerPromise = null;
    throw e;
  });
  return workerPromise;
}

export const READABLE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * Reads a payment screenshot on this device. Nothing is uploaded for the reading.
 * Returns null when the image can't be read; callers fall back to manual entry.
 */
export async function readPaymentScreenshot(image: Blob, onProgress?: (p: number) => void): Promise<PaymentRead | null> {
  const text = await readImageText(image, onProgress);
  return text === null ? null : parsePaymentText(text);
}

/** Returns the text in an image, read on this device, or null when it can't be read. */
export async function readImageText(image: Blob, onProgress?: (p: number) => void): Promise<string | null> {
  if (!READABLE_TYPES.includes(image.type)) return null;
  try {
    const worker = await getWorker(onProgress);
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), 45_000));
    const result = await Promise.race([worker.recognize(image), timeout]);
    return result ? result.data.text : null;
  } catch (e) {
    console.warn("Screenshot reading failed", e);
    return null;
  }
}
