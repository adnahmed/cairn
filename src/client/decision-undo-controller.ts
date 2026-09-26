// @ts-check
// One way to put an autonomous change back (docs/DESIGN.md "Component
// inventory": decision-undo). Every Undo / Hold — the affected exercise, the
// Today rail, the meal plan, a toast — posts the durable decision id to the
// server's revert path; the server restores its own snapshot. This owns the
// shared part: a busy state that blocks a second tap, the calm refusal when the
// change can no longer be reverted, and the repaint after it lands.
{
  type DecisionUndoDeps = {
    api(path: string, init?: RequestInit & { headers?: Record<string, string> }): Promise<unknown>;
    toast(message: string, options?: { action?: string; onAction?: () => void }): void;
  };
  type DecisionUndoCopy = {
    /** Why, recorded with the revert. */
    reason: string;
    /** Toast once the server confirms. */
    success: string;
    /** The refusal when the server declines without saying why. */
    stale: string;
    /** Toast when the request itself failed without a message. */
    failed: string;
    /** Repaint whatever showed the change; awaited before the tap is released on failure. */
    after?(): unknown;
  };

  // Decision ids with a revert in flight, so a toast action and a button for the
  // same change never post twice.
  const PENDING = new Set<number>();

  function decisionId(value: unknown): number | null {
    const id = Number(value);
    return Number.isFinite(id) && id > 0 ? id : null;
  }

  /**
   * Revert decision `id`. `button` (when there is one) shows the busy state and is
   * released again only on failure; on success the repaint replaces it. Resolves
   * true when the server reverted the decision.
   */
  async function revertDecision(
    button: HTMLElement | null,
    rawId: unknown,
    deps: DecisionUndoDeps,
    copy: DecisionUndoCopy
  ): Promise<boolean> {
    const id = decisionId(rawId);
    if (id == null || PENDING.has(id) || button?.dataset.busy === "1") return false;
    PENDING.add(id);
    if (button) {
      button.dataset.busy = "1";
      button.setAttribute("aria-busy", "true");
    }
    try {
      const result = (await deps.api(`/brain/decisions/${id}/revert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: copy.reason }),
      })) as { ok?: unknown; error?: unknown } | null;
      if (!result || result.ok !== true) {
        throw new Error(typeof result?.error === "string" && result.error ? result.error : copy.stale);
      }
      deps.toast(copy.success);
      await copy.after?.();
      return true;
    } catch (error) {
      deps.toast(error instanceof Error && error.message ? error.message : copy.failed);
      if (button) {
        button.dataset.busy = "";
        button.removeAttribute("aria-busy");
      }
      return false;
    } finally {
      PENDING.delete(id);
    }
  }

  /**
   * Delegated Undo on `host`: each key of `actions` is an action attribute without
   * `data-` whose value is the decision id. Idempotent per (host, name) through
   * CairnUiActions.mount; returns the teardown.
   */
  function mountDecisionUndo(
    host: Element,
    deps: DecisionUndoDeps,
    actions: Record<string, DecisionUndoCopy>,
    name = "decision-undo"
  ): () => void {
    return CairnUiActions.mount(host, name, ({ delegate }) => {
      const handlers: Record<string, (el: HTMLElement) => void> = {};
      for (const [key, copy] of Object.entries(actions)) {
        handlers[key] = (el) => void revertDecision(el, el.getAttribute(`data-${key}`), deps, copy);
      }
      delegate("click", handlers);
    });
  }

  /**
   * Announce a change in a toast whose action is its Undo, labelled by the server
   * ("Restore previous bench target"). The same change stays undoable at the
   * affected detail after the toast is gone.
   */
  function offerDecisionUndo(
    message: string,
    rawId: unknown,
    label: unknown,
    deps: DecisionUndoDeps,
    copy: DecisionUndoCopy
  ): void {
    if (decisionId(rawId) == null) {
      deps.toast(message);
      return;
    }
    const action = label == null || !String(label).trim() ? "Undo" : String(label);
    deps.toast(message, { action, onAction: () => void revertDecision(null, rawId, deps, copy) });
  }

  const CAIRN_DECISION_UNDO_CONTROLLER = {
    revert: revertDecision,
    mount: mountDecisionUndo,
    offer: offerDecisionUndo,
  };

  Object.assign(globalThis, { CairnDecisionUndoController: CAIRN_DECISION_UNDO_CONTROLLER });
}
