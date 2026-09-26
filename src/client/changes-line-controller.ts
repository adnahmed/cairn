// @ts-check
// Mounts the Today changes line (CairnChangesLine) into a slot the screen owns.
// Reads GET /api/brain/changes through the SWR cache, so a warm Today paints the
// line at once and the revalidation only upgrades it when the payload moved. The
// line is optional: a cold miss or a failed read leaves the slot empty (it
// collapses), never an error. A tap hands off to the Changes feed through `open`.
{
  type ChangesLineRead = import("../contracts/brain-changes.js").ClientBrainChanges;
  type ChangesLinePeek = { data: ChangesLineRead; fresh: boolean } | null;
  type ChangesLineDeps = {
    /** Last-known read for `key` without a request (`peekCached`). */
    peek(key: string): ChangesLinePeek;
    /** SWR read (`cachedApi`): resolves the fresh read, or the cached one when offline. */
    load(path: "/brain/changes", options: { key: string }): Promise<ChangesLineRead>;
    /** Open the Changes feed. */
    open(): void;
    reducedMotion(): boolean;
  };

  /** The one path and cache key for the feed read — the feed and this line share it. */
  const CHANGES_PATH = "/brain/changes" as const;
  const CHANGES_KEY = "brain:changes";

  // Ids of the new rows on the line the athlete last tapped. Until the server's own
  // count moves past them, a stale cached read of that same news never repaints it.
  let opened = new Set<number>();

  function alreadyOpened(ids: number[]): boolean {
    return ids.length > 0 && ids.every((id) => opened.has(id));
  }

  function mountChangesLine(host: Element, deps: ChangesLineDeps): () => void {
    let live = true;
    let painted = "";
    let ids: number[] = [];

    function paint(read: ChangesLineRead | null | undefined, fromNetwork: boolean): void {
      if (!live || !host.isConnected) return;
      const model = CairnChangesLine.model(read);
      const shown = model && !alreadyOpened(model.ids) ? model : null;
      const line = shown ? shown.line : "";
      ids = shown ? shown.ids : [];
      if (line === painted) return;
      // One entrance, and only for news that arrived while Today was open — a warm
      // repaint of a line already on screen never re-animates.
      const enter = fromNetwork && !painted && !deps.reducedMotion();
      host.innerHTML = CairnChangesLine.html(shown, { enter });
      painted = line;
    }

    const warm = deps.peek(CHANGES_KEY);
    if (warm) paint(warm.data, false);
    deps
      .load(CHANGES_PATH, { key: CHANGES_KEY })
      .then((read) => paint(read, true))
      .catch(() => {});

    return CairnUiActions.mount(host, "changes-line", ({ delegate }) => {
      delegate("click", {
        "changes-line-open": () => {
          opened = new Set(ids);
          painted = "";
          host.innerHTML = "";
          deps.open();
        },
      });
      return () => {
        live = false;
      };
    });
  }

  const CAIRN_CHANGES_LINE_CONTROLLER = {
    key: CHANGES_KEY,
    path: CHANGES_PATH,
    mount: mountChangesLine,
  };

  Object.assign(globalThis, { CairnChangesLineController: CAIRN_CHANGES_LINE_CONTROLLER });
}
