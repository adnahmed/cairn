import type { BrainDecision, BrainDecisionKind } from "../../brain/decision-contract.js";
import type { BrainExpectation } from "../../brain/expectation-contract.js";
import type { BrainEvaluation } from "../../brain/evaluation-contract.js";
import {
  BRAIN_CHANGE_OUTCOME_PHRASES,
  type ClientBrainChange,
  type ClientBrainChangeConfidence,
  type ClientBrainChangeDay,
  type ClientBrainChangeOutcomeKey,
  type ClientBrainChanges,
  type ClientBrainChangesSeenResponse,
  type ClientBrainChangeState,
} from "../../contracts/brain-changes.js";
import { getBrainRollback, listBrainDecisions, listBrainExpectations } from "../../repo/brain-decisions.js";
import { latestBrainEvaluation } from "../../repo/brain-evaluations.js";
import { getAppState, setAppState } from "../../repo/app-state.js";
import { getProposal } from "../../repo/proposals.js";
import { violatesReadingGrammar } from "../../repo/day-read-grammar.js";
import {
  addDaysISO,
  clipText,
  localDateISO,
  localDayOfStamp,
  localHourFraction,
  parseDbTime,
} from "../../repo/shared.js";

// ============================================================================
// THE CHANGES FEED — what the team changed, why, how it went, and Undo.
//
// A read-only, deterministic PROJECTION of `brain_decisions` for a person (v2 wave 1).
// It invents nothing: every row is a decision the ledger already holds, and Undo is
// the existing server revert (`revertDecision`) over the snapshot the autonomy layer
// stored. What it adds is the athlete register — a finished title, the why in the
// spoken voice (never signal-state `summary`/`reason` prose, never a producer label),
// one of the four fixed outcome phrases, a confidence WORD, and the Undo label naming
// the concrete effect. No evaluator verdict text, score or number-as-grade crosses it.
//
// Which rows are CHANGES: a coaching kind the TEAM decided — autonomy tier
// `quiet_apply` or `announce` — that is announced, in effect, put back, or held by the
// athlete before it landed. A change the athlete applied by hand answered an ask
// (tier `ask`) and is their own action, not the team's; advisories, day reads,
// directives and data plumbing (Garmin merges) are not changes to a plan.
// ============================================================================

const CHANGE_KINDS: ReadonlySet<string> = new Set<BrainDecisionKind>([
  "training_target",
  "training_structure",
  "exercise_rotation",
  "nutrition_target",
  "meal_plan",
  "recovery_adjustment",
  "lifestyle_adjustment",
  "goal_change",
]);
const TEAM_TIERS: ReadonlySet<string> = new Set(["quiet_apply", "announce"]);

// The app_state key holding the ISO instant the athlete last opened the feed.
export const BRAIN_CHANGES_SEEN_KEY = "brain_changes_seen_at";
// Before the feed was ever opened there is no marker; the Today line then counts only
// what landed in the last day rather than shouting the whole ledger at a first open.
const UNSEEN_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 14;
const DEFAULT_LIMIT = 40;

type Row = ClientBrainChange & { event_at: string | null };

function stamp(value: unknown): string | null {
  const parsed = parseDbTime(value);
  return parsed ? parsed.toISOString() : null;
}

function heldByAthlete(decision: BrainDecision): boolean {
  const context = (decision.context ?? {}) as Record<string, unknown>;
  return decision.status === "canceled" && context.held_by_user === true;
}

function changeState(decision: BrainDecision): ClientBrainChangeState | null {
  if (decision.status === "announced") return "announced";
  if (decision.status === "reverted") return "reverted";
  if (heldByAthlete(decision)) return "held";
  // `superseded` after landing is still a change that happened; only its Undo is gone.
  if (decision.status === "applied" || (decision.status === "superseded" && decision.applied_at)) return "applied";
  return null;
}

function isTeamChange(decision: BrainDecision): boolean {
  return CHANGE_KINDS.has(String(decision.kind)) && TEAM_TIERS.has(String(decision.autonomy_tier));
}

// The athlete asked for it in their own words: it is in the feed, but it is not news.
function athleteAsked(decision: BrainDecision): boolean {
  const context = (decision.context ?? {}) as Record<string, unknown>;
  return context.explicit_user_request === true || context.athlete_requested_restructure === true;
}

// ---------- what the change touched (for the title fallback and the Undo label) ----------

interface Touched {
  exercises: string[];
  swaps: Array<{ from: string; to: string }>;
  recoveryCycle: boolean;
}

