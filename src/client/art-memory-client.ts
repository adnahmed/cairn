// @ts-check
// What this device remembers about generated art between renders and reloads:
// exercise art VERSIONS and recent MISSES (art-controller.ts renders from both).
//
// Versions (`GET /api/art/state`'s `versions`): the image URL carries `v=` so a
// redraw / pose-aware replace busts the SW cache. PERSISTED (localStorage) and read
// back synchronously at load, so the first render after a cold start already asks
// for `…&v=N` — a map that only arrived after the first paint used to draw every
// redrawn figure twice (v-less, then v=N). The server is the truth for every token
// it lists — a version CAN go backwards (`npm run reset`, a backup restore, a
// re-created art_index row), and keeping a remembered higher one would pin the
// pre-restore image the SW art cache still holds under that URL. A token the
// server's capped list no longer carries keeps its known version.
//
// Misses: tokens whose image the server just answered "not drawn yet" (204). A
// re-render inside the short quiet window keeps the SVG instead of asking again for
// the same miss. Tab-scoped (sessionStorage): the second ask is usually the
// re-render of a reloaded page — a warm peek paint, then the network repaint. The
// window is short on purpose: a 204 enqueues the drawing, and a figure drawn since
// must not stay hidden for long. A failure while the device is offline is not a
// miss at all.

type ArtMemoryApi = {
  version(token: string): number;
  setVersion(token: string, version: number): void;
  mergeVersions(versions: Record<string, unknown> | null | undefined): void;
  missedRecently(token: string): boolean;
  recordMiss(token: string): void;
  forgetMiss(token: string): void;
};

{
  const VERSIONS_LS = "cairn-art-versions";
  const MISS_SS = "cairn-art-miss";
  const MISS_QUIET_MS = 30 * 1000;
  const versions = new Map<string, number>();
  const misses = new Map<string, number>();
  let versionsTimer: ReturnType<typeof setTimeout> | number = 0;

  function persistVersions(): void {
    clearTimeout(versionsTimer);
    versionsTimer = setTimeout(() => {
      try {
        localStorage.setItem(VERSIONS_LS, JSON.stringify(Object.fromEntries([...versions].slice(-3000))));
      } catch {}
    }, 600);
  }

  function persistMisses(): void {
    try {
      const now = Date.now();
      const live = [...misses].filter(([, at]) => now - at < MISS_QUIET_MS).slice(-500);
      sessionStorage.setItem(MISS_SS, JSON.stringify(Object.fromEntries(live)));
    } catch {}
  }

  function readRecord(read: () => string | null): Record<string, unknown> {
    try {
      const stored: unknown = JSON.parse(read() || "{}");
      return stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  for (const [token, value] of Object.entries(readRecord(() => localStorage.getItem(VERSIONS_LS)))) {
    const n = Number(value);
    if (token && Number.isFinite(n) && n > 0) versions.set(token, n);
  }
  for (const [token, at] of Object.entries(readRecord(() => sessionStorage.getItem(MISS_SS)))) {
    const n = Number(at);
    if (token && Number.isFinite(n) && Date.now() - n < MISS_QUIET_MS) misses.set(token, n);
  }

  function version(token: string): number {
    return versions.get(token) || 0;
  }

  function setVersion(token: string, value: number): void {
    if (!token || !Number.isFinite(value) || value <= 0) return;
    versions.set(token, value);
    persistVersions();
  }

  function mergeVersions(incoming: Record<string, unknown> | null | undefined): void {
    if (!incoming || typeof incoming !== "object") return;
    let changed = false;
    for (const [token, value] of Object.entries(incoming)) {
      const n = Number(value);
      if (!token || !Number.isFinite(n) || n <= 0 || version(token) === n) continue;
      versions.set(token, n);
      changed = true;
    }
    if (changed) persistVersions();
  }

  function missedRecently(token: string): boolean {
    const at = misses.get(token);
    return at != null && Date.now() - at < MISS_QUIET_MS;
  }

  function recordMiss(token: string): void {
    if (!token) return;
    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return; // offline, not "not drawn"
    } catch {}
    misses.set(token, Date.now());
    persistMisses();
  }

  function forgetMiss(token: string): void {
    if (misses.delete(token)) persistMisses();
  }

  const CAIRN_ART_MEMORY: ArtMemoryApi = { version, setVersion, mergeVersions, missedRecently, recordMiss, forgetMiss };
  Object.assign(globalThis, { CairnArtMemory: CAIRN_ART_MEMORY });
}
