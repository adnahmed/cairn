// @ts-check
// Early service-worker updater. Its filename is intentionally separate from the
// normal app-service-worker helper so old caches fetch it from the network.

type ServiceWorkerRoot = typeof globalThis & {
  __cairnSwLifecycleStarted?: boolean;
  registerServiceWorkerLifecycle?: () => void;
};

{
  // The timing and the reload rule live once, in app/update-gate.ts (loaded before
  // this file). Without it (a bare test context) registration runs at once and a
  // controller change reloads once.
  type LifecycleGate = {
    whenLoadedAndIdle?: (run: () => void) => void;
    controllerChangeListener?: (hadController: boolean, reload: () => void) => () => void;
  };
  function lifecycleGate(): LifecycleGate | undefined {
    return (globalThis as { CairnUpdateGate?: LifecycleGate }).CairnUpdateGate;
  }
  function whenLoadedAndIdle(run: () => void): void {
    const gate = lifecycleGate();
    if (typeof gate?.whenLoadedAndIdle === "function") gate.whenLoadedAndIdle(run);
    else run();
  }
  function controllerChangeListener(hadController: boolean): () => void {
    const reload = (): void => location.reload();
    const gate = lifecycleGate();
    if (typeof gate?.controllerChangeListener === "function") return gate.controllerChangeListener(hadController, reload);
    let reloading = false;
    return () => {
      if (!hadController || reloading) return;
      reloading = true;
      reload();
    };
  }

  function startServiceWorkerLifecycle(): void {
    if (!("serviceWorker" in navigator)) return;
    const root = globalThis as ServiceWorkerRoot;
    if (root.__cairnSwLifecycleStarted) return;
    root.__cairnSwLifecycleStarted = true;

    // Single-user self-hosted app: a deploy should always be live on the next open
    // OR shortly after resume — not only on a cold navigation. sw.js skipWaiting()s
    // on install, so the new worker activates as soon as it downloads; reload once
    // when it takes control. The first-ever install has no prior controller and
    // must not reload. WHEN to reload is the update gate's call (app/update-gate.ts):
    // at once when nothing is in flight, otherwise a quiet "tap to refresh" line and
    // a reload the next time the page is hidden — never mid-set or mid-sentence.
    navigator.serviceWorker.addEventListener("controllerchange", controllerChangeListener(!!navigator.serviceWorker.controller));

    // The browser only re-checks sw.js for a new version on navigation, so an
    // installed PWA that resumes from memory (typical for iOS "Add to Home
    // Screen" standalone mode, which never does a fresh navigation) can sit on a
    // stale worker indefinitely. Nudge an explicit registration.update() whenever
    // the app becomes visible again or resumes from the back/forward cache, plus
    // a slow interval as a backstop — throttled so a flurry of visibility/pageshow
    // events never spams the network.
    let registration: ServiceWorkerRegistration | undefined;
    const MIN_UPDATE_CHECK_GAP_MS = 5 * 60 * 1000;
    let lastUpdateCheck = 0;
    function checkForUpdate(): void {
      if (!registration) return;
      const now = Date.now();
      if (now - lastUpdateCheck < MIN_UPDATE_CHECK_GAP_MS) return;
      lastUpdateCheck = now;
      registration.update().catch(() => {});
    }

    // Register after load, in idle time: the worker's install precaches the whole
    // shell, and on a cold first open that download must not compete with the
    // bundles and API reads the first paint is waiting on.
    whenLoadedAndIdle(() => {
      navigator.serviceWorker.register("/sw.js").then((reg) => {
        registration = reg;
      }).catch(() => {});
    });

    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") checkForUpdate();
      });
    }
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      // event.persisted (bfcache restore) is the case that matters most here —
      // an iOS standalone app resuming from memory never re-fetches sw.js on its
      // own — but any pageshow is a cheap, throttled opportunity to check.
      window.addEventListener("pageshow", () => checkForUpdate());
    }
    if (typeof setInterval === "function") {
      setInterval(checkForUpdate, 60 * 60 * 1000);
    }
  }

  const root = globalThis as ServiceWorkerRoot;
  if (typeof root.registerServiceWorkerLifecycle !== "function") {
    root.registerServiceWorkerLifecycle = startServiceWorkerLifecycle;
  }
  if (typeof window !== "undefined" && typeof window.registerServiceWorkerLifecycle !== "function") {
    window.registerServiceWorkerLifecycle = startServiceWorkerLifecycle;
  }

  startServiceWorkerLifecycle();
}
