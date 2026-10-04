// @ts-check
// The race view, the controller (docs/V2-PLAN.md wave 4). `mount(host, deps)` paints
// the race build into `host`: at once from `deps.initial` when the screen already
// holds GET /api/race-build, else a skeleton while `deps.load()` reads it. An
// unavailable build is the empty state with the server's own reason; a failed read
// is one calm sentence and "Try again". It never computes a week, a kind or a fit —
// raceBuild() owns those — and it never waits on an agent (the read is deterministic).
{
  type Deps = ClientRaceViewDeps;

  function mountRaceView(host: Element, deps: Deps): () => void {
    let generation = 0;
    let painted = false;

    const live = (gen: number): boolean => gen === generation && host.isConnected;
    const calm = (): boolean => (typeof deps.reducedMotion === "function" ? deps.reducedMotion() : false);

    function paint(value: unknown): void {
      const model = CairnRaceViewModel.viewModel(value, { units: deps.units, agenda: deps.agenda ?? null });
      if (!model) {
        const reason = value && typeof value === "object" ? (value as { reason?: unknown }).reason : null;
        host.innerHTML = CairnRaceView.emptyHtml(reason);
      } else {
        host.innerHTML = CairnRaceView.viewHtml(model, {
          enter: !painted && !calm(),
          sessionsHtml: deps.sessionsHtml,
          nextWeekHtml: deps.nextWeekHtml,
          units: deps.units,
        });
      }
      painted = true;
    }

    function isBuild(value: unknown): boolean {
      return !!value && typeof value === "object" && "available" in (value as object);
    }

    function load(): Promise<void> {
      const gen = ++generation;
      if (!painted) host.innerHTML = CairnRaceView.skeletonHtml();
      return Promise.resolve()
        .then(() => deps.load())
        .then((value) => {
          if (!live(gen)) return;
          if (isBuild(value)) paint(value);
          else host.innerHTML = CairnRaceView.errorHtml();
        })
        .catch(() => {
          if (live(gen)) host.innerHTML = CairnRaceView.errorHtml();
        });
    }

    return CairnUiActions.mount(host, "race-view", ({ delegate }) => {
      delegate("click", {
        "race-view-retry": () => {
          painted = false;
          void load();
        },
      });
      if (isBuild(deps.initial)) paint(deps.initial);
      else void load();
      return () => {
        generation++;
      };
    });
  }

  const CAIRN_RACE_VIEW_CONTROLLER = { mount: mountRaceView };

  Object.assign(globalThis, { CairnRaceViewController: CAIRN_RACE_VIEW_CONTROLLER });
}
