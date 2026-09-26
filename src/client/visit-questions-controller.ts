// @ts-check
// visit-questions, the controller (docs/V2-PLAN.md wave 3). `mount(host, deps)` paints
// the editor, reads the proposals through SWR (`health:visit-questions`; a warm peek
// paints at once), and lets the athlete remove a question or add their own (Enter or
// "Add"). Every edit reports the list the packet should send through `deps.onChange`
// — the athlete's final list, in their order — and "Use the suggested questions"
// reports null (the server's proposals). The edited list is never stored: it travels
// with the packet request only. Returns the teardown.
{
  type Deps = ClientVisitQuestionsDeps;
  type Item = ClientVisitQuestionItem;

  const KEY = "health:visit-questions";
  const PATH = "/health/visit-questions";
  /** The server keeps at most this many questions (VISIT_QUESTION_LIMIT × 2). */
  const QUESTION_CAP = 16;
  /** The server's per-question ceiling (VISIT_QUESTION_MAX_CHARS). */
  const QUESTION_MAX_CHARS = 280;

  /** A question as the server would keep it: one line, trimmed, within its ceiling. */
  function cleanQuestion(raw: unknown): string {
    const s = String(raw ?? "")
      .replace(/\s+/g, " ")
      .trim();
    return s.length > QUESTION_MAX_CHARS ? `${s.slice(0, QUESTION_MAX_CHARS - 1).trimEnd()}…` : s;
  }

  function proposalsOf(value: unknown): Item[] | null {
    const list = value && typeof value === "object" ? (value as { questions?: unknown }).questions : null;
    if (!Array.isArray(list)) return null;
    return list
      .map((raw) => {
        const q = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
        return {
          id: String(q.id ?? ""),
          text: String(q.text ?? "").trim(),
          source: String(q.source ?? ""),
          basis: q.basis == null || String(q.basis).trim() === "" ? null : String(q.basis),
        };
      })
      .filter((q) => q.id && q.text);
  }

  function mountVisitQuestions(host: Element, deps: Deps): () => void {
    let proposals: Item[] | null = null;
    let items: Item[] = [];
    let edited = false;
    let status: ClientVisitQuestionsView["status"] = "loading";
    let newId: string | null = null;
    let custom = 0;
    let generation = 0;

    host.innerHTML = CairnVisitQuestions.shellHtml({ maxChars: QUESTION_MAX_CHARS });
    const list = host.querySelector<HTMLElement>("[data-vq-list]");
    const input = host.querySelector<HTMLInputElement>("[data-vq-input]");
    const addBtn = host.querySelector<HTMLButtonElement>("[data-vq-add]");

    function paint(): void {
      const full = items.length >= QUESTION_CAP;
      if (list) list.innerHTML = CairnVisitQuestions.listHtml({ status, items, edited, full, newId });
      if (input) input.disabled = full;
      if (addBtn) addBtn.disabled = full;
      newId = null;
    }

    function report(): void {
      deps.onChange(edited ? items.map((q) => q.text) : null);
    }

    function takeProposals(value: unknown): boolean {
      const next = proposalsOf(value);
      if (!next) return false;
      proposals = next;
      if (!edited) items = next.slice();
      status = "ready";
      return true;
    }

    function load(): void {
      const gen = ++generation;
      const peek = deps.peekCached(KEY);
      if (peek && takeProposals(peek.data)) paint();
      deps
        .cachedApi(PATH, { key: KEY })
        .then((data) => {
          if (gen !== generation || !host.isConnected) return;
          if (takeProposals(data)) paint();
          else if (!proposals) failed();
        })
        .catch(() => {
          if (gen !== generation || !host.isConnected || proposals) return;
          failed();
        });
    }

    function failed(): void {
      status = "error";
      paint();
    }

    function add(): void {
      if (!input || items.length >= QUESTION_CAP) return;
      const text = cleanQuestion(input.value);
      input.value = "";
      input.focus();
      if (!text || items.some((q) => q.text.toLowerCase() === text.toLowerCase())) return;
      custom += 1;
      const item = { id: `custom:${custom}`, text, source: "athlete", basis: null };
      items = [...items, item];
      edited = true;
      if (status === "loading") status = "ready";
      newId = item.id;
      paint();
      report();
    }

    function remove(el: HTMLElement): void {
      const id = el.getAttribute("data-vq-remove") || "";
      const at = items.findIndex((q) => q.id === id);
      if (at < 0) return;
      items = items.filter((q) => q.id !== id);
      edited = true;
      paint();
      report();
      // Focus lands on the question that took its place, else the add field.
      const buttons = list ? list.querySelectorAll<HTMLElement>("[data-vq-remove]") : [];
      const next = buttons[Math.min(at, buttons.length - 1)];
      (next || input)?.focus();
    }

    function reset(): void {
      edited = false;
      items = (proposals || []).slice();
      if (proposals) status = "ready";
      paint();
      report();
      input?.focus();
    }

    return CairnUiActions.mount(host, "visit-questions", ({ delegate }) => {
      delegate("click", {
        "vq-remove": (el) => remove(el),
        "vq-add": () => add(),
        "vq-reset": () => reset(),
        "vq-retry": () => {
          status = "loading";
          paint();
          load();
        },
      });
      delegate("keydown", {
        "vq-input": (_el, event) => {
          if ((event as KeyboardEvent).key !== "Enter") return;
          event.preventDefault();
          add();
        },
      });
      load();
      return () => {
        generation++;
      };
    });
  }

  const CAIRN_VISIT_QUESTIONS_CONTROLLER = {
    KEY,
    PATH,
    QUESTION_CAP,
    QUESTION_MAX_CHARS,
    cleanQuestion,
    mount: mountVisitQuestions,
  };

  Object.assign(globalThis, { CairnVisitQuestionsController: CAIRN_VISIT_QUESTIONS_CONTROLLER });
}
