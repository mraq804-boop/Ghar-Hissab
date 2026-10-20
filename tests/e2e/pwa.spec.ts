import { expect, test } from "@playwright/test";

test("the web app manifest is installable", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m).toMatchObject({ name: "Ghar Hisaab", display: "standalone", start_url: "/dashboard" });
  expect(m.icons.some((i: { sizes: string; purpose: string }) => i.sizes === "512x512" && i.purpose === "maskable")).toBe(true);
  for (const icon of m.icons) {
    const img = await request.get(icon.src);
    expect(img.headers()["content-type"]).toBe("image/png");
  }
});

test("the service worker never caches itself", async ({ request }) => {
  const res = await request.get("/sw.js");
  expect(res.headers()["cache-control"]).toContain("no-store");
  expect(res.headers()["content-type"]).toContain("javascript");
});

test("offline navigation shows the offline screen, not a browser error", async ({ page, context }) => {
  await page.goto("/login");
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return reg?.active?.state === "activated";
  }, undefined, { timeout: 20_000 });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await context.setOffline(true);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await context.setOffline(false);
});

test("signed-in pages are never stored in the service worker cache", async ({ page }) => {
  await page.goto("/login");
  await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === "activated", undefined, { timeout: 20_000 });
  const before = page.url();
  await page.waitForTimeout(500);
  expect(page.url()).toBe(before);
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      for (const req of await (await caches.open(name)).keys()) urls.push(new URL(req.url).pathname);
    }
    return urls;
  });
  expect(cached).toContain("/offline");
  for (const path of cached) {
    expect(path === "/offline" || path === "/manifest.webmanifest" || path.startsWith("/icons/") || path.startsWith("/_next/static/")).toBe(true);
  }
});
