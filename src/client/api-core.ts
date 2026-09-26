// @ts-check
// The browser's one way to reach Cairn: api() (token + time-zone headers, the
// shared coalescer from api-cache.ts, the GET timeout, 401 handling), apiBinary(),
// the optional shared-token auth helpers and the offline hairline. Kept as a
// plain script so the vanilla PWA modules keep using these global functions.
// Writes that must survive a dead connection go through the outbox (outbox.ts),
// which drains the moment this module sees Cairn answer again.
// Opt-in stale-while-revalidate for an idempotent GET (see `api()` below).
// `true` takes the defaults; an object tunes the windows and receives the
// background refresh when a stale body was served.
type CairnApiSwrOptions = {
  // How old a remembered body may be and still be served instantly (default 5 min).
  maxStaleMs?: number;
  // Younger than this, the remembered body is served WITHOUT a background refresh
  // (default 10 s) — the "Today fetched it seconds ago" case.
  freshMs?: number;
  // Called synchronously, before api() resolves, whenever a remembered body was
  // served and a background refresh started. The promise resolves to the fresh
  // body, or to undefined when the refresh failed (the served body stands).
  onStale?: (refresh: Promise<unknown>) => void;
};
type CairnApiOptions = RequestInit & {
  headers?: Record<string, string>;
  acceptErrorBody?: boolean;
  swr?: boolean | CairnApiSwrOptions;
};
type CairnApiResponse<Path extends string> = import("../contracts/client.js").ClientApiResponse<Path>;

type ApiFetchOutcome = {
  status: number;
  body?: unknown;
  invalidJson?: boolean;
  durationMs: number;
  requestId?: string;
  writeGen?: number;
};

