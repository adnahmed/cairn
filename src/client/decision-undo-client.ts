// @ts-check
// The decision-undo button (docs/DESIGN.md "Component inventory"). The server
// owns the label ("Restore previous bench target") and the rollback snapshot; the
// button only carries the decision id. Wired by CairnDecisionUndoController.
{
  type DecisionUndoButtonOptions = {
    /** The durable `brain_decisions` id. */
    id: unknown;
    /** The server-owned label; "Undo" until the server sends one. */
    label?: unknown;
    /** Action attribute without `data-` (default `decision-undo`). */
    attr?: string;
    className?: string;
  };

  function decisionUndoButtonHtml(options: DecisionUndoButtonOptions): string {
    if (options.id == null || String(options.id) === "") return "";
    const attr = /^[a-z][a-z0-9-]*$/.test(String(options.attr || "")) ? String(options.attr) : "decision-undo";
    const label = options.label == null || !String(options.label).trim() ? "Undo" : options.label;
    return `<button class="${escAttr(options.className || "linkbtn-quiet")}" type="button" data-${attr}="${escAttr(options.id)}">${escHtml(label)}</button>`;
  }

  const CAIRN_DECISION_UNDO = {
    buttonHtml: decisionUndoButtonHtml,
  };

  Object.assign(globalThis, { CairnDecisionUndo: CAIRN_DECISION_UNDO });
}
