// @ts-check
// The Train overview's last-known read: the in-memory copy plus its session and
// local storage twins, so the overview paints instantly on re-entry and on a cold
// app launch, then revalidates (progress-overview-client.ts).
//
// Unlike the plain SWR cache (which keeps health-prefixed keys memory/session-only,
// see swr-cache.ts), this is training/muscle-balance data, not health-sensitive
// lab/recovery data — so it is persisted to localStorage too, the way the Brief is.
//
// A write that feeds the overview (a logged set, a finished session, a plan change)
// clears all three copies through write-invalidation-client.ts ("@train"), so the
// next paint waits for the post-write truth instead of flashing the pre-write read.

type TrainSnapshotApi = {
  KEY: string;
  load(): unknown;
  save(data: unknown): void;
  clear(): void;
};

{
  const KEY = "cairn.train.v1";
  // Above this, skip the localStorage copy — a pathological payload shouldn't hog
  // a disproportionate share of the ~5MB quota shared with every other persisted
  // key (the sessionStorage copy has no such ceiling; it's tab-scoped).
  const MAX_LOCAL_BYTES = 200_000;
  let memory: unknown = null;

  function save(data: unknown): void {
    memory = data;
    let json: string;
    try {
      json = JSON.stringify(data);
    } catch {
      return;
    }
    try {
      sessionStorage.setItem(KEY, json);
    } catch {}
    if (json.length > MAX_LOCAL_BYTES) return;
    try {
      localStorage.setItem(KEY, json);
    } catch {}
  }

  // Memory first, then sessionStorage (this tab's own last paint, freshest when
  // present), then localStorage (the cold-launch fallback).
  function load(): unknown {
    if (memory) return memory;
    try {
      const raw = sessionStorage.getItem(KEY) || localStorage.getItem(KEY) || "null";
      const parsed: unknown = JSON.parse(raw);
      memory = parsed && typeof parsed === "object" && "balance" in parsed ? parsed : null;
    } catch {
      memory = null;
    }
    return memory;
  }

  function clear(): void {
    memory = null;
    try {
      sessionStorage.removeItem(KEY);
    } catch {}
    try {
      localStorage.removeItem(KEY);
    } catch {}
  }

  (globalThis as { CairnWriteInvalidation?: { register(name: string, clear: () => void): void } }).CairnWriteInvalidation?.register(
    "train",
    clear
  );

  const CAIRN_TRAIN_SNAPSHOT: TrainSnapshotApi = { KEY, load, save, clear };
  Object.assign(globalThis, { CairnTrainSnapshot: CAIRN_TRAIN_SNAPSHOT });
}
