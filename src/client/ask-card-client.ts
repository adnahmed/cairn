// @ts-check
// The ask card renderer (docs/V2-PLAN.md wave 1). The team decides most changes and
// offers Undo; what is left to ask is clinical, irreversible, or missing evidence it
// genuinely lacks (GET /api/brain/decisions/waiting). Each ask prints the sentence the
// conference wrote FOR the athlete, never its machine summary, and it stays calm:
// collapsed behind a quiet count, one optional door into chat, no badge, no nag.
// A clinician-floor hold or a conference's clinical note is for the athlete AND their
// doctor — something to take to a visit, never something they owe the coach.
{
  type WaitingDecision = import("../contracts/client-api.js").ClientBrainDecisionSummary & {
    for_clinician?: boolean;
  };

  type AskModel = { id: number; summary: string; explanation: string; forClinician: boolean };

  const GROUP_CAP = 4;

  function askModels(rows: unknown): AskModel[] {
    if (!Array.isArray(rows)) return [];
    const out: AskModel[] = [];
    for (const row of rows as WaitingDecision[]) {
      if (!row || typeof row !== "object") continue;
      const explanation = String(row.explanation ?? "").trim();
      const id = Number(row.id);
      if (!explanation || !Number.isFinite(id)) continue;
      out.push({
        id,
        summary: String(row.summary ?? "").trim(),
        explanation,
        forClinician: row.for_clinician === true,
      });
    }
    return out;
  }

  function askCardHtml(ask: AskModel): string {
    return `<article class="askcard${ask.forClinician ? " askcard-clinician" : ""}" data-askcard-id="${escAttr(ask.id)}">
      ${ask.summary ? `<p class="askcard-line">${escHtml(ask.summary)}</p>` : ""}
      <p class="askcard-why">${escHtml(ask.explanation)}</p>
      <button class="linkbtn-quiet askcard-talk" type="button" data-askcard-talk="${escAttr(ask.id)}">Talk it through</button>
    </article>`;
  }

  function groupHtml(label: string, asks: AskModel[]): string {
    if (!asks.length) return "";
    // Collapsed by default, footnote weight: the count stays visible so an open
    // question never goes dark, and the sentences are one tap away.
    return `<details class="plan-upcoming askcard-group reveal">
      <summary><span class="lbl plan-upcoming-strip">${escHtml(label)} (${asks.length})</span></summary>
      <div class="plan-upcoming-body">${asks.map(askCardHtml).join("")}</div>
    </details>`;
  }

  /** Both groups, or "" when nothing waits (the slot then collapses). */
  function asksHtml(rows: unknown): string {
    const asks = askModels(rows);
    return (
      groupHtml("Waiting on you", asks.filter((ask) => !ask.forClinician).slice(0, GROUP_CAP)) +
      groupHtml("For you and your doctor", asks.filter((ask) => ask.forClinician).slice(0, GROUP_CAP))
    );
  }

  /**
   * What the chat composer is pre-filled with when the athlete opens the door: the
   * sentence written for them, never the ledger summary (which can be a producer
   * label), since the composer offers it as the athlete's own words.
   */
  function talkPrefill(rows: unknown, id: unknown): string {
    const ask = askModels(rows).find((row) => row.id === Number(id));
    if (!ask) return "";
    const text = String(ask.explanation ?? "").trim();
    return /\?$/.test(text) ? text : `Can we talk this through? ${text}`;
  }

  const CAIRN_ASK_CARD = {
    asksHtml,
    askCardHtml,
    askModels,
    talkPrefill,
  };

  Object.assign(globalThis, { CairnAskCard: CAIRN_ASK_CARD });
}
