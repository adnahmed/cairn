// @ts-check
// The cairn-stack, the controller (docs/V2-PLAN.md wave 5). `mount(host, deps)` reads
// GET /api/today/stones through the SWR cache, under the same key the pebble strip
// uses, so a morning that already opened Today paints You at once. A cold cache shows
// the stack's skeleton, and the revalidation repaints only when the stones actually
// changed. The stack is optional: a read that fails with nothing painted collapses
// the slot (never an error line, never a retry to tap), and a failed revalidation
// leaves the last-known stack standing. A stone tap opens that stone's detail; a
// modified click keeps the link's native behaviour.
{
  type Deps = ClientCairnStackDeps;

  // Dates whose stack has already settled in this page's life. The entrance plays
  // once per morning, never again on a return to the You landing.
  const settled = new Set<string>();

  function signature(model: ClientCairnStackModel | null): string {
    return model ? JSON.stringify(model.stones) : "";
  }

  function modified(event: Event): boolean {
    const e = event as MouseEvent;
    return !!(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || (typeof e.button === "number" && e.button !== 0));
  }

  function mountCairnStack(host: Element, deps: Deps): () => void {
    const date = deps.date;
    const key = CairnStackModel.keyFor(date);
    let live = true;
    let real = false;
    let painted: string | null = null;
    let current: ClientCairnStackModel | null = null;

    function paint(read: ClientStonesRead | null | undefined): void {
      if (!live || !host.isConnected) return;
      const model = CairnStackModel.model(read, { hrefFor: deps.hrefFor });
      const sig = signature(model);
      real = true;
      if (sig === painted) return;
      const shown = model && model.stones.length ? model : null;
      const enter = !!shown && !settled.has(date) && !deps.reducedMotion();
      if (shown) settled.add(date);
      host.innerHTML = CairnStack.html(shown, { enter });
      painted = sig;
      current = shown;
    }

    const warm = deps.peek(key);
    if (warm && warm.data) paint(warm.data);
    else host.innerHTML = CairnStack.skeletonHtml();

    deps
      .load(CairnStackModel.pathFor(date), { key })
      .then((read) => paint(read))
      .catch(() => {
        if (live && host.isConnected && !real) host.innerHTML = "";
      });

    return CairnUiActions.mount(host, "cairn-stack", ({ delegate }) => {
      delegate("click", {
        "cairn-stack-go": (el, event) => {
          if (modified(event)) return;
          const stone = current?.stones.find((s) => s.key === el.getAttribute("data-cairn-stack-go"));
          if (!stone) return;
          event.preventDefault();
          deps.openStone(stone.key);
        },
      });
      return () => {
        live = false;
      };
    });
  }

  const CAIRN_STACK_CONTROLLER: Window["CairnStackController"] = { mount: mountCairnStack };

  Object.assign(globalThis, { CairnStackController: CAIRN_STACK_CONTROLLER });
}
