// ONE GOAL, SAID ONCE. The profile holds the athlete's goal weight and goal date; the
// active journey phase holds its own target weight and end date. The two are written
// by different paths (the profile form and chat, a phase created from a suggestion),
// so they can drift apart. This read reports any disagreement in plain words. It
// never writes: neither side is overwritten to make the other win, because only the
// athlete knows which one still stands.
//
// What is compared, and why only that:
// - Exactly one phase should be active. More than one is reported as its own line
//   (activateJourneyPhase heals it the next time a phase is activated).
// - Only a phase that HEADS to the goal (a cut or a gain) is compared with it. A
//   maintenance, diet-break or reverse phase is a deliberate stop on the way, so its
//   holding weight and its end date are not a second goal.
// - Weight: both set and at least WEIGHT_TOLERANCE_LB apart.
// - Date: both set and different. An open-ended phase, or a goal with no date, is
//   not a disagreement; it just says less.
import { db } from "../db.js";
import { isoDate, isoDay } from "../lib/dates.js";
import { finite, round1 } from "../lib/numbers.js";
import { getProfile } from "./profile.js";

export const WEIGHT_TOLERANCE_LB = 0.5;
/** Body-fat targets within this many percentage points are the same goal. */
export const BODYFAT_TOLERANCE_PCT = 0.5;

/** A cut or a gain heads to the goal; every other phase kind is a stop on the way. */
export const GOAL_DIRECTED_PHASE_KINDS: ReadonlySet<string> = new Set(["cut", "gain"]);

export type GoalDisagreementField = "goal_weight" | "goal_date" | "active_phases";

export interface GoalDisagreement {
  field: GoalDisagreementField;
  /** The profile's side (goal weight in lb, goal date as YYYY-MM-DD; null for active_phases). */
  profile_value: number | string | null;
  /** The phase's side (target weight in lb, end date, or the number of active phases). */
  phase_value: number | string | null;
  /** One plain sentence naming both sides. */
  words: string;
}

export interface GoalConsistencyPhase {
  id: number;
  kind: string;
  target_weight_lb: number | null;
  end_date: string | null;
  /** A cut or a gain: a phase whose target is meant to be the goal itself. */
  heads_to_goal: boolean;
}

export interface GoalConsistencyRead {
  /** True when nothing disagrees (including when there is nothing to compare). */
  consistent: boolean;
  goal: { weight_lb: number | null; date: string | null } | null;
  active_phase: GoalConsistencyPhase | null;
  active_phase_count: number;
  disagreements: GoalDisagreement[];
  /** The disagreements' words joined into one short paragraph; null when consistent. */
  summary: string | null;
}

export interface GoalConsistencyInputs {
  profile?: any;
  /** Every phase marked active, most recent first (the order activeJourneyPhase reads). */
  activePhases?: any[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function weight(v: unknown): number | null {
  const n = finite(v);
  return n != null && n > 0 ? round1(n) : null;
}

function spokenDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function spokenWeight(lb: number): string {
  return `${Number(lb.toFixed(1))} lb`;
}

function phaseName(kind: string): string {
  return kind.replace(/_/g, " ");
}

function readActivePhases(): any[] {
  try {
    return db
      .prepare(
        `SELECT * FROM journey_phases WHERE status = 'active' ORDER BY COALESCE(start_date, created_at) DESC, id DESC`
      )
      .all() as any[];
  } catch {
    return [];
  }
}

export function goalConsistencyRead(inputs: GoalConsistencyInputs = {}): GoalConsistencyRead {
  const profile = inputs.profile !== undefined ? inputs.profile : getProfile();
  const phases = inputs.activePhases ?? readActivePhases();
  const goal = profile ? { weight_lb: weight(profile.goal_weight_lb), date: isoDate(isoDay(profile.goal_date)) } : null;
  const top = phases[0] ?? null;
  const kind = top ? String(top.kind || "") : "";
  const activePhase: GoalConsistencyPhase | null = top
    ? {
        id: Number(top.id),
        kind,
        target_weight_lb: weight(top.target_weight_lb),
        end_date: isoDate(isoDay(top.end_date)),
        heads_to_goal: GOAL_DIRECTED_PHASE_KINDS.has(kind),
      }
    : null;

  const disagreements: GoalDisagreement[] = [];
  if (phases.length > 1) {
    disagreements.push({
      field: "active_phases",
      profile_value: null,
      phase_value: phases.length,
      words: `${phases.length} journey phases are marked active at once; the most recent one, a ${phaseName(kind)} phase, is the one being read.`,
    });
  }
  if (goal && activePhase?.heads_to_goal) {
    const name = phaseName(activePhase.kind);
    const gw = goal.weight_lb;
    const pw = activePhase.target_weight_lb;
    if (gw != null && pw != null && Math.abs(gw - pw) >= WEIGHT_TOLERANCE_LB) {
      disagreements.push({
        field: "goal_weight",
        profile_value: gw,
        phase_value: pw,
        words: `The profile goal is ${spokenWeight(gw)}, but the active ${name} phase is aiming for ${spokenWeight(pw)}.`,
      });
    }
    const gd = goal.date;
    const pd = activePhase.end_date;
    if (gd && pd && gd !== pd) {
      disagreements.push({
        field: "goal_date",
        profile_value: gd,
        phase_value: pd,
        words: `The profile goal date is ${spokenDate(gd)}, but the active ${name} phase ends ${spokenDate(pd)}.`,
      });
    }
  }

  return {
    consistent: disagreements.length === 0,
    goal,
    active_phase: activePhase,
    active_phase_count: phases.length,
    disagreements,
    summary: disagreements.length ? disagreements.map((d) => d.words).join(" ") : null,
  };
}
