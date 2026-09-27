// @ts-check
// What the request layer knows about REACHING Cairn beyond a single request, so one
// outage never costs the same read twice:
//   - a GET that just failed because Cairn is out of reach (fetch() itself failed) is
//     remembered for a moment, and a second ask for that path inside the window fails
//     at once instead of going back to the wire (a boot read and a screen read of the
//     same path, a reconnect sweep and the shell's own). Any answer from Cairn clears it;
//   - a fan-in that failed the same way answers each read it primed with that failure,
//     so every member goes straight to its last-known paint (CairnOffline) instead of
//     re-requesting a read that fails too;
//   - index.html's early Today fetch resolves null only when fetch() itself rejected,
//     so that null IS a network failure — never a cue to ask again.
// Pure except for the early-fetch hand-off; api-core.ts wires it to fetch.
type ApiReachMemo = {
  remember(path: string): void;
  // Whether a read of `path` failed out of reach inside the window.
  recent(path: string): boolean;
  clear(): void;
};

{
  // As long as the micro-cache keeps a success (api-cache.ts): long enough to fold the
  // reads of one render burst, short enough that a deliberate "Try again" asks again.
  const API_REACH_WINDOW_MS = 1500;

  // The device regaining a network forgets every failure at once.
  function createReachMemo(opts: { now?: () => number; windowMs?: number } = {}): ApiReachMemo {
    const now = opts.now || Date.now;
    const windowMs = opts.windowMs || API_REACH_WINDOW_MS;
    const failed = new Map<string, number>();
    const clear = () => failed.clear();
    if (typeof window !== "undefined") window.addEventListener("online", clear);
    return {
      remember: (path) => void failed.set(path, now()),
      recent: (path) => now() - (failed.get(path) ?? -Infinity) < windowMs,
      clear,
    };
  }

  // Only a failed fetch() (a CairnApiError of kind "network") counts. A timeout is not
  // proof Cairn is out of reach — one slow read can time out while the link is fine —
  // so it never fails another read; neither does anything Cairn answered.
  function isFetchFailure(error: unknown): boolean {
    return error instanceof CairnApiError && error.kind === "network";
  }

  // Today's paint-critical reads may already be on the wire: index.html starts them
  // before the bundles parse, and CairnTodayPrefetch hands each one over exactly once
  // (a failed one rejects like fetch() did: today-prefetch.ts).
  function takeEarlyResponse(path: string): Promise<Response> | undefined {
    return (globalThis as { CairnTodayPrefetch?: { takeEarly?(p: string): Promise<Response> | undefined } })
      .CairnTodayPrefetch?.takeEarly?.(path);
  }

  const CAIRN_API_REACH = { createReachMemo, isFetchFailure, takeEarlyResponse };
  Object.assign(globalThis, { CairnApiReach: CAIRN_API_REACH });
}
