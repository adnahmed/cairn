// WHAT OF THIS WEEK IS ALREADY BEHIND THE ATHLETE — the one answer every week-layout
// read is handed (src/domain/training/week-layout.ts `closed`). A layout suggestion is
// advice about the days still ahead: it may never ask the athlete to move a lift they
// have already trained, onto a day that has already gone by, or to protect a key run
// they have already run. Every caller (the race build, the Plan strip, the coach
// context) derives that from the log through this helper, so the three can never
// disagree about which days are still open.
//
//   days       weekday slots (Mon = 1 … Sun = 7) before `asOf` in its Mon–Sun week,
//              plus `asOf` itself once a lift is logged on it (a session with sets).
//   runs_done  a long / quality intent the flexible agenda already reads as completed
//              this week — on whatever day it was run (a Thursday quality session run
//              on Tuesday is done, and Wednesday's legs no longer sit before it).
import { db } from "../db.js";
import { addDaysISO, mondayOf } from "../lib/dates.js";
import { type FlexibleTrainingAgenda, flexibleTrainingAgenda } from "./flexible-training-agenda.js";
import type { WeeklyRunPlan } from "./run-progression.js";

export interface WeekLayoutClosed {
  days: number[];
  runs_done: { long: boolean; quality: boolean };
}

function liftLoggedOn(date: string): boolean {
  try {
    const row = db
      .prepare(
        `SELECT 1 AS hit FROM sessions s WHERE s.date = ?
           AND EXISTS (SELECT 1 FROM logged_sets ls WHERE ls.session_id = s.id) LIMIT 1`
      )
      .get(date) as { hit?: number } | undefined;
    return !!row?.hit;
  } catch {
    return false;
  }
}

/**
 * `agenda` / `runPlan` are what the caller already holds: an agenda is read as-is; with
 * none, one is built off `runPlan` (or the engine's own week when that is absent too).
 * Fail-soft — an unreadable agenda closes no run.
 */
export function weekLayoutClosed(
  asOf: string,
  opts: { agenda?: FlexibleTrainingAgenda | null; runPlan?: WeeklyRunPlan | null } = {}
): WeekLayoutClosed {
  const days: number[] = [];
  const monday = mondayOf(asOf);
  for (let slot = 1; slot <= 7; slot++) {
    const date = addDaysISO(monday, slot - 1);
    if (!date) break;
    if (date < asOf || (date === asOf && liftLoggedOn(date))) days.push(slot);
  }
  let agenda: FlexibleTrainingAgenda | null = null;
  try {
    agenda =
      opts.agenda !== undefined
        ? opts.agenda
        : flexibleTrainingAgenda(asOf, opts.runPlan === undefined ? undefined : { runPlan: opts.runPlan });
  } catch {
    agenda = null;
  }
  const done = (kind: "long" | "quality"): boolean =>
    !!agenda?.available &&
    Array.isArray(agenda.intents) &&
    agenda.intents.some((intent) => intent.kind === kind && intent.status === "completed");
  return { days, runs_done: { long: done("long"), quality: done("quality") } };
}