function payloadTouched(changes: unknown, swaps: unknown): Pick<Touched, "exercises" | "swaps"> {
  const swapList = (Array.isArray(swaps) ? swaps : [])
    .map((swap: any) => ({ from: String(swap?.from ?? "").trim(), to: String(swap?.to ?? "").trim() }))
    .filter((swap) => swap.from && swap.to);
  const exercises = [
    ...new Set(
      (Array.isArray(changes) ? changes : [])
        .map((change: any) => String(change?.exercise ?? "").trim())
        .filter(Boolean)
    ),
  ];
  return { exercises, swaps: swapList };
}

// The draft a plan-proposal decision was routed from, read once per row. Null when the
// decision has no draft behind it, or the draft cannot be read.
interface Draft {
  instruction: string;
  parsed: Record<string, any>;
}

function draftOf(decision: BrainDecision): Draft | null {
  const action = (decision.action ?? {}) as Record<string, any>;
  const proposalId =
    Number(action.proposal_id) ||
    (decision.source_ref_type === "plan_proposal" ? Number(decision.source_ref_key) : Number.NaN);
  if (!(proposalId > 0)) return null;
  try {
    const proposal = getProposal(proposalId) as any;
    if (!proposal) return null;
    const parsed = proposal.parsed && typeof proposal.parsed === "object" ? proposal.parsed : {};
    return { instruction: String(proposal.instruction ?? ""), parsed };
  } catch {
    return null; // an unreadable draft only thins the row
  }
}

function touched(decision: BrainDecision, draft: Draft | null): Touched {
  const action = (decision.action ?? {}) as Record<string, any>;
  const base = { recoveryCycle: Number(action.recovery_cycle_id) > 0 };
  if (Array.isArray(action.changes) || Array.isArray(action.swaps))
    return { ...base, ...payloadTouched(action.changes, action.swaps) };
  // An announced change has not written its action yet; its draft says what it will do.
  if (draft) {
    const changes = Array.isArray(draft.parsed.changes) ? draft.parsed.changes : [];
    const swaps = changes
      .filter((change: any) => change?.swap?.from && change?.swap?.to)
      .map((change: any) => change.swap);
    return {
      ...base,
      ...payloadTouched(
        changes.filter((change: any) => !change?.swap),
        swaps
      ),
    };
  }
  return { ...base, exercises: [], swaps: [] };
}

// ---------- the athlete register ----------

// Producers' own prefixes on `instruction`/`rationale` ("auto: …", "case conference: …")
// — a record of who drafted it, not a sentence for a person. Narrowed to the known
// producers, so an athlete-facing sentence that opens "Heads up: …" still reads.
const MACHINE_PREFIX = /^\s*(?:auto|case conference|chat|background|nutrition):\s/i;

// Producers whose `summary` is a templated label for the ledger, not a headline
// ("Auto-progression for day 1 — 2 lifts", "Rotate A → B on day 3"). Their title is
// worded from what the change touched instead.
const LABEL_SUMMARY_SOURCES: ReadonlySet<string> = new Set(["auto-progression", "auto-run-plan", "exercise-swap"]);
// A plan-day NUMBER and an arrow are the ledger's shorthand, never the athlete's words.
const LABEL_SHAPE = /\bday \d+\b|→|->/i;

// True when `a` is `b`, or a clipped copy of it.
function sameText(a: unknown, b: unknown): boolean {
  // A clipped copy ends in an ellipsis; compare what is left of it as a prefix.
  const norm = (value: unknown) =>
    String(value ?? "")
      .replace(/\s+/g, " ")
      .replace(/(?:…|\.\.\.)$/, "")
      .trim()
      .toLowerCase();
  const clipped = norm(a);
  const full = norm(b);
  return !!clipped && !!full && full.startsWith(clipped);
}

function spoken(text: unknown, max: number, draft: Draft | null = null): string | null {
  const value = clipText(text, max, { collapseWhitespace: true, wordBoundary: true, sentenceBoundary: true });
  if (!value || MACHINE_PREFIX.test(value) || violatesReadingGrammar(value)) return null;
  // The decision's rationale falls back to the draft's `instruction` when the draft
  // wrote no rationale — the producer's label ("day 1 progression", "swap A → B",
  // "evolve program") or an agent-facing instruction. Never a why.
  if (draft && sameText(value, draft.instruction)) return null;
  return value;
}

