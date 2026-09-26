// @ts-check
// The pebble strip, the controller (docs/V2-PLAN.md wave 4). `mount(host, deps)` reads
// GET /api/today/stones through the SWR cache: a warm cache paints at once, a cold one
// shows the strip's skeleton, and the revalidation repaints only when the pebbles
// actually changed. The strip is optional: a read that fails with nothing painted
// collapses the slot (never an error line, never a retry to tap), and a failed
// revalidation leaves the last-known strip standing. A pebble tap follows the
// server's own target; a modified click keeps the link's native behaviour.
//
// `mountToday(root, deps)` is the Today screen's one mount: it makes the strip's slot
// directly under the Brief (the Brief still leads) and builds the deps from the shell.
{
  type StonesRead = import("../contracts/today-stones.js").TodayStonesRead;
  type StoneTarget = import("../contracts/today-stones.js").TodayStoneTarget;
  type Deps = ClientPebbleStripDeps;

  const KEY_PREFIX = "today:stones:";
  const PATH = "/today/stones";

  // Dates whose strip has already settled in this page's life. The entrance plays
  // once per morning, never again on a soft repaint that rebuilds the Today column.
  const settled = new Set<string>();

  const keyFor = (date: string): string => `${KEY_PREFIX}${date}`;
  const pathFor = (date: string): string => `${PATH}?date=${encodeURIComponent(date)}`;

  function signature(model: ClientPebbleStripModel | null): string {
    return model ? JSON.stringify(model.pebbles) : "";
  }

  function modified(event: Event): boolean {
    const e = event as MouseEvent;
    return !!(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || (typeof e.button === "number" && e.button !== 0));
  }

  function mountPebbleStrip(host: Element, deps: Deps): () => void {
    const date = deps.date;
    const key = keyFor(date);
    let live = true;
    let real = false;
    let painted: string | null = null;
    let current: ClientPebbleStripModel | null = null;

    function paint(read: StonesRead | null | undefined): void {
      if (!live || !host.isConnected) return;
      const model = CairnPebbleStripModel.model(read, { hrefFor: deps.hrefFor });
      const sig = signature(model);
      real = true;
      if (sig === painted) return;
      const shown = model && model.pebbles.length ? model : null;
      const enter = !!shown && !settled.has(date) && !deps.reducedMotion();
      if (shown) settled.add(date);
      host.innerHTML = CairnPebbleStrip.html(shown, { enter });
      painted = sig;
      current = shown;
    }

    const warm = deps.peek(key);
    if (warm && warm.data) paint(warm.data);
    else host.innerHTML = CairnPebbleStrip.skeletonHtml();

    deps
      .load(pathFor(date), { key })
      .then((read) => paint(read))
      .catch(() => {
        if (live && host.isConnected && !real) host.innerHTML = "";
      });

    return CairnUiActions.mount(host, "pebble-strip", ({ delegate }) => {
      delegate("click", {
        "pebble-strip-go": (el, event) => {
          if (modified(event)) return;
          const pebble = current?.pebbles.find((p) => p.key === el.getAttribute("data-pebble-strip-go"));
          if (!pebble || !pebble.target) return;
          event.preventDefault();
          deps.navigate(pebble.target);
        },
      });
      return () => {
        live = false;
      };
    });
  }

  function hrefFor(target: StoneTarget): string | null {
    const routes = typeof routeApi === "function" ? routeApi() : null;
    return routes ? routes.routeToUrl({ tab: target.tab, section: target.section }) : null;
  }

  // The slot sits directly under the Brief, made here so a render that rebuilt the
  // column gets a fresh one; the component mounts into it and never looks outside it.
  // Where the strip stands: between the Brief's voice and its NOW card (the reference
  // order — voice, stones, what's next), or right under a Brief that carries no NOW.
  // Moves the node only when it is not already there, so a soft repaint never
  // re-inserts it (a re-insert would replay its entrance).
  function placeStrip(brief: Element, slot: Element): void {
    const now = brief.querySelector(".brief-now");
    const anchor = now && now.parentNode ? now : null;
    if (anchor) {
      if ((slot as Element & { nextElementSibling?: Element | null }).nextElementSibling !== anchor || slot.parentNode !== anchor.parentNode)
        anchor.parentNode!.insertBefore(slot, anchor);
      return;
    }
    const after = (brief as Element & { nextElementSibling?: Element | null }).nextElementSibling;
    if (after !== slot || slot.parentNode !== brief.parentNode) brief.after(slot);
  }

  function mountToday(root: ParentNode, deps: ClientPebbleStripTodayDeps): () => void {
    const brief = root.querySelector(".brief");
    const parent = brief?.parentNode;
    if (!brief || !parent || !deps.state.logDate) return () => {};
    let slot = root.querySelector("#pebbleStripSlot");
    if (!slot) {
      slot = brief.ownerDocument.createElement("div");
      slot.id = "pebbleStripSlot";
      slot.className = "pebble-strip-slot";
      // It lives inside the Brief's polite live region: stones mounting are not news.
      slot.setAttribute("aria-live", "off");
    }
    placeStrip(brief, slot);
    return mountPebbleStrip(slot, {
      date: deps.state.logDate,
      peek: (key) => peekCached<StonesRead>(key),
      load: (path, options) => cachedApi(path as `${typeof PATH}?date=${string}`, options),
      reducedMotion: () => reducedMotion(),
      hrefFor,
      navigate: (target: StoneTarget) => {
        const tab = applyRouteState({
          tab: target.tab,
          section: target.section,
          healthSection: null,
          date: null,
          id: null,
          session: null,
          jump: null,
        });
        deps.activateTab(tab);
      },
    });
  }

  const CAIRN_PEBBLE_STRIP_CONTROLLER = {
    keyFor,
    pathFor,
    mount: mountPebbleStrip,
    mountToday,
    place: placeStrip,
  };

  Object.assign(globalThis, { CairnPebbleStripController: CAIRN_PEBBLE_STRIP_CONTROLLER });
}
