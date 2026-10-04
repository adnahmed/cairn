// @ts-check
// Mounts the Path card (CairnTodayPath) into the slot the Brief owns. Reads
// GET /api/today-path through the SWR cache, so a warm Today paints the card at
// once and a revalidation only repaints when the read actually moved. The card is
// optional: a cold miss or a failed read leaves the slot empty (it collapses).
// The walked trail draws in on the FIRST paint only; a repaint of the same card,
// or a warm paint, is quiet (`tpath-quiet`), so the trail never replays.
// The card's "All goals" link opens Horizon's goal line through `openGoals` (the app's
// own tab switch); a modified click keeps the link's real href. Idempotent per host
// (CairnUiActions.mount): a re-mount replaces the last one's listener and stale load.
{
  type TodayPathRead = import("../contracts/today-path.js").TodayPath;
  type TodayPathDeps = {
    date: string;
    peek(key: string): { data: TodayPathRead; fresh: boolean } | null;
    load(path: string, options: { key: string }): Promise<TodayPathRead>;
    /** Open Horizon's goal line (the "All goals" link); without it the link navigates by its href. */
    openGoals?(): void;
  };

  function modifiedClick(event: Event): boolean {
    const e = event as MouseEvent;
    return !!(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || (typeof e.button === "number" && e.button !== 0));
  }

  function pathKey(date: string): string {
    return `today:path:${date}`;
  }

  function pathPath(date: string): string {
    return `/today-path?date=${encodeURIComponent(date)}`;
  }

  function mountPath(host: Element, deps: TodayPathDeps): () => void {
    return CairnUiActions.mount(host, "today-path", ({ delegate }) => {
      delegate("click", {
        "tpath-goals": (_el, event) => {
          if (!deps.openGoals || modifiedClick(event)) return;
          event.preventDefault();
          deps.openGoals();
        },
      });
      return paintPath(host, deps);
    });
  }

  // Paints the card and keeps it current; returns what stops it.
  function paintPath(host: Element, deps: TodayPathDeps): () => void {
    let live = true;
    let painted = "";

    function paint(read: TodayPathRead | null | undefined, animate: boolean): void {
      if (!live || !host.isConnected) return;
      const html = CairnTodayPath.cardHtml(read);
      if (html === painted) return;
      // Already showing a card (a held copy or a warm paint): a changed read settles
      // without replaying the trail.
      const quiet = !animate || !!painted || !!host.querySelector(".tpath");
      painted = html;
      host.innerHTML = html;
      host.classList.toggle("tpath-quiet", quiet);
    }

    const key = pathKey(deps.date);
    const warm = deps.peek(key);
    if (warm) paint(warm.data, false);
    deps
      .load(pathPath(deps.date), { key })
      .then((read) => paint(read, true))
      .catch(() => {});
    return () => {
      live = false;
    };
  }

  const CAIRN_TODAY_PATH_CONTROLLER = { key: pathKey, path: pathPath, mount: mountPath };

  Object.assign(globalThis, { CairnTodayPathController: CAIRN_TODAY_PATH_CONTROLLER });
}
