"use strict";

const CACHE_NAME = "ultron-shell-v3";
const SHELL_URLS = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/speech-voices.js",
  "/favicon.svg",
  "/manifest.webmanifest",
  "/icons/ultron.svg",
  "/icons/ultron-180.png",
  "/icons/ultron-192.png",
  "/icons/ultron-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key.startsWith("ultron-shell-") && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept or cache authenticated APIs, account data, or private files.
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return;
  if (url.pathname === "/world-intelligence" || url.pathname.startsWith("/world-intelligence/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match("/index.html");
        return cached || Response.error();
      })
    );
    return;
  }

  if (!SHELL_URLS.includes(url.pathname)) return;
  event.respondWith(
    fetch(request).then(async response => {
      if (response && response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    }).catch(async () => {
      const cached = await caches.match(request);
      return cached || Response.error();
    })
  );
});
