type CairnLazyBundleName = ClientLazyBundleName;

// @ts-check
// On-demand loader for app-shell bundles index.html does NOT load eagerly.
//
// Only Today, You, Fuel, capture and the shell are eager. Train, Horizon, Ask,
// Settings and the Me / Health / Records surfaces are injected on first
// navigation to a destination that needs them, and warmed on idle after the
// first paint (prefetchLazyBundles) so a tab switch does not wait on the network.
//
// Contract, deliberately narrow:
//   - ONE <script> per bundle, ever. Concurrent callers share the same promise,
//     and a resolved bundle answers synchronously through withBundle().
//   - A bundle may DEPEND on another (LAZY_BUNDLE_DEPS): ensureBundle resolves
//     only once the bundle and every dependency have executed. Lazy bundles never
//     reference each other at load time, so they may execute in any order.
//   - The url carries NO query string. It must hash-match the service worker's
//     precached CORE_ASSETS entry (Cache Storage keys on the full url), so an
//     offline-installed PWA still resolves this from the precache. Static assets
//     are never token-gated — src/auth.ts enforces only /api and /mcp — so there
//     is no token to append here either.
//   - A failed load removes the tag so a later navigation can retry, and rejects
//     so the caller (the tab switcher) paints its normal error state.
{
  const LAZY_BUNDLE_SRC: Readonly<Record<CairnLazyBundleName, string>> = {
    "me-health": "/js/bundle-05-me-health.js",
    "train": "/js/bundle-08-train.js",
    "horizon": "/js/bundle-09-horizon.js",
    "ask": "/js/bundle-10-ask.js",
    "settings": "/js/bundle-11-settings.js",
  };

  // What else a bundle calls into at render time. Health reuses the body-metrics
  // figure and the DEXA targeting read (train); Horizon paints the journey reads,
  // the run-plan cards and the plan week strip (train).
  const LAZY_BUNDLE_DEPS: Readonly<Record<CairnLazyBundleName, readonly CairnLazyBundleName[]>> = {
    "me-health": ["train"],
    "train": [],
    "horizon": ["train"],
    "ask": [],
    "settings": [],
  };

  // Warm order after first paint: the homes a tap away first, Settings last.
  const PREFETCH_ORDER: readonly CairnLazyBundleName[] = ["train", "ask", "horizon", "me-health", "settings"];

  const inflight = new Map<CairnLazyBundleName, Promise<void>>();
  const executed = new Set<CairnLazyBundleName>();

  // A lazily-loaded bundle can bring boot-time registrations with it (the
  // health_review job reconnector lives on the Stand screen). Re-run the app's
  // idempotent registration pass, and — only when that registered something new —
  // one reconnect sweep, so an in-flight review still reattaches on the surface
  // that owns it without every idle warm-up costing an /agent-jobs round trip.
  function afterBundleLoaded(): void {
    const root = globalThis as {
      registerAppJobReconnectors?: () => unknown;
      jobReconnect?: () => Promise<void>;
    };
    let added: unknown;
    try {
      added = root.registerAppJobReconnectors?.();
    } catch {}
    if (added === 0) return;
    try {
      void root.jobReconnect?.();
    } catch {}
  }

  function injectBundle(name: CairnLazyBundleName, src: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (typeof document === "undefined") {
        reject(new Error(`cannot load ${name}: no document`));
        return;
      }
      const existing = document.querySelector<HTMLScriptElement>(`script[data-cairn-bundle="${name}"]`);
      if (existing?.dataset.cairnBundleLoaded === "1") {
        resolve();
        return;
      }
      const script = existing || document.createElement("script");
      script.dataset.cairnBundle = name;
      script.addEventListener(
        "load",
        () => {
          script.dataset.cairnBundleLoaded = "1";
          resolve();
        },
        { once: true }
      );
      script.addEventListener(
        "error",
        () => {
          // Drop the tag so the next attempt re-requests instead of finding a dead
          // node and assuming the bundle is on its way.
          script.remove();
          inflight.delete(name);
          reject(new Error(`failed to load ${src}`));
        },
        { once: true }
      );
      if (!existing) {
        script.src = src;
        // Injected scripts are async by default; lazy bundles have no load-time
        // ordering relationship with anything, so that is what we want.
        (document.head || document.documentElement).appendChild(script);
      }
    });
  }

  function loadOne(name: CairnLazyBundleName): Promise<void> {
    const pending = inflight.get(name);
    if (pending) return pending;
    const promise = injectBundle(name, LAZY_BUNDLE_SRC[name]).then(() => {
      executed.add(name);
      afterBundleLoaded();
    });
    inflight.set(name, promise);
    return promise;
  }

  function closure(name: CairnLazyBundleName): CairnLazyBundleName[] {
    const out: CairnLazyBundleName[] = [];
    const visit = (n: CairnLazyBundleName) => {
      if (out.includes(n)) return;
      for (const dep of LAZY_BUNDLE_DEPS[n] || []) visit(dep);
      out.push(n);
    };
    visit(name);
    return out;
  }

  /**
   * Resolve once `name`'s bundle and its dependencies have executed. Safe to call
   * on every navigation: after the first success it is a resolved-promise lookup.
   */
  function ensureBundle(name: CairnLazyBundleName): Promise<void> {
    if (!Object.hasOwn(LAZY_BUNDLE_SRC, name)) {
      return Promise.reject(new Error(`unknown lazy bundle: ${String(name)}`));
    }
    const parts = closure(name);
    if (parts.length === 1) return loadOne(name);
    return Promise.all(parts.map(loadOne)).then(() => undefined);
  }

  /** Whether the bundle AND its dependencies have executed (no load is started by asking). */
  function bundleLoaded(name: CairnLazyBundleName): boolean {
    if (typeof document === "undefined" || !Object.hasOwn(LAZY_BUNDLE_SRC, name)) return false;
    return closure(name).every(
      (n) =>
        executed.has(n) ||
        document.querySelector(`script[data-cairn-bundle="${n}"][data-cairn-bundle-loaded="1"]`) != null
    );
  }

  /**
   * Run `fn` once `name` is ready. When it already is, `fn` runs SYNCHRONOUSLY —
   * a warm destination paints inside the caller's view transition exactly as it
   * did when the bundle was eager; only a cold one waits on the load.
   */
  function withBundle<T>(name: CairnLazyBundleName, fn: () => T): T | Promise<Awaited<T>> {
    if (bundleLoaded(name)) return fn();
    return ensureBundle(name).then(() => fn() as Awaited<T>);
  }

  // Warm every lazy bundle one idle slot at a time after the first paint, so the
  // first tap on Train / Horizon / Ask / You is as instant as it was when these
  // were eager. Executing (not just fetching) is the point: the parse is what a
  // tap would otherwise wait on. Skipped on Save-Data; a failed warm-up is silent
  // (the navigation that needs the bundle retries and shows its own error state).
  let prefetchStarted = false;
  function prefetchLazyBundles(options: { delayMs?: number } = {}): void {
    if (prefetchStarted || typeof document === "undefined") return;
    prefetchStarted = true;
    const nav = (globalThis as { navigator?: { connection?: { saveData?: boolean } } }).navigator;
    if (nav?.connection?.saveData) return;
    const idle = (cb: () => void) => {
      const ric = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => unknown })
        .requestIdleCallback;
      if (typeof ric === "function") ric(cb, { timeout: 4000 });
      else setTimeout(cb, 200);
    };
    const queue = PREFETCH_ORDER.slice();
    const next = (): void => {
      const name = queue.shift();
      if (!name) return;
      if (bundleLoaded(name)) {
        next();
        return;
      }
      idle(() => {
        ensureBundle(name)
          .catch(() => {})
          .then(() => next());
      });
    };
    setTimeout(next, Math.max(0, options.delayMs ?? 1500));
  }

  Object.assign(globalThis, { ensureBundle, bundleLoaded, withBundle, prefetchLazyBundles, LAZY_BUNDLE_SRC, LAZY_BUNDLE_DEPS });

  if (typeof window !== "undefined") {
    window.ensureBundle = ensureBundle;
    window.bundleLoaded = bundleLoaded;
    window.withBundle = withBundle;
    window.prefetchLazyBundles = prefetchLazyBundles;
  }
}
