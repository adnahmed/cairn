// @ts-check
// The what-if ripple card, the model (v2 wave 5, "Ask"). Pure shaping of two server
// reads: the what-if answer (POST /api/what-if → the job's result, src/coachOps/whatif.ts)
// and the "Do it" hand-off (POST /api/what-if/do). Every word — the change, each
// stone's name, its before and after word, the why, the confidence — is the server's,
// carried verbatim; tones are clamped to the reading layer's three (`ok` / `watch` /
// `quiet`, unknown → `quiet`). This module never works a stone's move out, never ranks
// the stones and never turns a word into a number.
//
// `handed()` frames how the team took a "Do it" from the server's own `state`: the
// autonomy policy decided the tier (src/brain/autonomy.ts) and whatIfDo named its
// outcome; the card only says so.
{
  type BrainChanges = import("../contracts/brain-changes.js").ClientBrainChanges;
  type BrainChange = import("../contracts/brain-changes.js").ClientBrainChange;

  const TONES: ReadonlySet<string> = new Set(["ok", "watch", "quiet"]);
  const DIRECTIONS: ReadonlySet<string> = new Set(["helps", "costs", "steady", "mixed"]);
  const CONFIDENCE: ReadonlySet<string> = new Set(["likely", "possible", "unsure"]);
  const KINDS: ReadonlySet<string> = new Set(["training", "nutrition", "goal", "other"]);

  function text(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }

  function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  }

  function tone(value: unknown): ClientWhatIfTone {
    return (TONES.has(String(value)) ? value : "quiet") as ClientWhatIfTone;
  }

  function place(value: unknown): { word: string; tone: ClientWhatIfTone } | null {
    const row = record(value);
    const word = text(row?.word);
    return row && word ? { word, tone: tone(row.tone) } : null;
  }

  function positiveId(value: unknown): number | null {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  function stoneOf(value: unknown): ClientRippleStone | null {
    const row = record(value);
    if (!row) return null;
    const key = text(row.stone);
    const label = text(row.label);
    const before = place(row.before);
    if (!key || !label || !before) return null;
    const direction = (
      DIRECTIONS.has(String(row.direction)) ? row.direction : "steady"
    ) as ClientRippleStone["direction"];
    const confidence = (
      CONFIDENCE.has(String(row.confidence)) ? row.confidence : "unsure"
    ) as ClientRippleStone["confidence"];
    // A steady stone stays where it stands; an "after" the server did not send is never invented.
    const after = direction === "steady" ? before : (place(row.after) ?? before);
    return { key, label, direction, confidence, why: text(row.why), before, after, moved: direction !== "steady" };
  }

  const LEAD = /^\s*what\s+if\b[\s,.:…]*/i;

  /**
   * The athlete's words as the team hears them: one sentence that starts "What if",
   * whether they typed the lead-in or let the card's own "What if" label carry it.
   * Empty when nothing but the lead-in was typed.
   */
  function fullQuestion(raw: unknown): string {
    const said = String(raw ?? "")
      .replace(/\s+/g, " ")
      .replace(LEAD, "")
      .replace(/^[\s.…]+/, "")
      .trim();
    return said ? `What if ${said}` : "";
  }

  /** The question without its lead-in, for printing under the card's own "What if" label. */
  function questionBody(raw: unknown): string {
    return String(raw ?? "")
      .replace(LEAD, "")
      .trim();
  }

  /** The card's view model for a done what-if job's result, or null when it is not an answer. */
  function answerModel(result: unknown): ClientRippleAnswer | null {
    const r = record(result);
    if (!r || r.ok !== true) return null;
    const change = record(r.change);
    const summary = text(change?.summary);
    if (!change || !summary) return null;
    const stones = (Array.isArray(r.ripple) ? r.ripple : [])
      .map(stoneOf)
      .filter((s): s is ClientRippleStone => s !== null);
    return {
      question: text(r.question),
      summary,
      kind: (KINDS.has(String(change.kind)) ? change.kind : "other") as ClientRippleAnswer["kind"],
      doable: change.doable === true,
      clinical: change.clinical === true,
      stones,
    };
  }

  const LINES = {
    landed: "The team made this change.",
    lands: "The team has it. It lands at the next natural break in your week.",
    waiting: "It's with the team as a draft, waiting on your yes in Changes.",
    moved: "Your plan has moved since this was read, so it waits on your yes in Changes.",
    clinician: "This one touches something clinical, so it waits on you in Changes.",
    already: "The team already has this one.",
    refused: "The team couldn't take this change just now.",
  } as const;

  /**
   * A refusal's athlete-facing line. Only what-if's own talk-it-through refusals (they name
   * the change's `kind`) are written for the athlete; any other `error` is a raw failure
   * message from deeper down, so the calm default stands in for it.
   */
  function refusedLine(r: Record<string, unknown>): string {
    const said = KINDS.has(String(r.kind)) ? text(r.error) : "";
    return said ? `${said.charAt(0).toUpperCase()}${said.slice(1)}` : LINES.refused;
  }

  const HANDED_STATES: ReadonlySet<string> = new Set(["landed", "lands", "waiting", "clinician", "already"]);

  /**
   * How the team took "Do it". The server names the state (whatIfDo's WhatIfDoResult);
   * the card only picks its line. An `ok:false`, or a state it does not know, is refused.
   */
  function handedModel(result: unknown): ClientRippleHanded {
    const r = record(result) ?? {};
    const decisionId = positiveId(r.decision_id);
    const proposalId = positiveId(r.proposal_id);
    const state = String(r.state);
    if (r.ok !== true || !HANDED_STATES.has(state))
      return { state: "refused", line: refusedLine(r), decisionId: null, proposalId };
    const handed = state as Exclude<ClientRippleHanded["state"], "refused">;
    const line = handed === "waiting" && r.plan_moved === true ? LINES.moved : LINES[handed];
    return { state: handed, line, decisionId, proposalId };
  }

  /** The Changes feed row for this decision (the same row, and Undo, the feed shows), or null. */
  function findChange(read: unknown, decisionId: number | null): BrainChange | null {
    if (decisionId == null) return null;
    const data = record(read) as Partial<BrainChanges> | null;
    for (const day of Array.isArray(data?.days) ? data.days : []) {
      for (const change of Array.isArray(day?.changes) ? day.changes : []) {
        if (Number(change?.id) === decisionId) return change;
      }
    }
    return null;
  }

  const CAIRN_RIPPLE_CARD_MODEL = {
    answer: answerModel,
    handed: handedModel,
    findChange,
    question: fullQuestion,
    questionBody,
  };

  Object.assign(globalThis, { CairnRippleCardModel: CAIRN_RIPPLE_CARD_MODEL });
}
