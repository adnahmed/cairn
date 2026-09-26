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
      // settle never fires into a surface the athlete has left.
      watchEnrichment: (id, settled) => {
        let done = false;
        void pollEnrichment("/food-notes", id, {
          tab: "plan",
          token,
          onUpdate: (row) => {
            if (done || enrichmentActive(row.enrichment_status)) return;
            done = true;
            settled();
          },
        });
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

  const CAIRN_FUEL_DEPS = { draft, today, meals, log, ideas };

  Object.assign(globalThis, { CairnFuelDeps: CAIRN_FUEL_DEPS });
}
