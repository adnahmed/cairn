// THE ATHLETE'S OWN WORD ON HOW A RUN FELT.
//
// `activities.rpe` is the athlete's stated effort for one activity, 1 (nothing) to 10
// (all out) — typed on a log ("ran 50 min rpe 3"), set by the enricher from their own
// words, or stated after the fact (`setActivityFeltEffort`, activity-effort.ts). A
// watch never writes it, so it is always the athlete speaking.
//
// The owner law (2026-09-29): the athlete's own inputs come first, then the logged
// training, and a run is never graded by the watch's training-effect label or its
// generic zones over what he said. "I kept it conversational, it did not take a toll"
// at 157 bpm is a talk test passed, not an easy day blown.
//
// What a STATED-EASY run changes, and what it does not:
//   • its intensity bars (training effect, time at Z4+, load above the median) no
//     longer grade it hard for the harm read (`hardCardioDayCore`, training-read.ts);
//   • it counts as easy running in the intensity-discipline tally, whatever its
//     average (`runIntensityDiscipline`, run-progression.ts);
//   • the NEXT MORNING still outranks it — a rest-grade readiness or last night's
//     HRV/RHR past the athlete's own band is harm exactly as before
//     (`nextMorningPhysiologyBrake`), because a felt effort is a statement about the
//     run and the morning is the body's answer to it;
//   • a novel longest run and a poorly rated session stay what they were.
//
// Leaf module on purpose: the harm read and the HR model both ask it, and neither may
// pull the other in to do so.

/** Stated efforts at or under this read as easy — the talk-test band: full sentences
 * possible, "conversational", no toll. 5+ is working. */
export const STATED_EASY_RPE_MAX = 4;

/** Is this stated effort easy? Absent or malformed is NOT easy — silence says nothing. */
export function isStatedEasyRpe(rpe: unknown): boolean {
  if (rpe == null || rpe === "") return false;
  const value = Number(rpe);
  return Number.isFinite(value) && value >= 1 && value <= STATED_EASY_RPE_MAX;
}
