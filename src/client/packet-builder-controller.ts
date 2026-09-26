// @ts-check
// packet-builder, the controller (docs/V2-PLAN.md wave 3). `mount(host, deps)` paints
// the builder shell, then the server's packet JSON (GET /api/health-report.json):
//   - the default packet reads through SWR (`health:packet`, one cache per fact): a
//     warm peek paints at once, the skeleton shows only on a true cold start;
//   - an edited packet (a section toggled, the questions changed) asks the same path
//     with `?sections=` / `?questions=` over plain `api` — every combination is not a
//     fact worth caching — and a stale answer is dropped by a generation token;
//   - a toggle flips its own segmented group in place (focus stays put), and the
//     preview dims while the new read is in flight, never a spinner over content;
//   - the visit-questions editor mounts into the shell's sub-slot through
//     `deps.mountQuestions` while that section is included, and its edits come back as
//     the list the packet sends (null = the server's proposals);
//   - "Open the packet" and "Download as text" hand the current query to
//     `deps.onShare`; the composer owns the transport.
// Nothing to hand over (no panels and no body composition on the default read) paints
// the empty state with "Add a document" (`deps.onAdd`), and the informational line
// still shows. An empty default is never final: the default read always revalidates
// (a cached empty packet from before an upload must not pin the empty state), and a
// later default answer with records rebuilds the shell. Returns the teardown.
{
  type Deps = ClientPacketBuilderDeps;

  const KEY = "health:packet";
  const PATH = "/health-report.json";

  function mountPacketBuilder(host: Element, deps: Deps): () => void {
    const M = CairnPacketBuilderModel;
    const V = CairnPacketBuilder;
    let options: ClientPacketSectionOption[] = [];
    let sections: string[] | null = null;
    let touched = false;
    let questions: string[] | null = null;
    let generation = 0;
    let paintedQuery: string | null = null;
    let paintedJson = "";
    let empty = false;
    let questionsTeardown: (() => void) | null = null;

    let toggles: HTMLElement | null = null;
    let preview: HTMLElement | null = null;
    let status: HTMLElement | null = null;
    let disclaimer: HTMLElement | null = null;
    let questionsSlot: HTMLElement | null = null;

    /** Paint the builder shell and (re)bind its element refs; a fresh shell knows nothing yet. */
    function buildShell(): void {
      empty = false;
      options = [];
      sections = null;
      touched = false;
      paintedQuery = null;
      paintedJson = "";
      host.innerHTML = V.shellHtml();
      toggles = host.querySelector<HTMLElement>("[data-packet-toggles]");
      preview = host.querySelector<HTMLElement>("[data-packet-preview]");
      status = host.querySelector<HTMLElement>("[data-packet-status]");
      disclaimer = host.querySelector<HTMLElement>("[data-packet-disclaimer]");
      questionsSlot = host.querySelector<HTMLElement>("[data-packet-questions-slot]");
    }

    buildShell();

    function currentQuery(): string {
      return M.query({ sections: touched ? sections : null, questions });
    }

    function settle(): void {
      preview?.classList.remove("is-refreshing");
      preview?.removeAttribute("aria-busy");
    }

    function paintEmpty(line: string): void {
      if (empty) return;
      empty = true;
      stopQuestions();
      host.innerHTML = V.emptyHtml({ disclaimer: line });
      toggles = preview = status = disclaimer = questionsSlot = null;
    }

    function stopQuestions(): void {
      questionsTeardown?.();
      questionsTeardown = null;
    }

    function syncQuestionsSlot(): void {
      if (!questionsSlot) return;
      const on = !!sections && sections.includes("visit_questions");
      if (on) questionsSlot.removeAttribute("hidden");
      else questionsSlot.setAttribute("hidden", "");
      if (on && !questionsTeardown && deps.mountQuestions)
        questionsTeardown = deps.mountQuestions(questionsSlot, onQuestions);
    }

    function apply(report: unknown, qs: string): void {
      if (!qs && M.hasRecords(report) === false) {
        paintEmpty(M.previewModel(report).disclaimer);
        return;
      }
      // Records arrived for a builder showing the empty state: back to the full shell.
      if (empty) buildShell();
      if (!options.length) {
        options = M.catalog(report);
        if (!touched) sections = M.sectionsOf(report);
        if (toggles) toggles.innerHTML = options.length ? V.togglesHtml(options, sections || []) : "";
      }
      syncQuestionsSlot();
      settle();
      const json = JSON.stringify(report);
      if (json === paintedJson && paintedQuery === qs) return;
      const model = M.previewModel(report);
      if (preview) preview.innerHTML = V.previewHtml(model, { enter: paintedQuery === null });
      if (status) status.textContent = V.statusText(model);
      if (disclaimer) disclaimer.textContent = model.disclaimer;
      paintedQuery = qs;
      paintedJson = json;
    }

    function fail(qs: string): void {
      settle();
      // The preview still matches the packet (a warm default that could not refresh):
      // keep it. Otherwise it would show a selection the person has since changed.
      if (paintedQuery === qs) return;
      paintedQuery = null;
      paintedJson = "";
      if (preview) preview.innerHTML = V.previewErrorHtml();
      if (status) status.textContent = "";
      if (toggles && !options.length) toggles.innerHTML = "";
    }

    function load(): void {
      const gen = ++generation;
      const qs = currentQuery();
      if (paintedQuery !== null && preview) {
        preview.classList.add("is-refreshing");
        preview.setAttribute("aria-busy", "true");
      }
      let request: Promise<unknown>;
      if (!qs) {
        const peek = deps.peekCached(KEY);
        if (peek && paintedQuery === null && peek.data && typeof peek.data === "object") apply(peek.data, qs);
        // Always revalidate, even after an empty peek: the peek may predate an upload.
        request = deps.cachedApi(PATH, { key: KEY });
      } else {
        request = deps.api(PATH + qs);
      }
      request
        .then((data) => {
          if (gen !== generation || !host.isConnected) return;
          if (data && typeof data === "object") apply(data, qs);
          else if (!empty) fail(qs);
        })
        .catch(() => {
          if (gen !== generation || !host.isConnected || empty) return;
          fail(qs);
        });
    }

    function onQuestions(list: string[] | null): void {
      questions = list ? list.slice() : null;
      load();
    }

    function onToggle(el: HTMLElement): void {
      const group = el.closest<HTMLElement>("[data-packet-sec]");
      const id = group?.getAttribute("data-packet-sec") || "";
      const on = el.getAttribute("data-packet-section") === "on";
      if (!group || !id || !sections || sections.includes(id) === on) return;
      sections = M.toggle(options, sections, id, on);
      touched = true;
      group.querySelectorAll<HTMLElement>("[data-packet-section]").forEach((b) => {
        const active = b === el;
        b.classList.toggle("active", active);
        b.setAttribute("aria-pressed", active ? "true" : "false");
      });
      syncQuestionsSlot();
      load();
    }

    return CairnUiActions.mount(host, "packet-builder", ({ delegate }) => {
      delegate("click", {
        "packet-section": (el) => onToggle(el),
        "packet-open": () => deps.onShare("open", currentQuery()),
        "packet-text": () => deps.onShare("text", currentQuery()),
        "packet-retry": () => {
          if (preview) preview.innerHTML = V.previewSkeletonHtml();
          load();
        },
        "packet-add": () => deps.onAdd?.(),
      });
      load();
      return () => {
        generation++;
        stopQuestions();
      };
    });
  }

  const CAIRN_PACKET_BUILDER_CONTROLLER = { KEY, PATH, mount: mountPacketBuilder };

  Object.assign(globalThis, { CairnPacketBuilderController: CAIRN_PACKET_BUILDER_CONTROLLER });
}
