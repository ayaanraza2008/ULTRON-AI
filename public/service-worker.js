const CACHE_PREFIX = "ultron-core-shell-";
const CACHE_NAME = CACHE_PREFIX + "v1";
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/favicon.svg",
  "/manifest.webmanifest",
  "/icons/icon-180.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];
const SHELL_PATHS = new Set(SHELL_ASSETS);

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL_ASSETS);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Auth, chat, memory, uploads, provider calls, and intelligence traffic must
  // always reach the network. No request or response from these routes is cached.
  const isPrivateApi = url.pathname === "/api" || url.pathname.startsWith("/api/");
  const isWorldIntelligence = url.pathname === "/world-intelligence"
    || url.pathname.startsWith("/world-intelligence/");
  if (isPrivateApi || isWorldIntelligence) return;

  // Use a strict public-asset allowlist; unknown routes are never cached.
  if (!SHELL_PATHS.has(url.pathname)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(url.pathname);
    if (cached) return cached;

    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      await cache.put(url.pathname, response.clone());
    }
    return response;
  })());
});
