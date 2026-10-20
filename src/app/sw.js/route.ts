const VERSION = process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "local";

const SOURCE = String.raw`
const VERSION = ${JSON.stringify(VERSION)};
const STATIC_CACHE = "gh-static-" + VERSION;
const SHELL_CACHE = "gh-shell-" + VERSION;
const OCR_CACHE = "gh-ocr-v1";
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/icons/192", "/icons/512", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      await shell.addAll(PRECACHE);
      const html = await (await shell.match(OFFLINE_URL)).text();
      const assets = [...new Set(html.match(/\/_next\/static\/[^"'\s)<>]+/g) ?? [])];
      const stat = await caches.open(STATIC_CACHE);
      await Promise.all(assets.map((a) => stat.add(a).catch(() => undefined)));
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC_CACHE && k !== SHELL_CACHE && k !== OCR_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // The on-device screenshot reader is large and rarely changes: keep it across deployments.
  if (url.pathname.startsWith("/tesseract/")) {
    event.respondWith(
      caches.open(OCR_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // Hashed build assets never change, so cache-first is safe and fast.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // Pages carry private financial data: always from the network, never cached.
  // When the network is unreachable, show the offline screen instead of the browser error.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(async () => (await caches.match(OFFLINE_URL)) ?? new Response("Offline", { status: 503 })),
    );
  }
});
`;

export function GET() {
  return new Response(SOURCE, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-cache, no-store, must-revalidate",
      "service-worker-allowed": "/",
    },
  });
}