{
  // The pure core lives in api-cache.ts, which loads just before this module.
  const {
    createApiCoalescer,
    shouldBypassApiCache,
    shouldArmGetTimeout,
    resolveSwr: resolveApiSwr,
    diagnosticRoute: diagnosticApiRoute,
    GET_TIMEOUT_MS: API_GET_TIMEOUT_MS,
  } = CairnApiCache;

  // ---------- optional shared-token auth ----------
  // No-op unless the server has CAIRN_AUTH_TOKEN set. The token lives in
  // localStorage; api() sends it as a header, withToken() appends it to direct
  // resource URLs (art images, file/export downloads) that can't carry a header.
  function authToken(): string {
    try {
      return (localStorage.getItem("cairn_token") || "").trim();
    } catch {
      return "";
    }
  }

  function withToken(url: string): string {
    const t = authToken();
    if (!t) return url;
    return url + (url.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(t);
  }

  let promptingAuth = false;

  function handleUnauthorized(): void {
    if (promptingAuth) return;
    promptingAuth = true;
    try {
      localStorage.removeItem("cairn_token");
    } catch {}
    CairnTokenSheet.open();
  }

  // The device's live IANA timezone (e.g. "America/New_York", "Asia/Tokyo"). Sent
  // on every call so the server frames "today"/now/log-times where the owner ACTUALLY
  // is, so traveling across zones just works (logs stay UTC instants server-side).
  function deviceTimeZone(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch {
      return "";
    }
  }

  function responseRequestId(response: Response | { headers?: unknown }): string {
    try {
      const headers = response.headers as Headers | { get?(name: string): string | null } | undefined;
      return String(headers?.get?.("X-Request-ID") || "")
        .trim()
        .slice(0, 100);
    } catch {
      return "";
    }
  }

  // One coalesced identity for "Cairn is unreachable". A restart or a dropped
  // connection fails every in-flight route at once; reporting one row per route
  // made a single deploy read as ~15 separate issues in the operator list. The
  // server honours this fingerprint (see CLIENT_NETWORK_UNREACHABLE_FINGERPRINT
  // in src/repo/diagnostics.ts) so the burst folds into one occurrence_count.
  const API_UNREACHABLE_FINGERPRINT = "network_unreachable";

  function reportApiError(error: CairnApiError): void {
    try {
      const report = (globalThis as { CairnClientDiagnostics?: { report?(event: unknown): unknown } })
        .CairnClientDiagnostics?.report;
      if (!report) return;
      const online = typeof navigator === "undefined" ? undefined : navigator.onLine;
      if (error.kind === "network" || error.kind === "timeout") {
        report({
          kind: "api_failure",
          level: "warning",
          fingerprint: API_UNREACHABLE_FINGERPRINT,
          message: "network: Could not reach Cairn",
          duration_ms: error.durationMs,
          online,
        });
        return;
      }
      report({
        kind: "api_failure",
        level: error.kind === "http" && error.status != null && error.status < 500 ? "warning" : "error",
        message: `${error.kind}: ${error.message}`,
        route: diagnosticApiRoute(error.route),
        method: error.method,
        // A status only means something for a request that actually got a
        // response. Reporting it for an outage is what printed `/api/x:200`.
        status: error.status ?? undefined,
        duration_ms: error.durationMs,
        request_id: error.requestId || undefined,
        online,
      });
    } catch {}
  }

  let apiCoalescerSingleton: ApiCoalescer | null = null;
  function apiCoalescer(): ApiCoalescer {
    if (!apiCoalescerSingleton) apiCoalescerSingleton = createApiCoalescer({});
    return apiCoalescerSingleton;
  }

  // ---------- runtime: fetch init for one attempt ----------
  // Arms a 20s AbortController ONLY for a timeout-eligible GET, and only when
  // AbortController/setTimeout actually exist in this environment. A non-GET (or
  // any caller-supplied signal) passes straight through untouched — long
  // health-doc uploads on a slow network are legitimate and must never time out.
  function buildFetchInit(
    method: string,
    opts: CairnApiOptions,
    headers: Record<string, string>
  ): { init: RequestInit; cleanup: () => void } {
    const { acceptErrorBody: _acceptErrorBody, swr: _swr, ...fetchOptions } = opts;
    let signal = opts.signal;
    let cleanup = () => {};
    if (shouldArmGetTimeout(method, opts) && typeof AbortController === "function") {
      const controller = new AbortController();
      signal = controller.signal;
      if (typeof setTimeout === "function") {
        const timer = setTimeout(() => controller.abort(), API_GET_TIMEOUT_MS);
        cleanup = () => {
          if (typeof clearTimeout === "function") clearTimeout(timer);
        };
      }
    }
    return { init: { ...fetchOptions, headers, signal }, cleanup };
  }

  function api<Path extends string>(p: Path, opts: CairnApiOptions = {}): Promise<CairnApiResponse<Path>> {
    const method = (opts.method || "GET").toUpperCase();
    const isGet = method === "GET";
    const bypass = shouldBypassApiCache(opts);
    const coalescer = apiCoalescer();
    // Stale-while-revalidate is opt-in, GET-only, and yields to a caller that asked
    // for real network control (signal/cache), exactly like the micro-cache.
    const swr = isGet && !bypass ? resolveApiSwr(opts.swr) : null;
    let staleHit: { data: CairnApiResponse<Path>; age: number } | undefined;

    if (!isGet) {
      coalescer.invalidateAll(); // any write may change anything — never serve a stale read after it
    } else if (!bypass) {
      const cached = coalescer.peekFresh<CairnApiResponse<Path>>(p);
      if (cached !== undefined) return Promise.resolve(cached);
      if (swr) {
        coalescer.markStaleable(p);
        staleHit = coalescer.peekStale<CairnApiResponse<Path>>(p, swr.maxStaleMs);
        // Remembered seconds ago (another surface just read it): serve it, no refetch.
        if (staleHit && staleHit.age < swr.freshMs) return Promise.resolve(staleHit.data);
      }
    }

    const t = authToken();
    const headers = { ...(opts.headers || {}) };
    if (t) headers["X-Cairn-Token"] = t;
    const tz = deviceTimeZone();
    if (tz) headers["X-Cairn-TZ"] = tz;

    const attempt = (): Promise<ApiFetchOutcome> => {
      // The write generation this request began under — a body fetched across a
      // write is returned to its caller but never remembered (see coalescer.store).
      const writeGen = coalescer.writeGeneration();
      const { init, cleanup } = buildFetchInit(method, opts, headers);
      const started =
        typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
      const elapsed = (): number => {
        const ended =
          typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
        return Math.max(0, ended - started);
      };
      return fetch("/api" + p, init)
        .then(async (r) => {
          const base = { status: r.status, durationMs: elapsed(), requestId: responseRequestId(r), writeGen };
          if (r.status === 401 || r.status === 204) return base;
          try {
            return { ...base, body: await r.json() };
          } catch (cause) {
            // Reading the body can fail for three different reasons, and only one
            // of them is malformed JSON. The 20s GET timeout can fire DURING the
            // body read (AbortError), and the body stream can break outright when
            // the server restarts or iOS backgrounds the tab (TypeError). Both are
            // outages: rethrow so the fetch catch below classifies them as
            // timeout/network. Calling them `invalid_json` is what produced
            // api_failure rows carrying a 200 status.
            const name = cause && typeof cause === "object" ? String((cause as { name?: unknown }).name || "") : "";
            if (name === "AbortError" || name === "TimeoutError" || name === "TypeError") throw cause;
            return { ...base, invalidJson: true };
          }
        })
        .catch((cause) => {
          const error = new CairnApiError({
            kind: (() => {
              const name = cause && typeof cause === "object" ? String((cause as { name?: unknown }).name || "") : "";
              return name === "AbortError" || name === "TimeoutError" ? "timeout" : "network";
            })(),
            method,
            route: p,
            durationMs: elapsed(),
            cause,
          });
          reportApiError(error);
          throw error;
        })
        .finally(cleanup);
    };

    const run = (): Promise<CairnApiResponse<Path>> => {
      const settled = isGet && !bypass ? coalescer.share(p, attempt) : attempt();
      return finishApiResponse(settled);
    };

    if (swr && staleHit) {
      // Serve the remembered body now; the network answer lands in both tiers in
      // the background and is handed to the caller's onStale, which re-renders only
      // if it differs. A failed refresh resolves undefined: the served body stands.
      // The shared fetch can resolve AFTER a write lands and bumps the generation —
      // exactly the window coalescer.store() already refuses to remember. A repaint
      // from onStale must honor the same guard: a body that started before the write
      // but is only handed back once the generation has moved on is pre-write truth,
      // so it resolves undefined here too rather than painting over what the write
      // just did.
      const sharedOutcome = isGet && !bypass ? coalescer.share(p, attempt) : attempt();
      const refresh: Promise<unknown> = sharedOutcome.then(
        (result) => {
          if (result.writeGen !== coalescer.writeGeneration()) return undefined;
          return finishApiResponse(Promise.resolve(result));
        },
        () => undefined
      );
      try {
        swr.onStale?.(refresh);
      } catch {}
      return Promise.resolve(staleHit.data);
    }
    const result = run();
    if (!isGet) {
      // A write invalidates the caches and bumps the generation at the START (see
      // above) so nothing already in-flight is ever trusted once the write lands.
      // Bumping again here, when the write SETTLES (success or failure), closes the
      // other half of the window: a GET that began during the write but is answered
      // — and would be stored — before the write's own response lands must not be
      // kept as post-write truth once the write actually finishes.
      result.then(
        () => coalescer.invalidateAll(),
        () => coalescer.invalidateAll()
      );
    }
    return result;

    function finishApiResponse(settled: Promise<ApiFetchOutcome>): Promise<CairnApiResponse<Path>> {
      return settled
        .then((result) => {
          if (result.status === 401) {
            handleUnauthorized();
            return new Promise<CairnApiResponse<Path>>(() => {});
          }
          setOffline(false); // a real response landed, Cairn is reachable
          if (result.status < 200 || result.status >= 300) {
            // Readiness uses 503 as meaningful operator truth (for example, a stale
            // scheduler) and still returns a bounded JSON contract. Opt-in callers
            // can consume that body without turning the expected signal into a
            // recursive client diagnostic.
            if (opts.acceptErrorBody && !result.invalidJson && result.body !== undefined) {
              return result.body as CairnApiResponse<Path>;
            }
            const error = new CairnApiError({
              kind: "http",
              method,
              route: p,
              status: result.status,
              durationMs: result.durationMs,
              requestId: result.requestId,
            });
            reportApiError(error);
            throw error;
          }
          if (result.invalidJson) {
            const error = new CairnApiError({
              kind: "invalid_json",
              method,
              route: p,
              status: result.status,
              durationMs: result.durationMs,
              requestId: result.requestId,
            });
            reportApiError(error);
            throw error;
          }
          if (isGet && !bypass) coalescer.store(p, result.body, result.writeGen);
          return result.body as CairnApiResponse<Path>;
        })
        .catch((err) => {
          // A reachable HTTP/protocol failure must never claim Cairn is offline.
          // Only fetch/abort/connectivity failures get the calm offline hairline.
          if (err instanceof CairnApiError && (err.kind === "network" || err.kind === "timeout")) setOffline(true);
          throw err;
        });
    }
  }

  // Binary API reads share the normal token/time-zone headers but intentionally do
  // not enter the JSON coalescer or any persistent browser cache.
  async function apiBinary(p: string, opts: RequestInit = {}): Promise<{ body: ArrayBuffer; headers: Headers }> {
    const headers = new Headers(opts.headers || {});
    const token = authToken();
    if (token) headers.set("X-Cairn-Token", token);
    const tz = deviceTimeZone();
    if (tz) headers.set("X-Cairn-TZ", tz);
    const response = await fetch(`/api${p}`, { ...opts, headers, cache: "no-store" });
    if (!response.ok) throw new Error(`Binary request failed (${response.status})`);
    return { body: await response.arrayBuffer(), headers: response.headers };
  }

  // ---------- offline hairline ----------
  // A calm, non-alarming banner that rides just under the header whenever a fetch
  // fails or the browser reports offline. It clears itself the moment any request
  // succeeds (or `online` fires). Constitution: information, never an alarm, one
  // thin warm line, no modal. The "will retry" promise is now literally true — a
  // failed capture / set-log is held in the outbox and replayed on reconnect.
  let _offline = false;

  function setOffline(on: unknown): void {
    const offline = !!on;
    if (offline === _offline) return;
    _offline = offline;
    let bar = document.querySelector(".offline-bar");
    if (offline) {
      if (!bar) {
        const created = document.createElement("div");
        created.className = "offline-bar";
        created.setAttribute("role", "status");
        created.setAttribute("aria-live", "polite");
        created.innerHTML = `<span class="offline-dot" aria-hidden="true"></span><span>Can't reach Cairn — saved logs will retry</span>`;
        document.body.appendChild(created);
        bar = created;
      }
      const visibleBar = bar;
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => visibleBar.classList.add("show"));
      else visibleBar.classList.add("show");
    } else {
      if (bar) bar.classList.remove("show");
      // We just regained a live connection (a real response landed, or `online`
      // fired): drain anything the outbox is holding, in order.
      try {
        void flushOutbox();
      } catch {}
    }
  }

  // A write that landed somewhere this page did not send it from (a chat turn's
  // actions, applied server-side long after the POST that queued them) clears the
  // micro/stale tier the same way a local write does (write-invalidation-client.ts).
  function apiInvalidate(): void {
    apiCoalescer().invalidateAll();
  }

  Object.assign(globalThis, { authToken, withToken, deviceTimeZone, api, apiBinary, setOffline, apiInvalidate });
}
