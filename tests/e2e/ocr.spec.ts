import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { parsePaymentText } from "../../src/lib/ocr/parse-payment";

const tesseractLib = join(process.cwd(), "node_modules", "tesseract.js", "dist", "tesseract.min.js");

const RECEIPT = `
<div style="width:360px;padding:28px;font-family:Arial,sans-serif;background:#fff;color:#111">
  <div style="font-size:22px;font-weight:700;color:#c8102e">JazzCash</div>
  <div style="margin-top:14px;font-size:16px">Transaction Successful</div>
  <div style="margin-top:10px;font-size:30px;font-weight:700">Rs. 8,730.00</div>
  <div style="margin-top:14px;font-size:15px">Sent to Abdul Qadeer</div>
  <div style="margin-top:8px;font-size:15px">TID: 038412759301</div>
  <div style="margin-top:8px;font-size:15px">19 Oct 2026, 10:15 AM</div>
  <div style="margin-top:8px;font-size:15px">Fee Rs. 0.00</div>
</div>`;

test.describe.configure({ timeout: 120_000 });

test("reads a payment screenshot on the device using only the app's own files", async ({ page, browser }) => {
  const shotPage = await browser.newPage({ deviceScaleFactor: 2 });
  await shotPage.setContent(`<body style="margin:0;background:#fff">${RECEIPT}</body>`);
  const png = await shotPage.locator("div").first().screenshot();
  await shotPage.close();

  const appHost = new URL(test.info().project.use.baseURL ?? "http://localhost:3100").host;
  const external: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("data:") && new URL(r.url()).host !== appHost) external.push(r.url());
  });

  await page.goto("/offline");
  await page.addScriptTag({ path: tesseractLib });
  const text = await page.evaluate(async (b64) => {
    const T = (window as unknown as { Tesseract: { createWorker: (...a: unknown[]) => Promise<{ recognize: (img: string) => Promise<{ data: { text: string } }>; terminate: () => Promise<void> }> } }).Tesseract;
    const worker = await T.createWorker("eng", 1, {
      workerPath: "/tesseract/worker.min.js",
      corePath: "/tesseract/core",
      langPath: "/tesseract/lang",
      workerBlobURL: false,
    });
    const { data } = await worker.recognize(`data:image/png;base64,${b64}`);
    await worker.terminate();
    return data.text;
  }, png.toString("base64"));

  expect(parsePaymentText(text)).toEqual({ amount: "8730.00", paidOn: "2026-10-19", reference: "038412759301", method: "jazzcash" });
  expect(external).toEqual([]);
});
