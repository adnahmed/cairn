// What each one-tap context tag actually CHANGES, in one plain sentence per tag.
//
// The vocabulary itself lives in src/contextTags.ts (one contract). This module never
// re-declares it: it asks the active-context engine (src/repo/context-effect.ts) what a
// tag on a day would set — exactly the flags the day read, the signal state and the
// fueling reads act on — and words those flags. Every tag also rides as a confounder
// on any change being evaluated across its day (src/domain/brain/evaluation-service.ts)
// and as volunteered evidence for the insight search, so that clause is always true.
// The sheet on Today prints these verbatim; nothing here invents an effect.
import { CONTEXT_TAG_VOCAB, type ContextTagDef } from "../contextTags.js";
import { activeContextEffect } from "./context-effect.js";
import { localDateISO } from "./shared.js";

export interface ContextTagVocabEntry extends ContextTagDef {
  /** One or two sentences: what tapping this tag changes today. */
  effect: string;
}

const ALWAYS = "The coach knows it today, and a change being tested across this day isn't judged on it.";

export function contextTagEffect(key: string, date: string = localDateISO()): string {
  let flags = { reduce_load: false, expect_worse_sleep: false, fueling_disrupted: false };
  try {
    flags = activeContextEffect(date, [{ kind: "tag", title: key, start_date: date, end_date: date }]);
  } catch {
    // The always-true clause stands alone.
  }
  const lead = flags.reduce_load
    ? "Sessions ease off while it lasts."
    : flags.expect_worse_sleep
      ? "The read expects a thinner night and goes easier on recovery."
      : flags.fueling_disrupted
        ? "Food targets hold, and a noisy day of meals or weigh-ins won't move them."
        : "";
  return lead ? `${lead} ${ALWAYS}` : ALWAYS;
}

/** The vocabulary with each tag's effect — GET /api/context-tags/vocab. */
export function contextTagVocab(date: string = localDateISO()): ContextTagVocabEntry[] {
  return CONTEXT_TAG_VOCAB.map((tag) => ({ ...tag, effect: contextTagEffect(tag.key, date) }));
}
