// The cache version is DERIVED, never hand-bumped. src/swVersion.ts hashes the
// bytes of every asset listed in CORE_ASSETS + OPTIONAL_ASSETS below (plus this
// file), and the server rewrites this literal to `cairn-<hash>` when it serves
// /sw.js. So any change to a precached asset ships a new cache name by
// construction, and an unchanged shell keeps the name it had.
//
// The literal below is the fallback for anything reading this file straight off
// disk (a dev static server, an offline checkout). Keep it EXACTLY as written —
// scripts/check-sw-cache.mjs asserts the placeholder is present, and the server
// substitutes it by exact match.
const CACHE = "cairn-shell-dev";
// Generated artwork lives in its own cache: the images are content-keyed and
// immutable on the server, so they stay valid across app deploys. Keeping them
// out of the versioned CACHE (and off the activate-cleanup list) means a deploy
// never re-downloads them — a slick, instant paint on every open.
const ART_CACHE = "cairn-art-v1";
const CORE_ASSETS = [
  "/", "/index.html", "/styles.css",
  "/js/bundle-01-core.js", "/js/bundle-02-today.js", "/js/bundle-03-capture-progress.js", "/js/bundle-04-coach-meals.js", "/js/bundle-05-me-health.js", "/js/bundle-06-chat-plan.js", "/js/bundle-07-settings-boot.js",
  "/art.js", "/cairn-body-figure.js", "/manifest.json",
  // Self-hosted Atelier v2 faces (src/styles/foundation/fonts.css). Core, not
  // optional: an installed app offline must still set its own type.
  "/fonts/young-serif-latin-400.woff2", "/fonts/hanken-grotesk-latin-wght.woff2",
  "/fonts/martian-mono-latin-400.woff2", "/fonts/martian-mono-latin-500.woff2",
];
const OPTIONAL_ASSETS = [
  // Vendored xterm.js for the in-app agent-login terminal (lazy-loaded by the
  // Settings → Agents "Connect" modal; precached so it also works offline-installed).
  "/vendor/xterm.js", "/vendor/xterm.css", "/vendor/xterm-addon-fit.js",
  "/favicon.ico",
  // Versioned icon set (…vN). Never hand-edit the suffix: `node scripts/bump-icons.mjs`
  // moves every icon url (here, manifest.json, index.html) to the next .vN at once,
  // so the new urls bust every cache layer and test/pwaInstallIdentity.test.js agrees.
  "/icons/icon.v4.svg", "/icons/apple-touch-icon.v4.png", "/icons/mask-icon.v4.svg",
  "/icons/favicon-16.v4.png", "/icons/favicon-32.v4.png",
  "/icons/icon-192.v4.png", "/icons/icon-512.v4.png",
  "/icons/icon-192-maskable.v4.png", "/icons/icon-512-maskable.v4.png",
  "/icons/og.v4.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    // Bypass the HTTP cache on install: a browser-cached (not just service-worker
    // cached) response for these urls would otherwise defeat the whole point of
    // fetching fresh precache bytes on every version bump.
    await c.addAll(CORE_ASSETS.map((u) => new Request(u, { cache: "reload" })));
    await Promise.all(OPTIONAL_ASSETS.map((asset) => c.add(new Request(asset, { cache: "reload" })).catch(() => null)));
  }));
  // Single-user self-hosted app: a deploy should always be live on the next open,
  // never stranded behind a manual tap (which is how a client once fell ~40 cache
  // versions behind). Activate the new worker immediately; the page reloads itself
  // once on controllerchange (app shell), and chat drafts + in-flight turns persist so
  // the reload loses nothing.
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      // Drop stale app caches, but PRESERVE the art cache — its images are
      // immutable and expensive to regenerate, so they outlive a version bump.
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== ART_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Generated art: cache-first in the persistent ART_CACHE, keyed by the full
// request URL (so `v=` is part of the identity). Only 200s are cached — a 204
// (not generated yet) stays uncached so the next try can pick the image up.
// `&r=1` is just another URL; a 200 for it WOULD be cached. Prefer `v=` for
// busting. When a 200 for v=N lands, older v<N entries for the same kind+q
// are evicted so the art cache does not grow unbounded.
//
// Eviction helpers are mirrored from src/artCachePolicy.ts (classic SW cannot
// import that module). Keep them in sync.
function artCacheIdentity(url) {
  try {
    const parsed = new URL(url, "http://cairn.local");
    if (parsed.pathname !== "/api/art") return null;
    const kind = parsed.searchParams.get("kind") || "";
    const q = parsed.searchParams.get("q") || "";
    if (!kind || !q) return null;
    const raw = parsed.searchParams.get("v");
    const v = raw == null || raw === "" ? 0 : Number(raw);
    return { kind, q, v: Number.isFinite(v) && v > 0 ? v : 0 };
  } catch {
    return null;
  }
}
function shouldEvictCachedArt(cachedUrl, incomingUrl) {
  const incoming = artCacheIdentity(incomingUrl);
  const cached = artCacheIdentity(cachedUrl);
  if (!incoming || !cached) return false;
  if (incoming.kind !== cached.kind || incoming.q !== cached.q) return false;
  return cached.v < incoming.v;
}
async function artCacheFirst(request) {
  const cache = await caches.open(ART_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (res && res.status === 200) {
      cache.put(request, res.clone()).catch(() => {});
      cache.keys().then((keys) => {
        for (const req of keys) {
          if (shouldEvictCachedArt(req.url, request.url)) cache.delete(req);
        }
      }).catch(() => {});
    }
    return res;
  } catch {
    // Offline + uncached → surface an error so the <img> onerror keeps the SVG.
    return Response.error();
  }
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === "GET" && url.pathname === "/api/art") {
    e.respondWith(artCacheFirst(e.request));
    return;
  }
  // Never cache the rest of API or MCP — always hit network.
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/mcp")) return;
  if (e.request.mode === "navigate") {
    // Cache-FIRST for the app shell. The installed PWA opens over a tailnet that
    // may be asleep or flapping, and a network-first navigation blocks on fetch("/")
    // until the OS gives up — tens of seconds of white screen before the identical
    // cached shell would have been served. The precached /index.html is the same
    // bytes the network would return for this CACHE version, so waiting buys nothing.
    //
    // A deploy still lands on the next open, one layer up: the browser re-fetches
    // sw.js itself (never from this handler — sw.js is served no-cache and the
    // registration.update() in app/sw-recovery.ts runs on resume), the new worker
    // precaches the new shell and skipWaiting()s, clients.claim() fires
    // controllerchange, and the page reloads once. THAT reload is a navigation
    // answered from the NEW cache. So the shell is always instant and never stale
    // by more than the one reload the update flow already performs.
    e.respondWith(caches.match("/index.html").then((r) => r || fetch(e.request)));
    return;
  }
  // The manifest is NETWORK-first (cache fallback). An installed app's launch-time
  // manifest check is how Chrome notices a new icon, name or theme_color, and a
  // cache-first answer would hand it the precached copy forever. The precached copy
  // stays the offline fallback, and a bounded wait keeps a sleeping tailnet from
  // holding the check open.
  if (url.pathname === "/manifest.json") {
    e.respondWith(manifestNetworkFirst(e.request));
    return;
  }
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});

const MANIFEST_NETWORK_WAIT_MS = 4000;
async function manifestNetworkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([
      fetch(request, { cache: "no-cache" }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("manifest timeout")), MANIFEST_NETWORK_WAIT_MS)),
    ]);
    if (res && res.ok) {
      cache.put("/manifest.json", res.clone()).catch(() => {});
      return res;
    }
    const cached = await cache.match("/manifest.json");
    return cached || res;
  } catch {
    const cached = await cache.match("/manifest.json");
    return cached || Response.error();
  }
}
// Legacy compatibility: the app now calls skipWaiting at install and reloads once
// on controllerchange, but older open pages may still send this message.
self.addEventListener("message", (e) => {
  if (e.data === "skipWaiting" || (e.data && e.data.type === "skipWaiting")) self.skipWaiting();
  // Settings asks which shell this worker serves, so a deploy can be checked
  // against /api/health's `shell` (both are the derived cache name).
  if (e.data && e.data.type === "cairn-shell" && e.ports && e.ports[0]) e.ports[0].postMessage({ shell: CACHE });
});
