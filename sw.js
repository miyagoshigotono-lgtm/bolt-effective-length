"use strict";
importScripts("./js/site-assets.js");
const SCOPE = self.registration.scope;
const PREFIX = "wood-calculators:" + new URL(SCOPE).pathname + ":";
const CACHE = PREFIX + "20261030-1";
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(self.WOOD_CALCULATOR_ASSETS.map((file) => new Request(new URL(file, SCOPE), { cache: "reload" })));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // 同じドメインの別アプリのキャッシュには触れない。
    await Promise.all(keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || !request.url.startsWith(SCOPE)) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(new Request(request, { cache: "no-cache" }));
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
      }
      return response;
    } catch {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      const url = new URL(request.url);
      if (request.mode === "navigate" && url.pathname === new URL(SCOPE).pathname) {
        const home = await cache.match(new URL("index.html", SCOPE).href);
        if (home) return home;
      }
      return new Response("オフラインではこのファイルを開けません。", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
  })());
});
