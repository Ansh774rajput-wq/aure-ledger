const CACHE_NAME = "aure-ledger-shell-v1";
const STATIC_ASSETS = [
  "/offline.html",
  "/manifest.json",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        }),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Pass through non-GET requests immediately (POST, PUT, DELETE)
  if (event.request.method !== "GET") {
    return;
  }

  // 1. CRITICAL FINANCIAL GUARD: Strict Network-Only for all API routes.
  // Financial queries, commands, statements, and reconciliation must NEVER be cached or served offline.
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // 2. Navigation requests: Network-first, fallback to /offline.html on network failure
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match("/offline.html");
        return cached || new Response("Offline. Live connection required.", { status: 503, headers: { "Content-Type": "text/plain" } });
      }),
    );
    return;
  }

  // 3. Static assets: Cache-first, fallback to network
  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request)),
    );
    return;
  }

  // Default: Network
  event.respondWith(fetch(event.request));
});
