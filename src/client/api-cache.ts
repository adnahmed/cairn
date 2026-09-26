// @ts-check
// The pure core under api(): in-flight dedupe, the micro-TTL cache, the opt-in
// stale-while-revalidate tier, the GET-timeout decision and the CairnApiError
// class with its classifiers. Several PWA modules independently re-fetch the
// same hot GETs during one render burst (/settings, /profile, /stats,
// /coaching-focus), and a hung GET had no timeout. Everything here is
// storage/DOM/fetch-free — the same shape as createOutbox (outbox-queue.ts) — so
// the dedupe/TTL/decision logic is fully unit-testable; api-core.ts is the only
// thing that wires it to fetch.
type CairnApiErrorKind = "http" | "invalid_json" | "network" | "timeout";
type ApiCoalesceEntry<T> = { data: T; expires: number };
type ApiStaleEntry<T> = { data: T; ts: number };
type ApiCoalescer = {
  isMicroCachePath(path: string): boolean;
  peekFresh<T = unknown>(path: string): T | undefined;
  // `writeGen` is the generation a GET began under (see writeGeneration): a body
  // that started before a write landed is never remembered as post-write truth.
  store<T = unknown>(path: string, data: T, writeGen?: number): void;
  invalidateAll(): void;
  // ---- opt-in stale-while-revalidate tier ----
  // Paths a caller asked to read stale-while-revalidate; from then on every GET of
  // that path (opted in or not) keeps the remembered body warm.
  markStaleable(path: string): void;
  // The remembered body and its age, or undefined when absent or older than maxAgeMs.
  peekStale<T = unknown>(path: string, maxAgeMs: number): { data: T; age: number } | undefined;
  writeGeneration(): number;
  staleSize(): number;
  share<T>(path: string, start: () => Promise<T>): Promise<T>;
  inFlightCount(): number;
  cacheSize(): number;
};

