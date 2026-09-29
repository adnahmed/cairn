import { db } from "../db.js";
import { addDaysISO } from "./shared.js";
import { symptomAreaVocabularyLabel } from "./symptom-area.js";

// ============================================================================
// RESOLVED MEANS RESOLVED — one pain, two records.
//
// The same complaint routinely lands twice: the session note becomes a training
// symptom (the lifecycle the athlete closes with "Resolved"), and the chat turn that
// heard it files an `injury` context event for the timeline. The athlete then closes
// the one they can see — the symptom — and the injury event, which nothing ties to it,
// kept producing a protective hard constraint every morning: a flank note resolved on
// Monday was still excluding lifts and reading the day as "working around" it on
// Tuesday.
//
// This is the tie, and it is READ-SIDE on purpose. Nothing is stamped or deleted: an
// open injury event whose twin symptom the athlete resolved simply reads as resolved,
// and the day that symptom comes back (recurTrainingSymptom reopens the row) the event
// reads as open again with it. No data moves, so no migration is needed for rows that
// already exist.
//
// The link is deliberately narrow — a false tie would silently drop a real injury:
//   • the event is an `injury`, and the symptom an AREA symptom (a systemic "everything
//     feels off" names no place, so it can never stand for one),
//   • the SAME EPISODE: the symptom's onset sits within EPISODE_WINDOW_DAYS of the
//     event's start, and it was resolved on/after that start (a resolution that
//     predates the event cannot speak for it — that is a NEW episode),
//   • the SAME PLACE: no side conflict (left vs right), and either the same area
//     vocabulary label or a shared place word once the narration is stripped.
// ============================================================================

const EPISODE_WINDOW_DAYS = 3;

// Narration and severity words that say nothing about WHERE.
const NON_PLACE_WORDS = new Set([
  "a",
  "an",
  "and",
  "the",
  "my",
  "of",
  "in",
  "on",
  "at",
  "or",
  "to",
  "with",
  "after",
  "below",
  "above",
  "under",
  "over",
  "near",
  "around",
  "behind",
  "inside",
  "outside",
  "upper",
  "lower",
  "left",
  "right",
  "both",
  "side",
  "area",
  "region",
  "pain",
  "painful",
  "discomfort",
  "ache",
  "aching",
  "achy",
  "sore",
  "soreness",
  "tight",
  "tightness",
  "strain",
  "strained",
  "tweak",
  "tweaked",
  "niggle",
  "injury",
  "mild",
  "slight",
  "minor",
  "feeling",
  "unpleasant",
  "sharp",
  "dull",
]);

function sideOf(text: string): "left" | "right" | null {
  const left = /\bleft\b/.test(text);
  const right = /\bright\b/.test(text);
  if (left === right) return null; // neither, or both — no side claim to conflict with
  return left ? "left" : "right";
}

function placeWords(text: string): Set<string> {
  return new Set(
    text
      .split(/[^a-z]+/)
      .filter((word) => word.length >= 3 && !NON_PLACE_WORDS.has(word))
      .map((word) => word.replace(/s$/, ""))
  );
}

/** Whether an injury event's place text and a symptom's area label name the same place. */
export function samePlace(injuryPlace: string, symptomArea: string): boolean {
  const a = String(injuryPlace ?? "").toLowerCase();
  const b = String(symptomArea ?? "").toLowerCase();
  if (!a.trim() || !b.trim()) return false;
  const sideA = sideOf(a);
  const sideB = sideOf(b);
  if (sideA && sideB && sideA !== sideB) return false;
  const labelA = symptomAreaVocabularyLabel(a);
  const labelB = symptomAreaVocabularyLabel(b);
  // Two recognized places are compared by their labels alone: "upper back" and "lower
  // back" share a word and are still two places.
  if (labelA && labelB) {
    const bare = (label: string) => label.replace(/^(?:left|right|both|bilateral) /, "");
    return bare(labelA) === bare(labelB);
  }
  const wordsB = placeWords(b);
  for (const word of placeWords(a)) if (wordsB.has(word)) return true;
  return false;
}

