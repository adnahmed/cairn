// @ts-check
// The what-if ripple card, the controller (v2 wave 5, "Ask"). One card at a time lives
// inline at the foot of the Ask thread:
//
//   ask      — the athlete's question in words ("What if…" chip opens it);
//   thinking — POST /api/what-if queued a durable job; its phase is the caption;
//   answer   — the job's result, painted once, with the ripple's one entrance (skipped
//              under reduced motion). The card NEVER changes anything on render;
//   handed   — "Do it" posts the job id to POST /api/what-if/do, which drafts the
//              change and routes it through the server's autonomy policy. The card
//              then prints how the team took it: the Changes feed's own row for that
//              decision — same words, same server-labelled Undo — or the framing line.
//
// The job id is remembered in sessionStorage (per-viewer convenience, every access
// guarded) so a re-render or a trip to Changes and back finds the card again; the
// server's stored answer is the truth either way.
{
  type AgentJob = import("../contracts/client-api.js").ClientAgentJob;

  const STORAGE_KEY = "cairn.ask.whatif.v1";

  const UNDO_COPY: Record<string, ClientDecisionUndoCopy> = {
    "chfeed-undo": {
      reason: "undo from the what-if card",
      success: "Put back",
      stale: "That change can no longer be undone.",
      failed: "Could not undo that change",
    },
    "chfeed-hold": {
      reason: "hold from the what-if card",
      success: "Held — it won't land",
      stale: "That change can no longer be held.",
      failed: "Could not hold that change",
    },
  };

  type Card = {
    el: HTMLElement;
    deps: ClientRippleCardDeps;
    state: "ask" | "thinking" | "answer" | "failed";
    question: string;
    jobId: number | null;
    busy: boolean;
  };

  let current: Card | null = null;

  function remember(deps: ClientRippleCardDeps, jobId: number | null): void {
    try {
      if (!deps.storage) return;
      if (jobId == null) deps.storage.removeItem(STORAGE_KEY);
      else deps.storage.setItem(STORAGE_KEY, String(jobId));
    } catch {
      /* per-viewer convenience only */
    }
  }

  function recalled(deps: ClientRippleCardDeps): number | null {
    try {
      const n = Number(deps.storage?.getItem(STORAGE_KEY));
      return Number.isInteger(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  }

  function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  }

  // The thread's quiet empty state and starter chips step aside once a card is there.
  function clearEmpty(log: HTMLElement): void {
    log.querySelectorAll(".chat-chips, .empty").forEach((el) => el.remove());
  }

  function place(log: HTMLElement, el: HTMLElement): void {
    clearEmpty(log);
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }

  function paint(card: Card, html: string, state: Card["state"]): void {
    card.state = state;
    card.el.innerHTML = html;
  }

  function liveCard(): Card | null {
    return current;
  }

  function live(card: Card): boolean {
    return current === card;
  }

  function showFailed(card: Card, message?: unknown): void {
    if (!live(card)) return;
    paint(card, CairnRippleCard.failedHtml(card.question, typeof message === "string" ? message : null), "failed");
  }

  function showAnswer(card: Card, result: unknown, enter: boolean): void {
    if (!live(card)) return;
    const answer = CairnRippleCardModel.answer(result);
    if (!answer) {
      showFailed(card, record(result)?.error);
      return;
    }
    if (answer.question) card.question = answer.question;
    const motion = enter && !card.deps.reducedMotion();
    paint(card, CairnRippleCard.answerHtml(answer, { enter: motion }), "answer");
  }

  function follow(card: Card, jobId: number): void {
    card.deps.openJobStream(jobId, {
      // The stream belongs to the card, not the render: it keeps painting a card
      // that is off screen (a trip to Changes), and closes once the card is put away.
      guard: () => !live(card),
      onPhase: (job: AgentJob | null) => {
        if (!live(card) || card.state !== "thinking") return;
        const caption = card.el.querySelector(".ripple-caption");
        if (caption) caption.textContent = CairnRippleCard.captionFor(job?.phase);
      },
      onDone: (result: unknown) => showAnswer(card, result, true),
      onError: (error?: unknown) => showFailed(card, typeof error === "string" ? error : null),
      onCanceled: () => showFailed(card, "the what-if was stopped"),
    });
  }

  async function ask(card: Card, question: string): Promise<void> {
    const text = CairnRippleCardModel.question(question);
    if (!text) {
      card.el.querySelector<HTMLTextAreaElement>("[data-ripple-input]")?.focus();
      return;
    }
    card.question = text;
    card.jobId = null;
    paint(card, CairnRippleCard.thinkingHtml(text), "thinking");
    let r: Record<string, unknown> | null = null;
    try {
      r = record(
        await card.deps.api("/what-if", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        })
      );
    } catch {
      showFailed(card);
      return;
    }
    if (!live(card)) return;
    const jobId = Number(record(r?.job)?.id);
    if (!r || r.ok !== true || !Number.isInteger(jobId) || jobId < 1) {
      showFailed(card, r?.error);
      return;
    }
    card.jobId = jobId;
    remember(card.deps, jobId);
    follow(card, jobId);
  }

  function setBusy(button: HTMLElement | null, busy: boolean): void {
    if (!button) return;
    if (busy) {
      button.setAttribute("aria-busy", "true");
      button.setAttribute("disabled", "");
    } else {
      button.removeAttribute("aria-busy");
      button.removeAttribute("disabled");
    }
  }

  async function paintHanded(card: Card, handed: ClientRippleHanded): Promise<void> {
    const host = card.el.querySelector<HTMLElement>("[data-ripple-handed]");
    if (!host) return;
    let row = null;
    if (handed.decisionId != null) {
      try {
        row = CairnRippleCardModel.findChange(await card.deps.api("/brain/changes"), handed.decisionId);
      } catch {
        row = null;
      }
    }
    if (!live(card) || !host.isConnected) return;
    host.innerHTML = CairnRippleCard.handedHtml(handed, row);
    host.hidden = false;
    if (row) {
      CairnDecisionUndoController.mount(
        host,
        { api: card.deps.api, toast: card.deps.toast },
        Object.fromEntries(
          Object.entries(UNDO_COPY).map(([key, copy]) => [
            key,
            {
              ...copy,
              after: async () => {
                card.deps.invalidate?.("brain:changes");
                card.deps.invalidate?.("plan");
                await paintHanded(card, handed);
              },
            },
          ])
        ),
        "ripple-undo"
      );
    }
  }

  async function doIt(card: Card, button: HTMLElement | null): Promise<void> {
    if (card.busy || card.jobId == null) return;
    card.busy = true;
    setBusy(button, true);
    let result: unknown = null;
    try {
      result = await card.deps.api("/what-if/do", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: card.jobId }),
      });
    } catch {
      result = null;
    }
    card.busy = false;
    if (!live(card)) return;
    const handed = CairnRippleCardModel.handed(result);
    const actions = card.el.querySelector<HTMLElement>("[data-ripple-actions]");
    if (handed.state === "refused") {
      setBusy(button, false);
      // Nothing to draft from this answer: offer the conversation instead of a dead button.
      if (actions && result && record(result)?.ok === false && record(result)?.error) {
        actions.innerHTML = `<button class="pillbtn ripple-talk" type="button" data-ripple-talk>Talk it through</button><button class="linkbtn-quiet ripple-later" type="button" data-ripple-later>Not now</button>`;
      }
    } else {
      actions?.remove();
      // Handed over: the change now lives in Changes, so a reload never re-offers Do it.
      remember(card.deps, null);
      card.deps.invalidate?.("brain:changes");
      card.deps.invalidate?.("plan");
    }
    await paintHanded(card, handed);
  }

  function putAway(card: Card): void {
    const log = card.el.parentElement;
    if (current === card) current = null;
    remember(card.deps, null);
    card.el.remove();
    if (log && !log.children.length) card.deps.restoreEmpty?.(log as HTMLElement);
  }

  function wire(card: Card): void {
    card.el.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = card.el.querySelector<HTMLTextAreaElement>("[data-ripple-input]");
      void ask(card, input?.value ?? "");
    });
    card.el.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const hit = target?.closest<HTMLElement>(
        "[data-ripple-do],[data-ripple-later],[data-ripple-talk],[data-ripple-retry],[data-ripple-changes]"
      );
      if (!hit || !card.el.contains(hit)) return;
      if (hit.hasAttribute("data-ripple-do")) void doIt(card, hit);
      else if (hit.hasAttribute("data-ripple-later")) putAway(card);
      else if (hit.hasAttribute("data-ripple-talk")) card.deps.talkItThrough(card.question);
      else if (hit.hasAttribute("data-ripple-retry")) void ask(card, card.question);
      else if (hit.hasAttribute("data-ripple-changes")) card.deps.openChanges();
    });
  }

  function create(deps: ClientRippleCardDeps): Card {
    const el = document.createElement("div");
    el.className = "ripple-slot";
    el.setAttribute("aria-live", "polite");
    const card: Card = { el, deps, state: "ask", question: "", jobId: null, busy: false };
    wire(card);
    if (current) putAway(current);
    current = card;
    return card;
  }

  /** Open the ask step at the foot of the thread (or bring the open one back into focus). */
  function open(log: HTMLElement, deps: ClientRippleCardDeps, opts: { draft?: string } = {}): HTMLElement | null {
    if (current && current.state === "ask") {
      current.deps = deps;
      if (current.el.parentElement !== log) place(log, current.el);
      current.el.querySelector<HTMLTextAreaElement>("[data-ripple-input]")?.focus();
      return current.el;
    }
    const card = create(deps);
    paint(card, CairnRippleCard.askHtml({ draft: opts.draft }), "ask");
    place(log, card.el);
    card.el.querySelector<HTMLTextAreaElement>("[data-ripple-input]")?.focus();
    return card.el;
  }

  /** Put the live card back at the foot of a rebuilt thread. True when there was one. */
  function reattach(log: HTMLElement): boolean {
    if (!current) return false;
    if (current.el.parentElement !== log) place(log, current.el);
    return true;
  }

  /**
   * After a re-render: reattach the live card, or find the remembered what-if from the
   * server's stored job and paint where it stands (a done answer arrives still).
   */
  async function resume(log: HTMLElement, deps: ClientRippleCardDeps): Promise<HTMLElement | null> {
    if (current) {
      current.deps = deps;
      reattach(log);
      return current.el;
    }
    const jobId = recalled(deps);
    if (jobId == null) return null;
    let job: AgentJob | null = null;
    try {
      job = (record(await deps.api(`/agent-jobs/${jobId}`))?.job as AgentJob | undefined) ?? null;
    } catch {
      job = null;
    }
    // The await is a gap: a card opened meanwhile wins, and a thread left meanwhile gets nothing.
    const opened = liveCard();
    if (opened || !deps.isLive()) return opened ? opened.el : null;
    const status = String(job?.status ?? "");
    // A what-if already handed to the team (its job points at the draft) lives in Changes.
    const handed = job?.ref_table === "plan_proposals";
    if (!job || job.kind !== "what_if" || handed || !["queued", "running", "done"].includes(status)) {
      remember(deps, null);
      return null;
    }
    const input = record(job.input);
    const card = create(deps);
    card.jobId = jobId;
    card.question = typeof input?.text === "string" ? input.text : "";
    if (status === "done") {
      if (!CairnRippleCardModel.answer(job.result)) {
        current = null;
        remember(deps, null);
        return null;
      }
      showAnswer(card, job.result, false);
    } else {
      paint(
        card,
        CairnRippleCard.thinkingHtml(card.question, typeof job.phase === "string" ? job.phase : null),
        "thinking"
      );
      follow(card, jobId);
    }
    place(log, card.el);
    return card.el;
  }

  const CAIRN_RIPPLE_CARD_CONTROLLER = { STORAGE_KEY, open, resume, reattach };

  Object.assign(globalThis, { CairnRippleCardController: CAIRN_RIPPLE_CARD_CONTROLLER });
}
