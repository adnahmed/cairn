// @ts-check
// The Horizon timeline, the controller (docs/V2-PLAN.md wave 5). `mount(host, deps)`
// fills the shell's three lane slots. Each lane reads on its own and paints the moment
// its reads land, so a slow health read never holds the race lane back; a failed read
// is that lane's one calm sentence, never the whole screen. A tap on a row or a link
// follows the model's route through `deps.navigate` (the app's own router), so a lab
// row opens You's Health pages, which load their lazy bundle on arrival. Nothing here
// computes a week, a fit, a due date or a staleness; the reads own those.
{
  type Deps = ClientHorizonDeps;
  type Lane = ClientHorizonLane;

  function modified(event: Event): boolean {
    const e = event as MouseEvent;
    return !!(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || (typeof e.button === "number" && e.button !== 0));
  }

  /**
   * The view the athlete last picked, for this app session. Unpicked, Horizon opens on
   * the race build, and steps to the season on its own when no race is set.
   */
  let chosenView: ClientHorizonView | null = null;

  function mountHorizon(host: Element, deps: Deps): () => void {
    let live = true;
    const lanes = new Map<Lane["key"], Lane>();
    let seasonMarkup: string | null = null;

    function setView(view: ClientHorizonView): void {
      host.setAttribute("data-horizon-view", view);
      for (const btn of Array.from(host.querySelectorAll<HTMLElement>("[data-horizon-seg]"))) {
        const on = btn.getAttribute("data-horizon-seg") === view;
        btn.classList.toggle("active", on);
        btn.setAttribute("aria-selected", String(on));
      }
      for (const panel of Array.from(host.querySelectorAll<HTMLElement>("[data-horizon-panel]"))) {
        panel.hidden = panel.getAttribute("data-horizon-panel") !== view;
      }
    }

    /** Draw the season line into the goal line's held slot, or let the slot go. */
    function fillSeason(): void {
      if (seasonMarkup == null) return;
      const slot = host.querySelector<HTMLElement>("[data-horizon-season]");
      if (!slot) return;
      if (!seasonMarkup) {
        slot.remove();
        return;
      }
      slot.innerHTML = seasonMarkup;
      slot.classList.remove("is-pending");
      slot.removeAttribute("aria-busy");
    }
    const calm = (): boolean => (typeof deps.reducedMotion === "function" ? deps.reducedMotion() : false);
    const read = (path: string): Promise<unknown> =>
      Promise.resolve()
        .then(() => deps.load(path))
        .catch(() => null);

    function paint(lane: Lane): void {
      if (!live || !host.isConnected) return;
      const slot = host.querySelector(`[data-horizon-lane="${lane.key}"]`);
      if (!slot) return;
      lanes.set(lane.key, lane);
      slot.innerHTML = CairnHorizon.laneHtml(lane, { enter: !calm(), hrefFor: deps.hrefFor });
      if (lane.key === "goal") fillSeason();
      if (lane.key === "race" && lane.state === "none" && !chosenView) setView("season");
    }

    function targetFor(key: string): ClientHorizonTarget | null {
      const [laneKey, kind, index] = key.split(":");
      const lane = lanes.get(laneKey as Lane["key"]);
      const i = Number(index);
      if (!lane || !Number.isInteger(i)) return null;
      if (kind === "row") return lane.rows[i]?.target || null;
      if (kind === "link") return lane.links[i]?.target || null;
      return null;
    }

    function load(): void {
      const today = deps.today;
      const model = CairnHorizonModel;
      const timeline = read("/journey/timeline");
      const docs = read("/health-docs");
      const checkup = read("/health/next-checkup");
      void read("/race-build").then((build) => paint(model.raceLane(build)));
      void Promise.all([read("/journey"), timeline]).then(([journey, rows]) =>
        paint(model.goalLane(journey, rows, today))
      );
      void Promise.all([docs, checkup, timeline]).then(([docRows, checkupRead, rows]) =>
        paint(model.labsLane(docRows, checkupRead, rows, today))
      );
      void Promise.all([read("/nutrition/goal-pace?days=180"), timeline, docs, checkup]).then(
        ([pace, rows, docRows, checkupRead]) => {
          if (!live || !host.isConnected) return;
          seasonMarkup = CairnHorizon.seasonHtml(model.season(pace, rows, docRows, checkupRead, today));
          fillSeason();
        }
      );
    }

    return CairnUiActions.mount(host, "horizon", ({ delegate }) => {
      delegate("click", {
        "horizon-seg": (el) => {
          const view = el.getAttribute("data-horizon-seg") === "season" ? "season" : "race";
          chosenView = view;
          setView(view);
        },
        "horizon-go": (el, event) => {
          if (modified(event)) return;
          const target = targetFor(el.getAttribute("data-horizon-go") || "");
          if (!target) return;
          event.preventDefault();
          deps.navigate(target);
        },
      });
      if (chosenView) setView(chosenView);
      load();
      return () => {
        live = false;
      };
    });
  }

  const CAIRN_HORIZON_CONTROLLER = { mount: mountHorizon };

  Object.assign(globalThis, { CairnHorizonController: CAIRN_HORIZON_CONTROLLER });
}
