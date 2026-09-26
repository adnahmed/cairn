// @ts-check
// The Changes feed controller (docs/V2-PLAN.md wave 1). `mountChangesFeed(host, deps)`
// paints GET /api/brain/changes into `host` — instantly from the SWR cache when there
// is a last-known read, a skeleton only on a true cold start — revalidates in the
// background, and tells the server the feed was opened (POST /api/brain/changes/seen,
// which is what the Today line counts from). Undo and Hold go through the shared
// decision-undo primitive; afterwards only the rows the server changed are repainted.
// Idempotent per host through CairnUiActions.mount; returns the teardown.
{
  type BrainChanges = import("../contracts/brain-changes.js").ClientBrainChanges;
  type BrainChange = import("../contracts/brain-changes.js").ClientBrainChange;

  // The deps shape is declared once, in src/contracts/client-globals.d.ts.
  type ChangesFeedDeps = ClientChangesFeedDeps;

  const KEY = "brain:changes";
  const PATH = "/brain/changes";

  const COPY: Record<string, ClientDecisionUndoCopy> = {
    "chfeed-undo": {
      reason: "undo from the Changes feed",
      success: "Put back",
      stale: "That change can no longer be undone.",
      failed: "Could not undo that change",
    },
    "chfeed-hold": {
      reason: "hold from the Changes feed",
      success: "Held — it won't land",
      stale: "That change can no longer be held.",
      failed: "Could not hold that change",
    },
  };

  type FlatRow = { day: string; change: BrainChange };

  function isChanges(value: unknown): value is BrainChanges {
    return !!value && typeof value === "object" && Array.isArray((value as BrainChanges).days);
  }

  function flatten(data: BrainChanges | null): FlatRow[] {
    const out: FlatRow[] = [];
    for (const day of data?.days || []) {
      for (const change of Array.isArray(day.changes) ? day.changes : []) out.push({ day: day.day, change });
    }
    return out;
  }

  // What a row shows, minus `new`: the seen marker moves while the athlete reads, and a
  // row that merely stopped being new is not a row that changed.
  function rowSignature(change: BrainChange): string {
    const { new: _fresh, ...rest } = change;
    return JSON.stringify(rest);
  }

  function shape(rows: FlatRow[]): string {
    return rows.map((row) => `${row.day}:${row.change.id}`).join(",");
  }

  function mountChangesFeed(host: Element, deps: ChangesFeedDeps): () => void {
    let current: BrainChanges | null = null;
    let generation = 0;
    let refreshing = false;

    const live = (gen: number): boolean => gen === generation && host.isConnected;
    const setRefreshing = (on: boolean): void => {
      if (refreshing === on) return;
      refreshing = on;
      deps.markRefreshing?.(on);
    };
    const rowEl = (id: unknown): HTMLElement | null =>
      host.querySelector<HTMLElement>(`[data-chfeed-id="${Number(id)}"]`);

    function paint(data: BrainChanges, reveal: boolean): void {
      current = data;
      host.innerHTML = CairnChangesFeed.feedHtml(data, { reveal });
    }

    function settle(el: Element | null): void {
      if (el && !deps.reducedMotion()) el.classList.add("is-settled");
    }

    // Opening the feed is the seen marker. `through` is the read's own instant, so a
    // change that lands while the athlete reads stays new. The cached read is then
    // replaced by the server's seen state — the Today line and the next open agree —
    // without repainting the rows (this visit keeps its "New" marks).
    async function markSeen(data: BrainChanges): Promise<void> {
      if (!(Number(data.since_seen) > 0)) return;
      try {
        const result = (await deps.api("/brain/changes/seen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ through: data.seen_through }),
        })) as { ok?: unknown } | null;
        if (!result || result.ok !== true) return;
        deps.swrInvalidate(KEY);
        await deps.cachedApi(PATH, { key: KEY });
      } catch {
        // The marker is a convenience; the feed itself is already painted.
      }
    }

    function load(): Promise<void> {
      const gen = ++generation;
      const peek = deps.peekCached<BrainChanges>(KEY);
      const warm = peek && isChanges(peek.data) ? peek : null;
      if (warm) {
        paint(warm.data, true);
        setRefreshing(!warm.fresh);
      } else {
        current = null;
        host.innerHTML = deps.skeleton ? deps.skeleton() : "";
      }
      return deps
        .cachedApi(PATH, {
          key: KEY,
          onUpgrade: (data, { changed }) => {
            if (!live(gen) || !isChanges(data)) return;
            if (changed || !warm) paint(data, !warm);
          },
        })
        .then((data) => {
          if (gen === generation) setRefreshing(false);
          if (!live(gen) || !isChanges(data)) return;
          if (!current) paint(data, true);
          void markSeen(data);
        })
        .catch(() => {
          if (gen === generation) setRefreshing(false);
          if (live(gen) && !warm) host.innerHTML = CairnChangesFeed.errorHtml();
        });
    }

    function leave(el: HTMLElement): void {
      const done = (): void => {
        const day = el.closest(".chfeed-day");
        el.remove();
        if (day && !day.querySelector(".chfeed-row")) day.remove();
      };
      if (deps.collapse && !deps.reducedMotion()) deps.collapse(el, done);
      else done();
    }

    // Repaint only what the server changed. Rows keep their place when the ids and
    // days line up (after the departed rows leave); anything else — a row arriving, a
    // day moving — repaints the list without the entrance stagger.
    function reconcile(next: BrainChanges, touched: number): void {
      const before = flatten(current);
      const after = flatten(next);
      const nextIds = new Set(after.map((row) => Number(row.change.id)));
      const kept = before.filter((row) => nextIds.has(Number(row.change.id)));
      if (!after.length || shape(kept) !== shape(after)) {
        paint(next, false);
        settle(rowEl(touched));
        return;
      }
      const prior = new Map(before.map((row) => [Number(row.change.id), row.change]));
      current = next;
      for (const row of before) {
        if (nextIds.has(Number(row.change.id))) continue;
        const el = rowEl(row.change.id);
        if (el) leave(el);
      }
      for (const row of after) {
        const id = Number(row.change.id);
        const was = prior.get(id);
        if (!was || rowSignature(was) === rowSignature(row.change)) continue;
        const el = rowEl(id);
        if (!el) continue;
        // This visit's "New" mark stays put; the server's seen marker already moved.
        el.outerHTML = CairnChangesFeed.rowHtml({ ...row.change, new: was.new });
        if (id === touched) settle(rowEl(id));
      }
    }

    async function afterRevert(id: number): Promise<void> {
      deps.swrInvalidate(KEY);
      let next: unknown;
      try {
        next = await deps.cachedApi(PATH, { key: KEY });
      } catch {
        return;
      }
      if (host.isConnected && isChanges(next)) reconcile(next, id);
    }

    function revert(el: HTMLElement, attr: string): void {
      const id = Number(el.getAttribute(`data-${attr}`));
      const change = flatten(current).find((row) => Number(row.change.id) === id)?.change ?? null;
      void CairnDecisionUndoController.revert(el, id, deps, {
        ...COPY[attr],
        after: async () => {
          await afterRevert(id);
          await deps.onReverted?.(change);
        },
      });
    }

    const teardown = CairnUiActions.mount(host, "chfeed", ({ delegate }) => {
      delegate("click", {
        "chfeed-undo": (el) => revert(el, "chfeed-undo"),
        "chfeed-hold": (el) => revert(el, "chfeed-hold"),
        "chfeed-retry": () => void load(),
      });
      return () => {
        generation += 1;
        setRefreshing(false);
      };
    });
    void load();
    return teardown;
  }

  const CAIRN_CHANGES_FEED_CONTROLLER = {
    KEY,
    PATH,
    mount: mountChangesFeed,
  };

  Object.assign(globalThis, { CairnChangesFeedController: CAIRN_CHANGES_FEED_CONTROLLER });
}