{
  const API_MICRO_TTL_MS = 1500;
  // `/exercises` and `/plan` join the hot four: both are read from several Today
  // sites inside one render burst (the data loader, the compatibility bridge, the
  // add-exercise flow) and those bursts do not always overlap, so in-flight dedupe
  // alone misses them. Any write still clears the whole micro-cache, and the TTL is
  // 1.5 s, so neither can serve a stale plan into a surface the athlete just changed.
  const API_MICRO_CACHE_PATHS: readonly string[] = [
    "/settings",
    "/profile",
    "/stats",
    "/coaching-focus",
    "/exercises",
    "/plan",
  ];
  const API_GET_TIMEOUT_MS = 20000;
  // Stale-while-revalidate windows for an opted-in GET: a remembered body up to five
  // minutes old paints immediately (a background refresh then upgrades it); one
  // younger than ten seconds is served with no refresh at all. Any write clears the
  // tier outright, so "stale" only ever means "older", never "from before a change".
  const API_SWR_MAX_STALE_MS = 5 * 60 * 1000;
  const API_SWR_FRESH_MS = 10000;
  // Bounded memory: the least-recently-stored remembered bodies drop first.
  const API_SWR_MAX_ENTRIES = 48;

  class CairnApiError extends Error {
    kind: CairnApiErrorKind;
    method: string;
    route: string;
    status: number | null;
    durationMs: number;
    requestId: string | null;

    constructor(options: {
      kind: CairnApiErrorKind;
      method: string;
      route: string;
      status?: number | null;
      durationMs?: number;
      requestId?: string | null;
      cause?: unknown;
    }) {
      const statusSuffix = options.status == null ? "" : ` (${options.status})`;
      const label =
        options.kind === "http"
          ? `Cairn request failed${statusSuffix}`
          : options.kind === "invalid_json"
            ? "Cairn returned an invalid response"
            : options.kind === "timeout"
              ? "Cairn request timed out"
              : "Could not reach Cairn";
      super(label, options.cause === undefined ? undefined : { cause: options.cause });
      this.name = "CairnApiError";
      this.kind = options.kind;
      this.method = options.method;
      this.route = normalizeApiRoute(options.route);
      this.status = options.status == null ? null : options.status;
      this.durationMs = Math.max(0, Math.round(options.durationMs || 0));
      this.requestId = options.requestId || null;
    }
  }

  function normalizeApiRoute(path: string): string {
    const reporter = (globalThis as { CairnClientDiagnosticsCore?: { normalizeRoute?: (value: unknown) => string } })
      .CairnClientDiagnosticsCore;
    if (reporter?.normalizeRoute) return reporter.normalizeRoute(path);
    return String(path || "")
      .split(/[?#]/, 1)[0]
      .slice(0, 160);
  }

  function diagnosticApiRoute(path: string): string {
    const route = normalizeApiRoute(path);
    if (route === "/api" || route.startsWith("/api/")) return route;
    return `/api${route.startsWith("/") ? route : `/${route}`}`;
  }

  function isTransientApiFailure(error: unknown): boolean {
    if (!(error instanceof CairnApiError)) return true;
    return (
      error.kind === "network" ||
      error.kind === "timeout" ||
      error.status === 408 ||
      error.status === 429 ||
      (error.status != null && error.status >= 500)
    );
  }

  // structuredClone when available, else a JSON round-trip, else the value as-is
  // (never throw) — so neither a caller mutating a served body, nor us mutating
  // what we just stored, can poison the micro-cache.
  function cloneJson<T>(value: T): T {
    try {
      if (typeof structuredClone === "function") return structuredClone(value);
    } catch {}
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }

  // ---------- pure core: dedupe map + TTL cache over injected time ----------
  function createApiCoalescer(
    opts: { now?: () => number; ttlMs?: number; ttlPaths?: readonly string[]; maxStaleEntries?: number } = {}
  ): ApiCoalescer {
    const now = opts.now || (() => Date.now());
    const ttlMs = opts.ttlMs && opts.ttlMs > 0 ? opts.ttlMs : API_MICRO_TTL_MS;
    const ttlPaths = new Set(opts.ttlPaths || API_MICRO_CACHE_PATHS);
    const maxStaleEntries =
      opts.maxStaleEntries && opts.maxStaleEntries > 0 ? opts.maxStaleEntries : API_SWR_MAX_ENTRIES;
    const inFlight = new Map<string, Promise<unknown>>();
    const ttlCache = new Map<string, ApiCoalesceEntry<unknown>>();
    // The stale-while-revalidate tier. The micro-cache paths are always staleable
    // (their bodies are already cloned on store, and they are the hot shared reads
    // one surface fetches seconds before another); any other path joins the first
    // time a caller opts it in.
    const staleable = new Set<string>(ttlPaths);
    const staleCache = new Map<string, ApiStaleEntry<unknown>>();
    let writeGen = 0;

    function isMicroCachePath(path: string): boolean {
      return ttlPaths.has(path);
    }
    function peekFresh<T = unknown>(path: string): T | undefined {
      const entry = ttlCache.get(path);
      if (!entry) return undefined;
      if (now() >= entry.expires) {
        ttlCache.delete(path);
        return undefined;
      }
      return cloneJson(entry.data) as T;
    }
    function store<T = unknown>(path: string, data: T, startedGen?: number): void {
      // A GET that began before a write landed carries pre-write truth: serving it
      // afterwards (from either tier) would undo the write on screen.
      if (startedGen != null && startedGen !== writeGen) return;
      const micro = isMicroCachePath(path);
      const stale = staleable.has(path);
      if (!micro && !stale) return;
      const copy = cloneJson(data);
      if (micro) ttlCache.set(path, { data: copy, expires: now() + ttlMs });
      if (stale) {
        staleCache.delete(path); // re-insert so Map order is least-recently-stored first
        staleCache.set(path, { data: copy, ts: now() });
        while (staleCache.size > maxStaleEntries) {
          const oldest = staleCache.keys().next().value;
          if (oldest === undefined) break;
          staleCache.delete(oldest);
        }
      }
    }
    function invalidateAll(): void {
      writeGen++;
      ttlCache.clear();
      staleCache.clear();
    }
    function markStaleable(path: string): void {
      staleable.add(path);
    }
    function peekStale<T = unknown>(path: string, maxAgeMs: number): { data: T; age: number } | undefined {
      const entry = staleCache.get(path);
      if (!entry) return undefined;
      const age = Math.max(0, now() - entry.ts);
      if (age > maxAgeMs) {
        staleCache.delete(path);
        return undefined;
      }
      return { data: cloneJson(entry.data) as T, age };
    }
    function writeGeneration(): number {
      return writeGen;
    }
    function staleSize(): number {
      return staleCache.size;
    }
    // Concurrent callers for the SAME path share one in-flight promise. The map
    // entry is cleared when `started` itself settles (fulfills OR rejects) — NOT
    // when a caller's own transformed/returned promise settles. That distinction
    // is what keeps a 401 from wedging this path forever: api() resolves `started`
    // to a plain {status:401} outcome (never hangs), so the dedupe entry clears
    // the instant the response arrives; each caller then independently decides
    // (per its own chain) to hang on the never-resolving auth-prompt promise.
    function share<T>(path: string, start: () => Promise<T>): Promise<T> {
      const existing = inFlight.get(path);
      if (existing) return existing as Promise<T>;
      const started = start();
      inFlight.set(path, started as Promise<unknown>);
      started
        .finally(() => {
          if (inFlight.get(path) === started) inFlight.delete(path);
        })
        .catch(() => {}); // swallow on this derived chain only; `started` itself still rejects to callers
      return started;
    }
    function inFlightCount(): number {
      return inFlight.size;
    }
    function cacheSize(): number {
      return ttlCache.size;
    }

    return {
      isMicroCachePath,
      peekFresh,
      store,
      invalidateAll,
      markStaleable,
      peekStale,
      writeGeneration,
      staleSize,
      share,
      inFlightCount,
      cacheSize,
    };
  }

  // Normalizes the `swr` api() option: absent/false → null (plain read), true → the
  // defaults, an object → the defaults overlaid with the caller's windows.
  function resolveApiSwr(
    option: CairnApiOptions["swr"]
  ): { maxStaleMs: number; freshMs: number; onStale?: (refresh: Promise<unknown>) => void } | null {
    if (!option) return null;
    const o = option === true ? {} : option;
    const maxStaleMs = typeof o.maxStaleMs === "number" && o.maxStaleMs >= 0 ? o.maxStaleMs : API_SWR_MAX_STALE_MS;
    const freshMs =
      typeof o.freshMs === "number" && o.freshMs >= 0 ? Math.min(o.freshMs, maxStaleMs) : API_SWR_FRESH_MS;
    return { maxStaleMs, freshMs, onStale: typeof o.onStale === "function" ? o.onStale : undefined };
  }

  // ---------- pure decision helpers (no DOM) ----------
  // A caller-supplied `signal` or `cache` option is a request for real network
  // control, so it bypasses BOTH the dedupe and the micro-TTL cache entirely.
  function shouldBypassApiCache(opts: CairnApiOptions): boolean {
    return opts.signal != null || opts.cache != null;
  }
  // GETs get a generous safety timeout unless the caller brought its own signal
  // — agentic ops are all background jobs now, so no legitimate GET runs long.
  function shouldArmGetTimeout(method: string, opts: CairnApiOptions): boolean {
    return method.toUpperCase() === "GET" && opts.signal == null;
  }

  // api-core reads the core through this namespace, and tests exercise it directly.
  const CAIRN_API_CACHE = {
    createApiCoalescer,
    shouldBypassApiCache,
    shouldArmGetTimeout,
    MICRO_TTL_MS: API_MICRO_TTL_MS,
    MICRO_CACHE_PATHS: API_MICRO_CACHE_PATHS,
    GET_TIMEOUT_MS: API_GET_TIMEOUT_MS,
    ApiError: CairnApiError,
    isTransientApiFailure,
    normalizeRoute: normalizeApiRoute,
    diagnosticRoute: diagnosticApiRoute,
    resolveSwr: resolveApiSwr,
  };

  Object.assign(globalThis, { CairnApiCache: CAIRN_API_CACHE, CairnApiError });
}
