// @ts-check
// Fuel — the deps factories (docs/DESIGN.md "Component architecture": dependencies
// come in through `deps`). Plan → Food (coach-meals-screen.ts renderFoodJournal)
// builds each Fuel component's deps here from the shell's shared primitives, so the
// components themselves never reach for a global and a test can hand them fakes.
{
  function swr(): ClientFuelSwrDeps {
    return {
      peekCached: (key) => peekCached(key),
      cachedApi: (path, options) => cachedApi(path, options),
      swrInvalidate: (key) => swrInvalidate(key),
      reducedMotion: () => reducedMotion(),
      markRefreshing: (on) => markRefreshing(on),
    };
  }

  const hour = (): number => new Date().getHours();

  /** The unsent "Log food" draft, per viewer; every storage access is guarded. */
  function draft(): { load(): string; save(value: string): void } {
    const KEY = "cairn.fuelLogDraft";
    return {
      load: () => {
        try {
          return localStorage.getItem(KEY) || "";
        } catch {
          return "";
        }
      },
      save: (value) => {
        try {
          if (value) localStorage.setItem(KEY, value);
          else localStorage.removeItem(KEY);
        } catch {
          /* a draft is a convenience */
        }
      },
    };
  }

  /**
   * The composer's idempotency envelope, per viewer: a send writes its request_id
   * and text here before the draft clears, so a reload or a killed app mid-send
   * replays the SAME request (the server answers it once) instead of the athlete
   * retyping and logging the meal twice. Text only — never image bytes — and it
   * expires with the composer's own window. Every storage access is guarded.
   */
  function retryStore(): NonNullable<FoodComposerDeps["retryStore"]> {
    const KEY = "cairn.fuelLogRetry.v1";
    const clearRetry = (): void => {
      try {
        localStorage.removeItem(KEY);
      } catch {
        /* a retry envelope is a convenience */
      }
    };
    const valid = (value: unknown): FoodComposerRetryEnvelope | null => {
      const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
      const requestId = String(v.requestId ?? "")
        .trim()
        .slice(0, 160);
      const text = String(v.text ?? "").slice(0, 12_000);
      const expiresAt = Number(v.expiresAt);
      const hasImage = v.hasImage === true;
      if (!requestId || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || (!text && !hasImage)) return null;
      return { requestId, text, hasImage, expiresAt };
    };
    return {
      loadRetry: () => {
        try {
          const raw = localStorage.getItem(KEY);
          const retry = raw ? valid(JSON.parse(raw)) : null;
          if (raw && !retry) clearRetry();
          return retry;
        } catch {
          clearRetry();
          return null;
        }
      },
      saveRetry: (value) => {
        const retry = valid(value);
        if (!retry) return clearRetry();
        try {
          localStorage.setItem(KEY, JSON.stringify(retry));
        } catch {
          /* a retry envelope is a convenience */
        }
      },
      clearRetry,
    };
  }

  function today(date: string, todayIso: string): ClientFuelTodayDeps {
    return { ...swr(), date, today: todayIso, runCountUps: (scope) => runCountUps(scope) };
  }

  function meals(date: string, todayIso: string, token: number, onChanged: () => void): ClientFuelMealsDeps {
    return {
      ...swr(),
      date,
      today: todayIso,
      api: (path, init) => api(path, init),
      toast: (message) => toast(message),
      expandEl: (el) => expandEl(el),
      collapseEl: (el, done) => collapseEl(el, done),
      armDelete: (btn, onConfirm, options) => armDelete(btn, onConfirm, options),
      // SSE-first, poll fallback (pollEnrichment); its own stale-tab guard means the
      // settle never fires into a surface the athlete has left. The watch ends ONCE:
      // on the settling update, or when the watcher resolves without one (the poll
      // fallback caps out while an agent is still estimating), so the meals slot
      // re-reads and can watch again rather than sitting on "estimating…".
      watchEnrichment: (id, settled) => {
        let done = false;
        const end = (): void => {
          if (done) return;
          done = true;
          settled();
        };
        void pollEnrichment("/food-notes", id, {
          tab: "plan",
          token,
          onUpdate: (row) => {
            if (!enrichmentActive(row.enrichment_status)) end();
          },
        })
          .catch(() => null)
          .then(end);
      },
      onChanged,
    };
  }

  function log(onLogged: (logged: FoodComposerLogged) => void): ClientFuelLogDeps {
    return {
      mountComposer: (host, deps) => CairnFoodComposer.mount(host, deps),
      api: (path, init) => api(path, init),
      toast: (message) => toast(message),
      reducedMotion: () => reducedMotion(),
      hour,
      draft: draft(),
      retryStore: retryStore(),
      onLogged,
    };
  }

  function ideas(date: string, onStart: ClientIdeaCardDeps["onStart"]): ClientIdeaCardDeps {
    return {
      ...swr(),
      date,
      api: (path, init) => api(path, init),
      hour,
      skeleton: () => skelLines(2),
      onStart,
    };
  }

  const CAIRN_FUEL_DEPS = { draft, retryStore, today, meals, log, ideas };

  Object.assign(globalThis, { CairnFuelDeps: CAIRN_FUEL_DEPS });
}
