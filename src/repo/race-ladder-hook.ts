// ============================================================================
// race-ladder-hook.ts — the race ladder's peak, reachable from the run engine.
//
// The race ladder (`raceLadderFor`, race-build.ts) walks the engine's own prescription
// week by week to race day, and that walk is the ONE answer to "where does this build
// land". The engine's race-feasibility sentence (weeklyRunPlan) must say the same
// number — but race-build imports the engine, so the engine cannot import it back.
// race-build registers the walk here; this module imports nothing, so it is always
// fully evaluated before either side touches it, whatever the load order.
// ============================================================================

export interface RaceLadderPlanDraft {
  available: boolean;
  runs: Array<{ kind_label: string; target_distance_km?: number | null }>;
  goal_feasibility?: { capacity?: any } | null;
}

export type RaceLadderPeakFn = (asOf: string, plan: RaceLadderPlanDraft) => number | null;

let hook: RaceLadderPeakFn | null = null;
let walking = false;
let walkingReads = 0;

/**
 * For src/repo/request-memo.ts: whether a ladder walk is in progress, and how many times
 * a read has asked. A read that asked can answer differently inside a walk than outside
 * one, so its memoized value is only ever served back under the same walk state.
 */
export function raceLadderWalkGuard(): { active: boolean; reads: number } {
  return { active: walking, reads: walkingReads };
}

export function registerRaceLadderPeak(fn: RaceLadderPeakFn): void {
  hook = fn;
}

/**
 * The ladder's peak-week km for the build `plan` starts, or null when there is no race
 * ladder to read (no hook, no dated race, the peak already behind). Not reentrant: a
 * ladder that reads the engine's next week (once this week is banked) gets null from
 * that nested plan, which then falls back to its own ramp read.
 */
export function raceLadderPeak(asOf: string, plan: RaceLadderPlanDraft): number | null {
  walkingReads++;
  if (!hook || walking) return null;
  walking = true;
  try {
    return hook(asOf, plan);
  } catch {
    return null;
  } finally {
    walking = false;
  }
}
