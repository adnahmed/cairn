// @ts-check
// visit-questions, the view (docs/V2-PLAN.md wave 3). Pure renderers for the list of
// questions the athlete takes to the next visit: the server proposes them (GET
// /api/health/visit-questions — one per doctor-loop follow-up plus any clinical ask the
// team is holding), and the athlete removes any or adds their own. The shell paints
// once (so the add field keeps focus); only `[data-vq-list]` repaints. A proposal's
// `basis` is plain context for the athlete and is never printed in the packet.
{
  type View = ClientVisitQuestionsView;
  type Item = ClientVisitQuestionItem;

  const SOURCE_LABEL: Record<string, string> = {
    clinical_ask: "Held for your doctor",
    doctor_loop: "Follow-up",
    missing_workup: "Worth adding",
    athlete: "Yours",
  };

  function shellHtml(opts: { maxChars: number }): string {
    return `<div class="vq">
    <div class="vq-head"><span class="lbl">Questions for the visit</span></div>
    <div class="vq-body" data-vq-list>${CairnUi.loadingStateHtml({ label: "Gathering questions for the visit…", className: "loadstate vq-loading" })}</div>
    <div class="vq-add">
      <input class="vq-input" type="text" maxlength="${escAttr(opts.maxChars)}" placeholder="Add a question" aria-label="Add a question for the visit" autocomplete="off" data-vq-input>
      <button type="button" class="ghostbtn vq-add-btn" data-vq-add>Add</button>
    </div>
  </div>`;
  }

  function itemHtml(item: Item, isNew: boolean): string {
    const src = SOURCE_LABEL[item.source] || "";
    const basis = item.basis ? `<span class="vq-basis">${escHtml(item.basis)}</span>` : "";
    return `<li class="vq-item${isNew ? " settle-in" : ""}" data-vq-id="${escAttr(item.id)}">
      <span class="vq-main"><span class="vq-text">${escHtml(item.text)}</span>${src ? `<span class="vq-src">${escHtml(src)}</span>` : ""}${basis}</span>
      <button type="button" class="vq-remove" data-vq-remove="${escAttr(item.id)}" aria-label="${escAttr(`Remove question: ${item.text}`)}">Remove</button>
    </li>`;
  }

  /** The list body for a state: loading, a calm failure, empty, or the questions. */
  function listHtml(view: View): string {
    if (view.status === "loading") {
      return CairnUi.loadingStateHtml({
        label: "Gathering questions for the visit…",
        className: "loadstate vq-loading",
      });
    }
    const failure =
      view.status === "error"
        ? `<p class="vq-note">Couldn't gather the suggested questions just now. Any you add here stand in for the suggested list in this packet. <button type="button" class="linkbtn linkbtn-plain vq-link" data-vq-retry>Try again</button></p>`
        : "";
    const list = view.items.length
      ? `<ol class="vq-list">${view.items.map((item) => itemHtml(item, item.id === view.newId)).join("")}</ol>`
      : view.status === "error"
        ? ""
        : `<p class="vq-note">No questions yet. Add one you'd like to ask, or leave this section out.</p>`;
    const full = view.full ? `<p class="vq-note">That's a full list for one visit.</p>` : "";
    const reset = view.edited
      ? `<button type="button" class="linkbtn linkbtn-plain vq-link" data-vq-reset>Use the suggested questions</button>`
      : "";
    return `${failure}${list}${full}${reset}`;
  }

  const CAIRN_VISIT_QUESTIONS = { SOURCE_LABEL, shellHtml, listHtml };

  Object.assign(globalThis, { CairnVisitQuestions: CAIRN_VISIT_QUESTIONS });
}
