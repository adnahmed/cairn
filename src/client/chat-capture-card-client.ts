// @ts-check
// A meal logged in chat comes back as the meal card (docs/V2-PLAN.md wave 2). Once
// the note's estimate settles, the review under the capture chip becomes the
// editable card (meal-card-controller.ts): fixing a row's grams is one
// `PUT /api/food-notes/:id` from the bubble itself and never a follow-up chat
// message. The card mounts from either source of the settled note:
//
//   - the full food-note row an SSE/poll update hands chat-message-client.ts
//     (`settleFromRow`) — the live capture settling in front of the athlete, with
//     the review's own settle-in motion; or
//   - the editable read the server stamps on every chat read path
//     (`result.food.card`, src/repo/chat.ts) — a reload or a tab-switch re-render
//     (`mountAll`), painted before the bubble is ever shown.
//
// A note with no structured rows (an items-only estimate), a still-enriching one,
// or the read-only history overlay keeps the read-only review. After a save the
// chip above the card reprints from the saved row and the chat fuel strip and the
// intake reads refetch.
{
  type Deps = ClientChatCaptureCardDeps;

  // A review host carries at most one card; a repeated SSE row for the same settled
  // state never remounts it (and never wipes an edit in progress).
  const mounted = new WeakSet<Element>();

  function active(status: unknown): boolean {
    const s = String(status || "");
    return s === "pending" || s === "in_progress";
  }

  /** True when the note has rows the card can edit and an id to save them to. */
  function editable(note: unknown): boolean {
    return CairnMealCardModel.mealCardModel(note).id != null && CairnMealCardModel.mealCardRows(note).length > 0;
  }

  /** The note the card edits, from the stamped `food.card` read; null when there is none. */
  function noteFromStamp(id: number, food: unknown): unknown | null {
    const card = food && typeof food === "object" ? (food as { card?: unknown }).card : null;
    if (!card || typeof card !== "object") return null;
    const note = { id, parsed: card };
    return editable(note) ? note : null;
  }

  /** Mount the card into a review host. False (and nothing touched) when the note is not editable. */
  function mount(review: HTMLElement, note: unknown, deps: Deps, opts: { settle?: boolean } = {}): boolean {
    if (mounted.has(review)) return true;
    if (!editable(note)) return false;
    const wasEmpty = review.hidden === true;
    mounted.add(review);
    review.hidden = false;
    review.classList.add("capture-review-card");
    CairnMealCardController.mount(review, {
      note,
      api: deps.api,
      toast: deps.toast,
      expandEl: deps.expandEl,
      collapseEl: deps.collapseEl,
      reducedMotion: deps.reducedMotion,
      onSaved: deps.onSaved,
    });
    review.classList.toggle("settling", !!opts.settle && wasEmpty);
    return true;
  }

  /**
   * An SSE/poll row for a capture note. True when the card owns the review (just
   * mounted, or already there), so the caller leaves the review alone.
   */
  function settleFromRow(review: HTMLElement, row: unknown, deps: Deps): boolean {
    if (mounted.has(review)) return true;
    const status = row && typeof row === "object" ? (row as { enrichment_status?: unknown }).enrichment_status : "";
    if (active(status)) return false;
    return mount(review, row, deps, { settle: true });
  }

  /** Mount a card on every settled, editable capture review a freshly rendered bubble holds. */
  function mountAll(scope: ParentNode, applied: readonly unknown[], deps: Deps): void {
    for (const action of applied) {
      const info = CairnChatClient.captureFoodInfo(action);
      if (!info || info.missing || active(info.status)) continue;
      const note = noteFromStamp(info.id, info.food);
      const review = scope.querySelector<HTMLElement>(`.capture-review[data-capture-review="${info.id}"]`);
      if (note && review) mount(review, note, deps);
    }
  }

  /** The chip over a saved capture reprints from the saved row, wherever it is shown. */
  function repaintChips(note: unknown): void {
    const id = Number((note as { id?: unknown } | null)?.id);
    if (!Number.isSafeInteger(id) || id <= 0) return;
    const { status, food } = CairnChatClient.captureFoodFromRow(note);
    document.querySelectorAll<HTMLElement>(`.capture-food[data-capture-note="${id}"]`).forEach((tag) => {
      tag.classList.toggle("pending", active(status));
      tag.innerHTML = CairnChatClient.captureFoodTagInner(status, food);
    });
  }

  /** The chat surface's deps, from the shell's shared primitives. */
  function chatDeps(): Deps {
    return {
      api: (path, init) => api(path, init),
      toast: (message) => toast(message),
      expandEl: (el) => CairnUiMotion.expandEl(el),
      collapseEl: (el, done) => CairnUiMotion.collapseEl(el, done),
      reducedMotion: () => reducedMotion(),
      onSaved: (note) => {
        repaintChips(note);
        swrInvalidate("progress:energy");
        swrInvalidate("progress:intake");
        if (state.tab === "chat" && typeof loadChatFuel === "function") void loadChatFuel(pollToken);
      },
    };
  }

  const CAIRN_CHAT_CAPTURE_CARD = {
    editable,
    noteFromStamp,
    mount,
    settleFromRow,
    mountAll,
    repaintChips,
    chatDeps,
  };

  Object.assign(globalThis, { CairnChatCaptureCard: CAIRN_CHAT_CAPTURE_CARD });
}