function injuryPlaceText(ev: any): string {
  let meta: any = ev?.meta;
  if (meta == null && ev?.meta_json) {
    try {
      meta = JSON.parse(ev.meta_json);
    } catch {
      meta = null;
    }
  }
  const area = meta && typeof meta === "object" && meta.area ? String(meta.area) : "";
  // The title and the structured area — never the detail, which is narration ("dead
  // hang felt okay") and would tie the event to whatever else the sentence mentions.
  return `${ev?.title ?? ""} ${area}`;
}

function eventStart(ev: any): string | null {
  const start = String(ev?.start_date ?? "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(start)) return start;
  const created = String(ev?.created_at ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(created) ? created : null;
}

export interface SymptomResolution {
  symptom_id: number;
  resolved_on: string;
}

/**
 * For each OPEN injury event in `events`, the resolved training symptom (if any) that
 * closes it as of `on`. Events that are not open injuries are never in the map. One
 * query for the whole batch.
 */
export function injuriesResolvedBySymptoms(events: any[], on: string): Map<number, SymptomResolution> {
  const out = new Map<number, SymptomResolution>();
  const open = events.filter(
    (ev) =>
      ev?.kind === "injury" &&
      Number.isFinite(Number(ev?.id)) &&
      !(ev?.resolved_at && String(ev.resolved_at).slice(0, 10) <= on)
  );
  if (!open.length || !/^\d{4}-\d{2}-\d{2}$/.test(on)) return out;
  let symptoms: any[];
  let lineage: any[];
  try {
    symptoms = db
      .prepare(
        `SELECT id, area_text, onset_on, resolved_on FROM training_symptom_events
         WHERE status = 'resolved' AND resolved_on IS NOT NULL AND resolved_on <= ?
           AND scope = 'area' AND legacy_unconfirmed = 0
         ORDER BY resolved_on DESC, id DESC`
      )
      .all(on) as any[];
    // A resolved episode that came BACK is reopened as a new row carrying
    // `recurrence:<parent id>`. While any descendant is open on `on`, the original
    // resolution no longer speaks for the place, and the injury reads open with it.
    lineage = db
      .prepare(
        `SELECT id, source_kind, onset_on, resolved_on FROM training_symptom_events
         WHERE source_kind LIKE 'recurrence:%'`
      )
      .all() as any[];
  } catch {
    return out; // a fresh DB mid-boot: no link is the honest answer
  }
  if (!symptoms.length) return out;
  const parentOf = new Map<number, number>();
  for (const row of lineage) {
    const parent = Number(String(row.source_kind).slice("recurrence:".length));
    if (Number.isFinite(parent)) parentOf.set(Number(row.id), parent);
  }
  const reopened = new Set<number>();
  for (const row of lineage) {
    const open = String(row.onset_on) <= on && (row.resolved_on == null || String(row.resolved_on) > on);
    if (!open) continue;
    let cursor = parentOf.get(Number(row.id));
    for (let hops = 0; cursor != null && hops < 32 && !reopened.has(cursor); hops++) {
      reopened.add(cursor);
      cursor = parentOf.get(cursor);
    }
  }
  symptoms = symptoms.filter((symptom) => !reopened.has(Number(symptom.id)));
  if (!symptoms.length) return out;
  for (const ev of open) {
    const start = eventStart(ev);
    if (!start) continue;
    const from = addDaysISO(start, -EPISODE_WINDOW_DAYS);
    const to = addDaysISO(start, EPISODE_WINDOW_DAYS);
    if (!from || !to) continue;
    const place = injuryPlaceText(ev);
    const match = symptoms.find(
      (symptom) =>
        String(symptom.onset_on) >= from &&
        String(symptom.onset_on) <= to &&
        String(symptom.resolved_on) >= start &&
        samePlace(place, String(symptom.area_text ?? ""))
    );
    if (match) out.set(Number(ev.id), { symptom_id: Number(match.id), resolved_on: String(match.resolved_on) });
  }
  return out;
}
