// @ts-check
// Fuel — today so far, the controller (docs/V2-PLAN.md wave 2, "fuel-today").
// `mount(host, deps)` paints the day (GET /api/nutrition/day) and the observed intake
// band (GET /api/nutrition/intake-band) into `host`: instantly from the SWR cache when
// there is a last-known read, the shimmer only on a true cold start, then the network
// answer — repainted only when what the card prints actually changed. `refresh()`
// re-reads after a log or a correction elsewhere on the surface. Idempotent per host
// through CairnUiActions.mount; the teardown stops every pending paint.
{
  type Deps = ClientFuelTodayDeps;

  const dayKey = (date: string): string => `food:day:${date}`;
  const bandKey = (date: string): string => `fuel:band:${date}`;
  const dayPath = (date: string): string => `/nutrition/day?date=${encodeURIComponent(date)}`;
  const bandPath = (date: string): string => `/nutrition/intake-band?date=${encodeURIComponent(date)}`;

  function isDay(value: unknown): boolean {
    return !!value && typeof value === "object" && Array.isArray((value as { entries?: unknown }).entries);
  }

  function isBand(value: unknown): boolean {
    return !!value && typeof value === "object" && (value as { kind?: unknown }).kind === "observation";
  }

  function mountFuelToday(host: Element, deps: Deps): ClientFuelRefreshHandle {
    let generation = 0;
    let day: unknown = null;
    let band: unknown = null;
    let painted = "";
    let counted = false;
    let refreshing = false;

    const live = (gen: number): boolean => gen === generation && host.isConnected;
    const setRefreshing = (on: boolean): void => {
      if (refreshing === on) return;
      refreshing = on;
      deps.markRefreshing?.(on);
    };

    // Paint only when what the card prints changed; the first paint of a mount counts
    // its numerals up (unless motion is reduced), a later one snaps in place.
    function paint(): void {
      if (!isDay(day)) return;
      const model = CairnFuelTodayModel.todayModel(day, band, { today: deps.today });
      const sig = JSON.stringify(model);
      if (sig === painted) return;
      painted = sig;
      const countUp = !counted && !deps.reducedMotion();
      host.innerHTML = CairnFuelToday.todayHtml(model, { countUp });
      if (countUp) deps.runCountUps?.(host);
      counted = true;
    }

    function load(): Promise<void> {
      const gen = ++generation;
      const warmDay = deps.peekCached<unknown>(dayKey(deps.date));
      const warmBand = deps.peekCached<unknown>(bandKey(deps.date));
      if (warmBand && isBand(warmBand.data)) band = warmBand.data;
      if (warmDay && isDay(warmDay.data)) {
        day = warmDay.data;
        paint();
        setRefreshing(!warmDay.fresh);
      } else if (!isDay(day)) {
        host.innerHTML = deps.skeleton ? deps.skeleton() : CairnFuelToday.skeletonHtml();
      }
      // The band is an observation over weeks: it only frames the card, so a failed
      // read leaves the numbers standing and says nothing.
      const bandRead = deps
        .cachedApi(bandPath(deps.date), { key: bandKey(deps.date) })
        .then((data) => {
          if (!live(gen) || !isBand(data)) return;
          band = data;
          paint();
        })
        .catch(() => {});
      const dayRead = deps
        .cachedApi(dayPath(deps.date), { key: dayKey(deps.date) })
        .then((data) => {
          if (gen === generation) setRefreshing(false);
          if (!live(gen) || !isDay(data)) return;
          day = data;
          paint();
        })
        .catch(() => {
          if (gen === generation) setRefreshing(false);
          if (live(gen) && !isDay(day)) {
            painted = "";
            host.innerHTML = CairnFuelToday.errorHtml();
          }
        });
      return Promise.all([bandRead, dayRead]).then(() => undefined);
    }

    function refresh(): Promise<void> {
      deps.swrInvalidate(dayKey(deps.date));
      return load();
    }

    const teardown = CairnUiActions.mount(host, "fuel-today", ({ delegate }) => {
      delegate("click", { "fuel-today-retry": () => void load() });
      void load();
      return () => {
        generation++;
        setRefreshing(false);
      };
    });
    return Object.assign(teardown, { refresh });
  }

  const CAIRN_FUEL_TODAY_CONTROLLER = {
    dayKey,
    bandKey,
    dayPath,
    bandPath,
    mount: mountFuelToday,
  };

  Object.assign(globalThis, { CairnFuelTodayController: CAIRN_FUEL_TODAY_CONTROLLER });
}
