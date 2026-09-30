// A run already in today, and today's lift is a leg day. The run engine and the
// acute gate count the run's leg dose honestly, but a moderate run sits under the
// bars that would move the lift, so the Brief would serve the full leg day as if
// the legs were fresh. This offers the athlete the choice instead: upper instead,
// lighter legs, or rest. A suggestion, never a gate — the planned day stays one
// tap away beside it, and nothing here changes the plan or the prescription.
//
// Reads only today's lift line (repo/today-strength-line.ts: the plan day, its
// state and the run) and the plan day's own muscle groups; never re-derives
// either. Derived fresh per response, never persisted (see attachDayReadContext).
import { pickDayVariant } from "./brain/day-read-rules.js";
import { HEAVY_LOWER_GROUPS, planDayCandidates } from "./plan-selection.js";
import type { TodayStrengthLine } from "./today-strength-line.js";

export type RunLegChoiceKey = "upper" | "lighter" | "rest";

export interface RunLegChoiceOption {
  key: RunLegChoiceKey;
  label: string;
  /** What the session request asks for, verbatim; null for rest (no session). */
  focus: string | null;
  constraints: string | null;
}

export interface RunLegChoice {
  line: string;
  options: RunLegChoiceOption[];
}

// Several phrasings of the same offer (VISION.md Amendment 2), rotated by date.
const LINES: readonly ((title: string) => string)[] = [
  (t) => `You've already run today, and ${t} is mostly legs. Want to shift it?`,
  (t) => `The run already worked your legs, and ${t} asks for them again. Pick what suits you.`,
  (t) => `Your legs have a run in them already. ${t} can stay, lighten, or wait.`,
];

const UPPER_CONSTRAINTS = "already ran today — spare the legs";
const LIGHTER_CONSTRAINTS =
  "already ran today — lighter leg session: fewer sets, moderate loads, no jumps or heavy lowering work";

// Every literal/templated string this module can produce, for the grammar test.
export function runLegChoiceGrammarPool(): string[] {
  return [...LINES.map((line) => line("Lower A")), "Upper instead", "Lighter legs", "Rest"];
}

const LEG_GROUPS: ReadonlySet<string> = new Set([...HEAVY_LOWER_GROUPS, "calves"]);

// Mostly legs: at least half the plan day's groups are lower body, and one of them
// is a main lower group (a calves-and-core day is not a leg day).
export function isLegPlanDay(groups: readonly string[]): boolean {
  const all = groups.filter(Boolean);
  if (!all.length) return false;
  const legs = all.filter((g) => LEG_GROUPS.has(g));
  return legs.some((g) => HEAVY_LOWER_GROUPS.has(g)) && legs.length * 2 >= all.length;
}

// null unless: a run is logged today, today's lift has not started, and the plan
// day is mostly legs. An athlete who already steered the read (override) has made
// their call, so the offer steps aside.
export function buildRunLegChoice(
  date: string,
  line: TodayStrengthLine | null | undefined,
  opts: { override?: string | null } = {}
): RunLegChoice | null {
  if (!line || !line.run_in || line.state !== "not_started" || line.day_number == null) return null;
  if (opts.override && String(opts.override).trim()) return null;
  const day = planDayCandidates().find((c) => c.day_number === line.day_number);
  if (!day || !isLegPlanDay(day.groups)) return null;
  const title = String(line.title || day.name || "Today's lift").trim();
  return {
    line: pickDayVariant(LINES, date, "run_leg_choice_line")(title),
    options: [
      { key: "upper", label: "Upper instead", focus: "upper body", constraints: UPPER_CONSTRAINTS },
      { key: "lighter", label: "Lighter legs", focus: day.focus || title, constraints: LIGHTER_CONSTRAINTS },
      { key: "rest", label: "Rest", focus: null, constraints: null },
    ],
  };
}
