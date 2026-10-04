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
  type ReconcileOptions = {
    /** The row the athlete just changed: it washes once when it repaints. */
    touched?: number | null;
    /** Keep this visit's "New" marks (after Undo the server's seen marker has already moved). */
    keepNew?: boolean;
  };

  // The state and status line the server gives a change once it is put back or held
  // (src/domain/brain/changes-feed.ts), used only when the read after a revert fails.
  const REVERTED: Record<string, Pick<BrainChange, "state" | "status_line">> = {
    "chfeed-undo": { state: "reverted", status_line: "Put back" },
    "chfeed-hold": { state: "held", status_line: "Held before it landed" },
  };

  function isChanges(value: unknown): value is BrainChanges {
    return !!value && typeof value === "object" && Array.isArray((value as BrainChanges).days);
  }

  function dayChanges(day: BrainChanges["days"][number]): BrainChange[] {
    return Array.isArray(day.changes) ? day.changes : [];
  }

  function flatten(data: BrainChanges | null): FlatRow[] {
    const out: FlatRow[] = [];
    for (const day of data?.days || []) for (const change of dayChanges(day)) out.push({ day: day.day, change });
    return out;
  }

  /** `data` with each change passed through `fn` (a copy; the cached read is never mutated). */
  function mapChanges(data: BrainChanges, fn: (change: BrainChange) => BrainChange): BrainChanges {
    return { ...data, days: data.days.map((day) => ({ ...day, changes: dayChanges(day).map(fn) })) };
  }

  function fromHtml(html: string): HTMLElement | null {
    if (!html) return null;
    const box = document.createElement("div");
    box.innerHTML = html;
    return box.firstElementChild as HTMLElement | null;
  }

  const leaving = (el: Element): boolean => el.hasAttribute("data-chfeed-leaving");

  // Put `el` right after `prev` (or first) among `parent`'s children that are staying;
  // a node already in place is not touched, so an unchanged feed moves nothing. A
  // move re-inserts the node, which would replay its entrance, so a row that is only
  // changing places drops its entrance class first.
  function placeAfter(parent: Element, el: Element, prev: Element | null): void {
    const kids = Array.from(parent.children).filter((kid) => !leaving(kid));
    const want = prev ? kids.indexOf(prev) + 1 : 0;
    if (kids[want] === el) return;
    if (el.isConnected) el.classList.remove("reveal", "settle-in");
    parent.insertBefore(el, kids[want] ?? null);
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
    // A row still collapsing out keeps its id until it is gone, but is never matched.
    const rowEl = (id: unknown): HTMLElement | null =>
      Array.from(host.querySelectorAll<HTMLElement>(`[data-chfeed-id="${Number(id)}"]`)).find((el) => !leaving(el)) ??
      null;

    function paint(data: BrainChanges, options: { reveal?: boolean; enter?: boolean }): void {
      current = data;
      host.innerHTML = CairnChangesFeed.feedHtml(data, options);
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
        paint(warm.data, { reveal: true });
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
            if (!warm) paint(data, { reveal: true });
            else if (changed) reconcile(data, {});
          },
        })
        .then((data) => {
          if (gen === generation) setRefreshing(false);
          if (!live(gen) || !isChanges(data)) return;
          if (!current) paint(data, { reveal: true });
          void markSeen(data);
        })
        .catch(() => {
          if (gen === generation) setRefreshing(false);
          if (live(gen) && !warm) host.innerHTML = CairnChangesFeed.errorHtml();
        });
    }

    function leave(el: HTMLElement): void {
      // Out of the keyed set at once, so a reconcile during the collapse never finds it.
      el.setAttribute("data-chfeed-leaving", "1");
      const done = (): void => {
        const day = el.closest(".chfeed-day");
        el.remove();
        if (day && !day.querySelector(".chfeed-row")) day.remove();
      };
      if (deps.collapse && !deps.reducedMotion()) deps.collapse(el, done);
      else done();
    }

    // Repaint only what the server changed, keyed by id: every row the next read
    // still lists keeps its node and is moved into the server's order (a put-back or
    // held row re-sorts within its day); only a row whose content changed is
    // re-rendered, a departed row collapses out, and an arriving row settles in.
    // Nothing is full-repainted unless the list had no rows to key against.
    function reconcile(incoming: BrainChanges, { touched = null, keepNew = false }: ReconcileOptions): void {
      const prior = new Map(flatten(current).map((row) => [Number(row.change.id), row.change]));
      const next = keepNew
        ? mapChanges(incoming, (change) => {
            const was = prior.get(Number(change.id));
            return was ? { ...change, new: was.new } : change;
          })
        : incoming;
      const root = host.querySelector(".chfeed");
      const days = next.days
        .map((day) => ({ day, changes: dayChanges(day).filter((change) => CairnChangesFeed.rowHtml(change)) }))
        .filter((group) => group.changes.length);
      // An empty state standing over set-aside lines has no rows to key against either.
      if (!root || !days.length || host.querySelector(".chfeed-empty")) {
        paint(next, { enter: true });
        settle(rowEl(touched));
        return;
      }
      const priorAside = JSON.stringify(current?.set_aside ?? []);
      current = next;
      const ids = new Set(days.flatMap((group) => group.changes.map((change) => Number(change.id))));
      for (const el of host.querySelectorAll<HTMLElement>("[data-chfeed-id]")) {
        if (!leaving(el) && !ids.has(Number(el.getAttribute("data-chfeed-id")))) leave(el);
      }
      const keptDays = new Set<string>();
      let prevDay: Element | null = null;
      for (const { day, changes } of days) {
        keptDays.add(day.day);
        let section: Element | null =
          Array.from(root.children).find((el) => el.getAttribute("data-chfeed-day") === day.day) ?? null;
        if (!section) section = fromHtml(CairnChangesFeed.dayShellHtml(day));
        else {
          const label = section.querySelector(".chfeed-day-label");
          const text = CairnChangesFeed.dayLabel(day);
          if (label && label.textContent !== text) label.textContent = text;
        }
        const list = section?.querySelector(".chfeed-rows");
        if (!section || !list) continue;
        placeAfter(root, section, prevDay);
        prevDay = section;
        let prevRow: Element | null = null;
        for (const change of changes) {
          const id = Number(change.id);
          let el: HTMLElement | null = rowEl(id);
          const was = prior.get(id);
          if (!el || !was || JSON.stringify(was) !== JSON.stringify(change)) {
            const fresh = fromHtml(CairnChangesFeed.rowHtml(change, { enter: !el && !deps.reducedMotion() }));
            if (!fresh) continue;
            el?.remove();
            el = fresh;
            placeAfter(list, el, prevRow);
            if (id === touched) settle(el);
          } else placeAfter(list, el, prevRow);
          prevRow = el;
        }
      }
      for (const section of Array.from(root.children)) {
        const day = section.getAttribute("data-chfeed-day");
        if (day != null && !keptDays.has(day) && !section.querySelector(".chfeed-row")) section.remove();
      }
      // The set-aside lines close the feed; repainted only when the server's list moved.
      const aside = Array.from(root.children).find((el) => el.classList.contains("chfeed-aside")) ?? null;
      if (aside && JSON.stringify(next.set_aside ?? []) === priorAside) return;
      aside?.remove();
      const fresh = fromHtml(CairnChangesFeed.setAsideHtml(next));
      if (fresh) root.appendChild(fresh);
    }

    // The revert landed but the read after it did not: show that row as put back or
    // held (the server's own words for those states) so it never keeps a busy Undo.
    // The cache entry is already gone, so the next open reads the server's truth.
    function markRevertedLocally(id: number, attr: string): void {
      const el = rowEl(id);
      if (!el || !current) return;
      const was = flatten(current).find((row) => Number(row.change.id) === id)?.change;
      if (!was) return;
      const patched: BrainChange = { ...was, ...REVERTED[attr], undo: { available: false, label: null } };
      current = mapChanges(current, (change) => (Number(change.id) === id ? patched : change));
      el.outerHTML = CairnChangesFeed.rowHtml(patched);
      settle(rowEl(id));
    }

    async function afterRevert(id: number, attr: string): Promise<void> {
      deps.swrInvalidate(KEY);
      let next: unknown = null;
      try {
        next = await deps.cachedApi(PATH, { key: KEY });
      } catch {
        next = null;
      }
      if (!host.isConnected) return;
      if (isChanges(next)) reconcile(next, { touched: id, keepNew: true });
      else markRevertedLocally(id, attr);
    }

    function revert(el: HTMLElement, attr: string): void {
      const id = Number(el.getAttribute(`data-${attr}`));
      const change = flatten(current).find((row) => Number(row.change.id) === id)?.change ?? null;
      void CairnDecisionUndoController.revert(el, id, deps, {
        ...COPY[attr],
        after: async () => {
          await afterRevert(id, attr);
          await deps.onReverted?.(change);
        },
      });
    }

    const teardown = CairnUiActions.mount(host, "chfeed", ({ delegate }) => {
      delegate("click", {
        "chfeed-undo": (el) => revert(el, "chfeed-undo"),
        "chfeed-hold": (el) => revert(el, "chfeed-hold"),
        "chfeed-retry": () => void load(),
        // A folded why opens in place (and folds again).
        "chfeed-more": (el) => {
          const why = el.parentElement?.querySelector(".chfeed-why");
          const open = el.getAttribute("aria-expanded") !== "true";
          why?.classList.toggle("is-folded", !open);
          el.setAttribute("aria-expanded", open ? "true" : "false");
          el.textContent = open ? "Show less" : "Read all";
        },
        // "Talk it through" hands the change to chat, pre-filled with its own words.
        "chfeed-talk": (el) => {
          const id = Number(el.getAttribute("data-chfeed-talk"));
          const row = flatten(current).find((entry) => Number(entry.change.id) === id)?.change;
          if (!row || !deps.talk) return;
          deps.talk(`Let's talk through this change: ${row.title}${row.why ? ` — ${row.why}` : ""}`);
        },
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