const TITLE_FALLBACK: Record<string, string> = {
  training_target: "Moved a training target",
  training_structure: "Reshaped your training week",
  exercise_rotation: "Rotated an exercise",
  nutrition_target: "Adjusted your calorie target",
  meal_plan: "Refreshed your meal plan",
  recovery_adjustment: "Eased the week for recovery",
  lifestyle_adjustment: "Adjusted a daily habit",
  goal_change: "Adjusted your goal timeline",
};

function writtenTitle(decision: BrainDecision, draft: Draft | null): string | null {
  if (LABEL_SUMMARY_SOURCES.has(String(decision.source ?? ""))) return null;
  const written = spoken(decision.summary, 140, draft);
  return written && !LABEL_SHAPE.test(written) ? written : null;
}

function changeTitle(decision: BrainDecision, what: Touched, draft: Draft | null): string {
  const written = writtenTitle(decision, draft);
  if (written) return written;
  const { swaps, exercises } = what;
  if (swaps.length === 1 && !exercises.length) return `Swapped ${swaps[0].from} for ${swaps[0].to}`;
  if (decision.kind === "training_target" || decision.kind === "exercise_rotation") {
    if (exercises.length === 1 && !swaps.length) return `Moved your ${exercises[0]} target`;
    if (exercises.length === 2 && !swaps.length) return `Moved your ${exercises[0]} and ${exercises[1]} targets`;
    const lifts = exercises.length + swaps.length;
    if (lifts > 1) return `Moved your targets on ${lifts} lifts`;
  }
  return TITLE_FALLBACK[String(decision.kind)] ?? "Made a coaching change";
}

// The why is only ever a sentence someone WROTE for the athlete: the action's own
// explanation, the draft's rationale, or — for a one-lift change — that lift's own
// reason. When none survives, the why is null rather than a cause nobody recorded.
function changeWhy(decision: BrainDecision, draft: Draft | null): string | null {
  const action = (decision.action ?? {}) as Record<string, unknown>;
  const written =
    spoken(action.user_explanation, 700, draft) ??
    (draft ? spoken(draft.parsed.rationale, 700, draft) : spoken(decision.rationale, 700));
  if (written) return written;
  const changes = draft && Array.isArray(draft.parsed.changes) ? draft.parsed.changes : [];
  if (changes.length === 1) {
    const reason = spoken(changes[0]?.reason, 400, draft);
    // A bare delta ("+5 lb") is a number, not a reason.
    if (reason && reason.split(/\s+/).length >= 3) return reason;
  }
  return null;
}

// ---------- outcome and confidence ----------

function latestOutcome(decision: BrainDecision): {
  expectation: BrainExpectation | null;
  evaluation: BrainEvaluation | null;
} {
  if (!decision.id) return { expectation: null, evaluation: null };
  let best: { expectation: BrainExpectation; evaluation: BrainEvaluation | null; when: string } | null = null;
  for (const expectation of listBrainExpectations({ decisionId: decision.id, limit: 12 })) {
    // A window a newer change took over never earns a verdict about THIS change.
    if (expectation.status === "superseded") continue;
    const evaluation = expectation.id ? latestBrainEvaluation(expectation.id) : null;
    const when = String(evaluation?.evaluated_at ?? expectation.window_end ?? expectation.created_at ?? "");
    if (!best || (!!evaluation && !best.evaluation) || (!!evaluation === !!best.evaluation && when > best.when))
      best = { expectation, evaluation, when };
  }
  return best
    ? { expectation: best.expectation, evaluation: best.evaluation }
    : { expectation: null, evaluation: null };
}

function outcomeKey(state: ClientBrainChangeState, evaluation: BrainEvaluation | null): ClientBrainChangeOutcomeKey {
  if (state === "reverted" || state === "held" || evaluation?.verdict === "canceled") return "stopped";
  if (evaluation?.verdict === "aligned") return "as_expected";
  if (evaluation?.verdict === "not_aligned") return "not_as_expected";
  return "too_early";
}

function confidenceWord(expectation: BrainExpectation | null): ClientBrainChangeConfidence {
  const word = String(expectation?.confidence ?? "");
  return word === "strong" || word === "observed" ? word : "tentative";
}

// ---------- Undo, labelled by the server ----------

function restoreLabel(decision: BrainDecision, what: Touched): string {
  if (what.recoveryCycle) return "Return to your regular week";
  switch (decision.kind) {
    case "training_target":
      return what.exercises.length === 1 ? `Restore previous ${what.exercises[0]} target` : "Restore previous targets";
    case "exercise_rotation":
      return what.swaps.length === 1 ? `Bring back ${what.swaps[0].from}` : "Restore previous exercises";
    case "training_structure":
      return "Restore your previous week";
    case "nutrition_target":
      return "Restore previous calorie target";
    case "meal_plan":
      return "Restore previous meal plan";
    case "goal_change":
      return "Restore previous goal date";
    case "recovery_adjustment":
      return "Return to your regular week";
    default:
      return "Undo this change";
  }
}

