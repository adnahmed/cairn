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
import { pickDayVariant } from "../../repo/brain/day-read-rules.js";
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
// spoken voice (never the machine `summary`/`reason` prose, never a leaked internal),
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

function touched(decision: BrainDecision): Touched {
  const action = (decision.action ?? {}) as Record<string, any>;
  const base = { recoveryCycle: Number(action.recovery_cycle_id) > 0 };
  if (Array.isArray(action.changes) || Array.isArray(action.swaps))
    return { ...base, ...payloadTouched(action.changes, action.swaps) };
  // An announced change has not written its action yet; its draft says what it will do.
  const proposalId = Number(action.proposal_id);
  if (proposalId > 0) {
    try {
      const parsed = (getProposal(proposalId) as any)?.parsed ?? {};
      const changes = Array.isArray(parsed.changes) ? parsed.changes : [];
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
    } catch {
      /* an unreadable draft only thins the label */
    }
  }
  return { ...base, exercises: [], swaps: [] };
}

// ---------- the athlete register ----------

// Machine prefixes producers write into `instruction`/`rationale` ("auto: …",
// "case conference: …") — a record of who drafted it, not a sentence for a person.
const MACHINE_PREFIX = /^\s*[a-z][a-z -]{1,30}:\s/i;

function spoken(text: unknown, max: number): string | null {
  const value = clipText(text, max, { collapseWhitespace: true, wordBoundary: true, sentenceBoundary: true });
  if (!value || MACHINE_PREFIX.test(value) || violatesReadingGrammar(value)) return null;
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

function changeTitle(decision: BrainDecision, what: Touched): string {
  const written = spoken(decision.summary, 140);
  if (written) return written;
  if (what.swaps.length === 1) return `Swapped ${what.swaps[0].from} for ${what.swaps[0].to}`;
  if (decision.kind === "training_target" && what.exercises.length === 1)
    return `Moved your ${what.exercises[0]} target`;
  return TITLE_FALLBACK[String(decision.kind)] ?? "Made a coaching change";
}

// Spoken fallbacks, rotated by day so a quiet week does not print one literal on
// every row (the day-read variant law, applied here).
const WHY_FALLBACK: Record<string, readonly string[]> = {
  training: [
    "Your recent sessions moved, so the plan moved with them.",
    "What you logged lately pointed this way, so the team followed it.",
  ],
  recovery: [
    "Your recent load and recovery asked for an easier stretch.",
    "The last few days called for more room to recover.",
  ],
  nutrition: [
    "Your recent weigh-ins and meals pointed this way.",
    "The trend in what you logged asked for this adjustment.",
  ],
  other: ["The team read your recent signals and made this call.", "Your recent picture pointed this way."],
};

function changeWhy(decision: BrainDecision, day: string): string | null {
  const action = (decision.action ?? {}) as Record<string, unknown>;
  const written = spoken(action.user_explanation, 700) ?? spoken(decision.rationale, 700);
  if (written) return written;
  const set = WHY_FALLBACK[String(decision.domain)] ?? WHY_FALLBACK.other;
  return pickDayVariant(set, day, `change:${decision.id}`);
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
  const eventMs = eventAt ? Date.parse(eventAt) : Number.NaN;
  const what = touched(decision);
  const { expectation, evaluation } = latestOutcome(decision);
  const key = outcomeKey(state, evaluation);
  const landsOn = state === "announced" ? String(decision.effective_date ?? "").slice(0, 10) || null : null;
  return {
    id: decision.id,
    day,
    state,
    domain: String(decision.domain),
    title: changeTitle(decision, what),
    why: changeWhy(decision, asOf),
    status_line: statusLine(state, day, landsOn, asOf),
    lands_on: landsOn,
    outcome: { key, phrase: BRAIN_CHANGE_OUTCOME_PHRASES[key] },
    confidence: confidenceWord(expectation),
    undo: undoFor(decision, state, what),
    new: Number.isFinite(eventMs) && eventMs > seenFrom && !athleteAsked(decision),
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
