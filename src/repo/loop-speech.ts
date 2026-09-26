// How the doctor loop speaks a marker to a PERSON — the one place its athlete-facing
// sentences are worded, so the next-checkup read, the visit questions and the
// evidence-wanted line never word the same ask three ways.
//
// Marker labels are display labels ("Hemoglobin and Iron", "Fasting insulin", "Vitamin
// D"). Set mid-sentence, a title-cased common noun reads machine-assembled ("Worth
// adding Fasting insulin to the next draw?"), so `spokenMarkerName` lower-cases the
// words that are plain Title-case nouns and leaves every analyte whose casing carries
// meaning exactly as written: ApoB, LDL-C, hs-CRP, Lp(a), HbA1c, TSH, eGFR, T4, the "D"
// in vitamin D. Pure; no DB, no clock.

// A plain Title-case word ("Ferritin", "Iron", "Fasting"): one capital, then lower case
// letters only, judged on the whole space-separated token (its wrapping brackets and
// trailing commas aside). "ApoB", "LDL-C", "Lp(a)", "HbA1c", "T4", "D" all fail it and
// keep their casing.
const TITLE_WORD = /^[A-Z][a-z]+$/;

function spokenWord(token: string): string {
  const m = /^([("]*)(.*?)([)",;:.]*)$/.exec(token);
  if (!m) return token;
  const [, lead, core, tail] = m;
  return TITLE_WORD.test(core) ? `${lead}${core.toLowerCase()}${tail}` : token;
}

/** A marker label as it reads mid-sentence: plain nouns lower-cased, analyte casing kept. */
export function spokenMarkerName(label: unknown): string {
  return String(label ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map(spokenWord)
    .join(" ");
}

/** "Is it time to recheck hemoglobin and iron?" — one follow-up, one question. */
export function recheckQuestion(item: { kind?: unknown; label?: unknown }): string {
  if (item.kind === "dexa") return "Is it time for a repeat body-composition (DEXA) scan?";
  const label = String(item.label ?? "").trim();
  if (item.kind === "review") return `The last health review suggested "${label}" — is now a good time for it?`;
  return `Is it time to recheck ${spokenMarkerName(label)}?`;
}

/** "Would it be worth adding fasting insulin to the next draw?" */
export function workupQuestion(label: unknown): string {
  return `Would it be worth adding ${spokenMarkerName(label)} to the next draw?`;
}

/** "How is my ferritin tracking — is it worth a recheck?" */
export function followThroughQuestion(marker: unknown): string {
  return `How is my ${spokenMarkerName(marker)} tracking — is it worth a recheck?`;
}