function holdLabel(decision: BrainDecision, what: Touched): string {
  switch (decision.kind) {
    case "training_target":
      return what.exercises.length === 1
        ? `Keep your current ${what.exercises[0]} target`
        : "Keep your current targets";
    case "exercise_rotation":
      return what.swaps.length === 1 ? `Keep ${what.swaps[0].from}` : "Keep your current exercises";
    case "training_structure":
    case "recovery_adjustment":
      return "Keep your week as it is";
    case "nutrition_target":
      return "Keep your current calorie target";
    case "meal_plan":
      return "Keep your current meal plan";
    case "goal_change":
      return "Keep your current goal date";
    default:
      return "Don't make this change";
  }
}

// Mirrors what revertDecision will accept: an announced change is held (canceled), an
// applied one is restored only while it is reversible AND its snapshot exists.
function undoFor(decision: BrainDecision, state: ClientBrainChangeState, what: Touched) {
  if (state === "announced") return { available: true, label: holdLabel(decision, what) };
  if (state === "applied" && decision.status === "applied" && decision.reversible && decision.id) {
    let rollback: unknown = null;
    try {
      rollback = getBrainRollback(decision.id);
    } catch {
      rollback = null;
    }
    if (rollback) return { available: true, label: restoreLabel(decision, what) };
  }
  return { available: false, label: null };
}

// ---------- day words ----------

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function weekday(day: string): string {
  const ms = Date.parse(`${day}T12:00:00Z`);
  return Number.isFinite(ms) ? WEEKDAYS[new Date(ms).getUTCDay()] : day;
}

