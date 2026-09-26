// @ts-check
// What api() tells the rest of the app when a request fails: the failure diagnostic
// (one coalesced row for "Cairn is unreachable", a bounded row for anything else) and
// the calm offline hairline. Split out of api-core.ts, which reaches both at call
// time only — this module loads right after it in bundle-01.
{
  // One coalesced identity for "Cairn is unreachable". A restart or a dropped
  // connection fails every in-flight route at once; reporting one row per route
  // made a single deploy read as ~15 separate issues in the operator list. The
  // server honours this fingerprint (see CLIENT_NETWORK_UNREACHABLE_FINGERPRINT
  // in src/repo/diagnostics.ts) so the burst folds into one occurrence_count.
  const API_UNREACHABLE_FINGERPRINT = "network_unreachable";

  function reportFailure(error: CairnApiError): void {
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
        route: CairnApiCache.diagnosticRoute(error.route),
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

  Object.assign(globalThis, { setOffline, CairnApiSignals: { reportFailure } });
}
