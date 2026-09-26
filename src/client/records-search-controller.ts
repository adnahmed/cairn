// @ts-check
// records-search, the controller (docs/V2-PLAN.md wave 3). `mount(host, deps)` paints
// the controls once, then the marker catalog grouped by the chosen mode:
//   - markers load through SWR (`markers:priority`, the same key as the older Health
//     tab — one cache per fact), painted from `deps.seed` (else a warm peek) first, the
//     skeleton only on a true cold start, and repainted only when the result changed;
//   - typing narrows the markers locally on every keystroke (focus never leaves the
//     field), and, when `deps.searchRecords` is on, asks the server search for the
//     documents, visit notes and body readings the catalog doesn't hold (debounced;
//     a stale answer is dropped, a 404 shows nothing, any other failure is one calm
//     line; a mode switch asks again under the new mode);
//   - the grouping mode is a per-viewer preference (`cairn.records.group`).
// Rows expand in place; "Ask the coach", a row's directive line, a hit and the empty
// state's "Add labs" hand off to `deps`. Returns the teardown.
{
  type Deps = ClientRecordsSearchDeps;
  type Mode = ClientRecordsMode;
  type Catalog = { markers: ClientRecordsMarker[]; groups: unknown };

  const KEY = "markers:priority";
  const PATH = "/markers/priority";
  const MODE_KEY = "cairn.records.group";
  const DEBOUNCE_MS = 250;

  function catalog(value: unknown): Catalog | null {
    if (!value || typeof value !== "object" || !Array.isArray((value as Catalog).markers)) return null;
    return { markers: (value as Catalog).markers, groups: (value as Catalog).groups };
  }

  function readMode(deps: Deps): Mode {
    try {
      const saved = deps.storage?.getItem(MODE_KEY);
      if (CairnRecordsSearchModel.isMode(saved)) return saved;
    } catch {
      /* private mode or blocked storage: the default stands */
    }
    return deps.mode && CairnRecordsSearchModel.isMode(deps.mode) ? deps.mode : "outrange";
  }

  function saveMode(deps: Deps, mode: Mode): void {
    try {
      deps.storage?.setItem(MODE_KEY, mode);
    } catch {
      /* a preference, never state that must persist */
    }
  }

  function mountRecordsSearch(host: Element, deps: Deps): () => void {
    let mode = readMode(deps);
    let q = "";
    let data: Catalog | null = catalog(deps.seed);
    let painted = "";
    let generation = 0;
    let searchGen = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timers = deps.timers || { setTimeout, clearTimeout };
    const searchable = deps.searchable !== false;

    host.innerHTML = CairnRecordsSearch.shellHtml({ mode, searchable, placeholder: deps.placeholder });
    const results = host.querySelector<HTMLElement>("[data-records-results]");
    const status = host.querySelector<HTMLElement>("[data-records-status]");
    const other = host.querySelector<HTMLElement>("[data-records-other]");

    function paintResults(force = false): void {
      if (!data || !results) return;
      const model = CairnRecordsSearchModel.sectionsModel({
        markers: data.markers,
        groups: data.groups,
        mode,
        q,
        scope: deps.scope || null,
      });
      const html = CairnRecordsSearch.resultsHtml(model, { q, canAdd: !!deps.onAdd });
      if (status) status.textContent = CairnRecordsSearch.statusText(model, q);
      if (!force && html === painted) return;
      painted = html;
      results.innerHTML = html;
      results.querySelectorAll<SVGElement>("svg.hchart").forEach((svg) => CairnHealthMarkers.wireMarkerChart(svg));
    }

    function load(): Promise<void> {
      const gen = ++generation;
      // The screen's seed is the freshest snapshot there is (Stand refreshes it after an
      // upload); a warm SWR peek only stands in when there is no seed at all.
      if (!data) data = catalog(deps.peekCached(KEY)?.data);
      if (data) paintResults();
      else if (results) results.innerHTML = CairnRecordsSearch.skeletonHtml();
      return deps
        .cachedApi(PATH, { key: KEY })
        .then((res) => {
          if (gen !== generation || !host.isConnected) return;
          const next = catalog(res);
          if (next) {
            data = next;
            paintResults();
          } else if (!data && results) {
            painted = "";
            results.innerHTML = CairnRecordsSearch.errorHtml();
          }
        })
        .catch(() => {
          if (gen !== generation || !host.isConnected || data || !results) return;
          painted = "";
          results.innerHTML = CairnRecordsSearch.errorHtml();
        });
    }

    function paintOther(state: ClientRecordsOtherState): void {
      if (other && host.isConnected) other.innerHTML = CairnRecordsSearch.otherHtml(state);
    }

    function stopTimer(): void {
      if (timer != null) timers.clearTimeout(timer);
      timer = null;
    }

    async function runOther(needle: string, gen: number): Promise<void> {
      paintOther({ status: "loading", items: [] });
      let res: unknown;
      try {
        res = await deps.api(CairnRecordsSearchModel.searchPath(needle, mode));
      } catch (err) {
        // api() throws on every non-2xx. A 404 means this server has no records search
        // (an older build): nothing else to show, not a failure line.
        if (gen === searchGen) paintOther({ status: notFound(err) ? "idle" : "error", items: [] });
        return;
      }
      if (gen !== searchGen) return;
      const items = CairnRecordsSearchModel.otherItems(res);
      paintOther(items ? { status: "done", items } : { status: "idle", items: [] });
    }

    function notFound(err: unknown): boolean {
      return !!err && typeof err === "object" && (err as { status?: unknown }).status === 404;
    }

    function scheduleOther(): void {
      if (!deps.searchRecords) return;
      stopTimer();
      const gen = ++searchGen;
      const needle = q.trim();
      if (needle.length < 2) {
        paintOther({ status: "idle", items: [] });
        return;
      }
      timer = timers.setTimeout(() => {
        timer = null;
        void runOther(needle, gen);
      }, DEBOUNCE_MS);
    }

    function setQuery(value: string): void {
      q = value;
      paintResults();
      scheduleOther();
    }

    function setMode(btn: HTMLElement): void {
      const next = btn.getAttribute("data-records-group");
      if (!CairnRecordsSearchModel.isMode(next) || next === mode) return;
      mode = next;
      saveMode(deps, mode);
      const seg = btn.closest<HTMLElement>(".seg");
      const buttons = seg ? seg.querySelectorAll<HTMLElement>("[data-records-group]") : [];
      buttons.forEach((b, i) => {
        const on = b === btn;
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
        if (on) seg?.style.setProperty("--segi", String(i));
      });
      paintResults(true);
      // The server search takes the mode too, so a showing query is asked again under it.
      if (q.trim()) scheduleOther();
    }

    function toggleRow(btn: HTMLElement): void {
      const item = btn.closest<HTMLElement>(".hmk");
      if (!item) return;
      const open = item.classList.toggle("open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    }

    function clearQuery(): void {
      const input = host.querySelector<HTMLInputElement>("[data-records-q]");
      if (input) input.value = "";
      setQuery("");
      input?.focus();
    }

    return CairnUiActions.mount(host, "records-search", ({ delegate }) => {
      delegate("input", { "records-q": (el) => setQuery((el as HTMLInputElement).value || "") });
      delegate("click", {
        "records-group": (el) => setMode(el),
        "hmk-toggle": (el) => toggleRow(el),
        ask: (el) => deps.askCoach(el.getAttribute("data-ask") || ""),
        "directive-link": () => deps.onDirective?.(),
        "records-open": (el) =>
          deps.onOpenRecord?.({
            kind: el.getAttribute("data-records-open") || "",
            id: el.getAttribute("data-id") || "",
          }),
        "records-clear": () => clearQuery(),
        "records-retry": () => void load(),
        "records-add": () => deps.onAdd?.(),
      });
      void load();
      return () => {
        generation++;
        searchGen++;
        stopTimer();
      };
    });
  }

  const CAIRN_RECORDS_SEARCH_CONTROLLER = { KEY, MODE_KEY, DEBOUNCE_MS, mount: mountRecordsSearch };

  Object.assign(globalThis, { CairnRecordsSearchController: CAIRN_RECORDS_SEARCH_CONTROLLER });
}