function monthDay(day: string): string {
  const ms = Date.parse(`${day}T12:00:00Z`);
  if (!Number.isFinite(ms)) return day;
  const date = new Date(ms);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function dayWord(day: string, asOf: string): string {
  if (day === asOf) return "today";
  if (day === addDaysISO(asOf, -1)) return "yesterday";
  if (day === addDaysISO(asOf, 1)) return "tomorrow";
  const nearPast = (addDaysISO(asOf, -6) ?? asOf) <= day && day < asOf;
  const nearFuture = asOf < day && day <= (addDaysISO(asOf, 6) ?? asOf);
  return nearPast || nearFuture ? weekday(day) : monthDay(day);
}

function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function statusLine(state: ClientBrainChangeState, day: string, landsOn: string | null, asOf: string): string {
  if (state === "announced") return landsOn ? `Lands ${dayWord(landsOn, asOf)}` : "Lands soon";
  if (state === "reverted") return "Put back";
  if (state === "held") return "Held before it landed";
  return `Landed ${dayWord(day, asOf)}`;
}

// ---------- the read ----------

function seenMarker(): string | null {
  const raw = getAppState(BRAIN_CHANGES_SEEN_KEY);
  return raw ? stamp(raw) : null;
}

function projectDecision(decision: BrainDecision, asOf: string, floor: string, seenFrom: number): Row | null {
  if (!isTeamChange(decision) || decision.id == null) return null;
  const state = changeState(decision);
  if (!state) return null;
  const decidedDay = localDayOfStamp(decision.created_at) ?? "";
  const landedDay =
    String(decision.effective_date ?? "").slice(0, 10) || localDayOfStamp(decision.applied_at) || decidedDay;
  const day = state === "announced" || state === "held" ? decidedDay : landedDay;
  if (!day) return null;
  // Announced changes are forward-looking, so they stay until they land or are held.
  if (state !== "announced" && day < floor) return null;
  const eventAt =
    state === "applied" ? stamp(decision.applied_at) : state === "announced" ? stamp(decision.created_at) : null;
  // ONE piece of news per decision, at its first surfacing: an announced change is news
  // when it is announced, and landing later is the same decision, not a second one. A
  // quiet change is never shown while pending, so it first surfaces when it lands.
  const surfacedAt =
    state === "announced" || (state === "applied" && decision.autonomy_tier === "announce")
      ? stamp(decision.created_at)
      : state === "applied"
        ? stamp(decision.applied_at)
        : null;
  const surfacedMs = surfacedAt ? Date.parse(surfacedAt) : Number.NaN;
  const draft = draftOf(decision);
  const what = touched(decision, draft);
  const { expectation, evaluation } = latestOutcome(decision);
  const key = outcomeKey(state, evaluation);
  const landsOn = state === "announced" ? String(decision.effective_date ?? "").slice(0, 10) || null : null;
  return {
    id: decision.id,
    day,
    state,
    domain: String(decision.domain),
    title: changeTitle(decision, what, draft),
    why: changeWhy(decision, draft),
    status_line: statusLine(state, day, landsOn, asOf),
    lands_on: landsOn,
    outcome: { key, phrase: BRAIN_CHANGE_OUTCOME_PHRASES[key] },
    confidence: confidenceWord(expectation),
    undo: undoFor(decision, state, what),
    new: Number.isFinite(surfacedMs) && surfacedMs > seenFrom && !athleteAsked(decision),
    event_at: eventAt,
  };
}

function dayGroupLabel(day: string, asOf: string): string {
  return capitalize(dayWord(day, asOf));
}

function sinceSeenLine(count: number, rows: Row[], asOf: string, now: Date): string | null {
  if (count <= 0) return null;
  const noun = count === 1 ? "change" : "changes";
  const yesterday = addDaysISO(asOf, -1) ?? asOf;
  const overnight =
    localHourFraction(now) < 12 &&
    rows.filter((row) => row.new).every((row) => row.day === asOf || row.day === yesterday);
  return overnight ? `${count} ${noun} overnight` : `${count} ${noun} since you last looked`;
}

export function brainChangesRead(
  opts: { days?: number; limit?: number; asOf?: string; now?: Date } = {}
): ClientBrainChanges {
  const now = opts.now ?? new Date();
  const asOf = opts.asOf ?? localDateISO(now);
  const windowDays = Math.max(1, Math.min(90, Math.trunc(Number(opts.days) || DEFAULT_WINDOW_DAYS)));
  const limit = Math.max(1, Math.min(200, Math.trunc(Number(opts.limit) || DEFAULT_LIMIT)));
  const floor = addDaysISO(asOf, -windowDays) ?? asOf;
  const seenAt = seenMarker();
  const seenFrom = seenAt ? Date.parse(seenAt) : now.getTime() - UNSEEN_LOOKBACK_MS;
  const candidates = [
    ...listBrainDecisions({ status: "announced", limit: 100 }),
    ...listBrainDecisions({ status: "applied", limit: 200 }),
    ...listBrainDecisions({ status: "reverted", limit: 100 }),
    ...listBrainDecisions({ status: "canceled", limit: 100 }),
    ...listBrainDecisions({ status: "superseded", limit: 100 }),
  ];
  const rows: Row[] = [];
  for (const decision of candidates) {
    try {
      const row = projectDecision(decision, asOf, floor, seenFrom);
      if (row) rows.push(row);
    } catch {
      // Per-row isolation: one unreadable decision thins the feed, never breaks it.
    }
  }
  rows.sort(
    (a, b) =>
      b.day.localeCompare(a.day) || String(b.event_at ?? "").localeCompare(String(a.event_at ?? "")) || b.id - a.id
  );
  const shown = rows.slice(0, limit);
  const groups: ClientBrainChangeDay[] = [];
  for (const { event_at: _eventAt, ...change } of shown) {
    const last = groups[groups.length - 1];
    if (last && last.day === change.day) last.changes.push(change);
    else groups.push({ day: change.day, label: dayGroupLabel(change.day, asOf), changes: [change] });
  }
  // Counted over the rows actually returned, so the Today line always equals the
  // number of new rows the feed shows.
  const sinceSeen = shown.filter((row) => row.new).length;
  return {
    as_of: asOf,
    days: groups,
    since_seen: sinceSeen,
    since_seen_line: sinceSeenLine(sinceSeen, shown, asOf, now),
    seen_at: seenAt,
    seen_through: now.toISOString(),
  };
}

// The athlete opened the feed. `through` is the instant the feed they looked at was read
// (`seen_through`), so a change that lands between the read and this call stays new. The
// marker never moves backwards and never ahead of now.
export function markBrainChangesSeen(opts: { through?: unknown; now?: Date } = {}): ClientBrainChangesSeenResponse {
  const now = opts.now ?? new Date();
  const requested = opts.through == null || opts.through === "" ? null : parseDbTime(opts.through);
  const through = requested && requested.getTime() < now.getTime() ? requested : now;
  const current = seenMarker();
  const next = current && Date.parse(current) > through.getTime() ? current : through.toISOString();
  setAppState(BRAIN_CHANGES_SEEN_KEY, next);
  return { ok: true, seen_at: next };
}
