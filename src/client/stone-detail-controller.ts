// @ts-check
// The stone detail, the controller (docs/V2-PLAN.md wave 5). `mount(host, deps)`
// paints the detail at once — the step back, the stone's name and its homes need no
// read — and fills the stone's word and line from GET /api/today/stones through the
// SWR cache the cairn-stack and the pebble strip share. A failed read leaves the
// name and the homes standing with no error line; a revalidation repaints only when
// the stone itself changed. A home tap opens that surface; a modified click keeps
// the link's native behaviour.
{
  type Deps = ClientStoneDetailDeps;

  // Stones that have already settled in this page's life: the entrance plays on the
  // first open of a stone, never again on a return to it.
  const settled = new Set<string>();

  function modified(event: Event): boolean {
    const e = event as MouseEvent;
    return !!(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || (typeof e.button === "number" && e.button !== 0));
  }

  function mountStoneDetail(host: Element, deps: Deps): () => void {
    const date = deps.date;
    const key = CairnStackModel.keyFor(date);
    const settleKey = `${date}:${deps.stone}`;
    let live = true;
    let painted: string | null = null;
    let current: ClientStoneDetailModel | null = null;

    // The open stone's chip is always in view, even when it sits past the phone's edge.
    function revealChip(): void {
      const strip = host.querySelector<HTMLElement>(".stone-detail-chips");
      const chip = strip?.querySelector<HTMLElement>('[aria-current="page"]');
      if (!strip || !chip || typeof chip.offsetLeft !== "number") return;
      const over = chip.offsetLeft + chip.offsetWidth - (strip.scrollLeft + strip.clientWidth);
      if (over > 0) strip.scrollLeft = chip.offsetLeft - 16;
    }

    function paint(read: ClientStonesRead | null | undefined, loading: boolean): void {
      if (!live || !host.isConnected) return;
      const model = CairnStoneDetailModel.model(deps.stone, read, { hrefFor: deps.hrefFor });
      if (!model) return;
      deps.setTitle?.(model.name);
      const sig = JSON.stringify([model.stone, loading]);
      if (sig === painted) return;
      // The stone settles once, when it first shows its own tone.
      const enter = !!model.stone && !settled.has(settleKey) && !deps.reducedMotion();
      if (model.stone) settled.add(settleKey);
      host.innerHTML = CairnStoneDetail.html(model, { enter, loading });
      revealChip();
      painted = sig;
      current = model;
    }

    const warm = deps.peek(key);
    paint(warm && warm.data ? warm.data : null, !(warm && warm.data));

    deps
      .load(CairnStackModel.pathFor(date), { key })
      .then((read) => paint(read, false))
      .catch(() => {
        // Nothing to say without the read: drop the ghost, keep the name and homes.
        if (!current?.stone) paint(null, false);
      });

    return CairnUiActions.mount(host, "stone-detail", ({ delegate }) => {
      delegate("click", {
        "stone-detail-go": (el, event) => {
          if (modified(event)) return;
          const link = current?.links.find((l) => l.key === el.getAttribute("data-stone-detail-go"));
          if (!link) return;
          event.preventDefault();
          deps.navigate(link.target);
        },
        "stone-detail-open": (el, event) => {
          const next = el.getAttribute("data-stone-detail-open") || "";
          if (!CairnStoneDetailModel.isStone(next) || next === deps.stone) return;
          event.preventDefault();
          deps.navigate({ tab: "you", section: "stone", id: next });
        },
        "home-back": (_el, event) => {
          event.preventDefault();
          deps.back();
        },
      });
      return () => {
        live = false;
      };
    });
  }

  const CAIRN_STONE_DETAIL_CONTROLLER: Window["CairnStoneDetailController"] = { mount: mountStoneDetail };

  Object.assign(globalThis, { CairnStoneDetailController: CAIRN_STONE_DETAIL_CONTROLLER });
}
