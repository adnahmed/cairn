// @ts-check
// ONE way a screen tells "Cairn is out of reach" apart from "there is nothing here".
//
// A read that failed because the network is gone used to fall through the same
// `.catch(() => null)` as a genuinely empty answer, so an installed app opened on a
// sleeping tailnet told a months-deep athlete "Log a session and this becomes your
// training map" or "No goal set yet". That is a lie, and a scary one. The rule this
// module holds for every surface that adopts it:
//   - network answered   -> paint it (and remember it as the last-known read);
//   - network unreachable, a last-known read exists -> paint THAT, with one quiet
//     "last known" line saying so;
//   - network unreachable, nothing remembered -> the unreachable state, never the
//     first-run empty state.
// A reachable server that answers with an error is not "offline": it keeps each
// surface's own honest error copy.
//
// Last-known reads live in the SWR cache (swr-cache.ts) under the caller's key, so
// the health-sensitive prefixes it keeps memory-only stay memory-only here too, and
// every write that invalidates a key (write-invalidation-client.ts) also retires the
// last-known copy — a stale read is never served as last-known after a write.

type OfflineReadSource = "network" | "last-known" | "none";
type OfflineRead<T> = { data: T | null; source: OfflineReadSource; unreachable: boolean };

type OfflineStateRoot = typeof globalThis & {
  CairnApiError?: new (...args: never[]) => Error & { kind?: string };
  api?: (path: string, opts?: Record<string, unknown>) => Promise<unknown>;
  peekCached?: <T = unknown>(key: string, freshFor?: number) => { data: T; fresh: boolean } | null;
  swrSet?: <T = unknown>(key: string, data: T) => void;
  swrStamp?: (key: string) => string;
  CairnUi?: { emptyStateHtml(options: { title: unknown; body?: unknown; action?: unknown; className?: string }): string };
  escHtml?: (value: unknown) => string;
};

type OfflineStateApi = {
  isUnreachable(error: unknown): boolean;
  read<T = unknown>(path: string, key: string): Promise<OfflineRead<T>>;
  unreachableHtml(opts?: { title?: string; body?: string; retry?: boolean }): string;
  lastKnownHtml(): string;
  wireRetry(root: ParentNode | null | undefined, retry: () => unknown): void;
};

{
  const RETRY_ATTR = "data-offline-retry";

  function isUnreachable(error: unknown): boolean {
    const root = globalThis as OfflineStateRoot;
    const ApiError = root.CairnApiError;
    if (ApiError && error instanceof ApiError) {
      const kind = (error as { kind?: string }).kind;
      return kind === "network" || kind === "timeout";
    }
    if (error instanceof Error && error.message === "swr-offline") return true;
    // fetch() itself rejects with a TypeError when the network is gone.
    if (error instanceof TypeError) return true;
    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
    } catch {}
    return false;
  }

  // Network-first: a reachable server always wins, so this never paints an older
  // read while a fresh one is available. Only an unreachable server falls back.
  async function read<T = unknown>(path: string, key: string): Promise<OfflineRead<T>> {
    const root = globalThis as OfflineStateRoot;
    try {
      if (typeof root.api !== "function") throw new TypeError("api unavailable");
      const stampAtStart = key ? root.swrStamp?.(key) : undefined;
      const data = (await root.api(path)) as T;
      // A write that landed while this read was in flight (a goal change, a chat
      // turn's log) makes this body pre-write truth: never store it as last-known,
      // and hand back whatever the write left instead when there is one.
      if (key && stampAtStart !== undefined && root.swrStamp?.(key) !== stampAtStart) {
        const current = root.peekCached?.<T>(key, 0);
        return { data: current ? current.data : data, source: "network", unreachable: false };
      }
      try {
        if (key) root.swrSet?.(key, data);
      } catch {}
      return { data, source: "network", unreachable: false };
    } catch (error) {
      if (!isUnreachable(error)) return { data: null, source: "none", unreachable: false };
      const peek = key ? root.peekCached?.<T>(key, 0) : null;
      if (peek) return { data: peek.data, source: "last-known", unreachable: true };
      return { data: null, source: "none", unreachable: true };
    }
  }

  function esc(value: unknown): string {
    const root = globalThis as OfflineStateRoot;
    if (typeof root.escHtml === "function") return root.escHtml(value);
    return String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  }

  // The calm stand-in for a read we could not make. Information, never an alarm:
  // the offline hairline already says the server is out of reach.
  function unreachableHtml(opts: { title?: string; body?: string; retry?: boolean } = {}): string {
    const title = opts.title || "Can't reach Cairn right now.";
    const body = opts.body || "Nothing is lost — this fills in as soon as it's back.";
    const action = opts.retry === false ? null : { label: "Try again", className: "linkbtn", attrs: { [RETRY_ATTR]: "" } };
    const root = globalThis as OfflineStateRoot;
    if (root.CairnUi?.emptyStateHtml) {
      return root.CairnUi.emptyStateHtml({ title, body, action, className: "empty-state offline-state reveal" });
    }
    return `<div class="empty-state offline-state reveal" role="status" aria-live="polite"><div class="empty-state-line">${esc(title)}</div><div class="hpic-hero-sub">${esc(body)}</div>${
      action ? `<button class="linkbtn" type="button" ${RETRY_ATTR}>Try again</button>` : ""
    }</div>`;
  }

  // One quiet line above a last-known read.
  function lastKnownHtml(): string {
    return `<p class="offline-lastknown" role="status">Last known — Cairn is out of reach, so this may be behind.</p>`;
  }

  function wireRetry(root: ParentNode | null | undefined, retry: () => unknown): void {
    root?.querySelectorAll<HTMLElement>(`[${RETRY_ATTR}]`).forEach((button) => {
      if (button.dataset.offlineRetryWired) return;
      button.dataset.offlineRetryWired = "1";
      button.addEventListener("click", () => {
        try {
          void retry();
        } catch {}
      });
    });
  }

  const CAIRN_OFFLINE: OfflineStateApi = { isUnreachable, read, unreachableHtml, lastKnownHtml, wireRetry };
  Object.assign(globalThis, { CairnOffline: CAIRN_OFFLINE });
}
