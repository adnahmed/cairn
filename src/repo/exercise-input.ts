// What a movement's log row asks for — the ONE answer to "which fields does this
// exercise take?", shared by the session card, the set-log boundary, the prompts and
// composition.
//
// Two axes already existed: `exercises.mode` (reps | timed) and the weight encoding
// (negative = assisted, null = bodyweight). What the model could not say was that a
// stretch has no load and no reps-in-reserve, or that a drill is done one side at a
// time. This module adds exactly that, as a DERIVED read with an optional stated
// override per exercise:
//
//   profile  loaded      weight · reps · RIR   (timed: optional weight · time)
//            bodyweight  reps · RIR            (timed: time) — load on request
//            mobility    reps                  (timed: time) — load on request, never RIR
//   per_side the dose is each side's ("2 × 6 / side")
//
// Derived, in order: a stated `exercises.input_profile` wins; then mobility (a
// mobility group, a prep/stretch name, or a linked guide filed under "stretching");
// then bodyweight (a known unloaded movement that has never been logged with a load —
// a calf raise filed "bodyweight" but always done holding dumbbells stays loaded);
// else loaded. `per_side` is the stated column, else a conservative name read.
//
// Nothing here changes a logged number. A weight typed on a mobility drill (through
// the card's "+ Load") is stored exactly as before; the profile only decides what the
// DEFAULT row asks for, and that a mobility prescription never carries a load target.

import { db } from "../db.js";
import {
  canonicalGroup,
  classifyMuscleGroup,
  detectExerciseMode,
  isKnownBodyweightMovement,
  isMobility,
  isPrepMovement,
  normalizeExerciseName,
  resolveExerciseName,
} from "./exercise-canon.js";

export const EXERCISE_INPUT_PROFILES = ["loaded", "bodyweight", "mobility"] as const;
export type ExerciseInputProfile = (typeof EXERCISE_INPUT_PROFILES)[number];

export interface ExerciseInput {
  profile: ExerciseInputProfile;
  mode: "reps" | "timed";
  per_side: boolean;
  // "stated" when the exercise row carries an explicit input_profile; otherwise derived.
  source: "stated" | "derived";
}

export interface ExerciseInputFacts {
  name: string;
  muscle_group?: string | null;
  mode?: string | null;
  equipment?: string | null;
  guide_category?: string | null;
  input_profile?: string | null;
  per_side?: number | boolean | null;
  // Any logged set on this exercise carried a non-zero weight (assisted counts).
  loaded_history?: boolean;
}

export function validInputProfile(value: unknown): ExerciseInputProfile | null {
  const text = String(value ?? "")
    .trim()
    .toLowerCase();
  return (EXERCISE_INPUT_PROFILES as readonly string[]).includes(text) ? (text as ExerciseInputProfile) : null;
}

// One-side-at-a-time movements. Matched on the normalized name ("world s greatest
// stretch", "90 90 hip switch"). Deliberately conservative: a bilateral breathing
// drill ("90/90 Breathing") or an alternating walking pattern is not listed, and a
// stated `per_side` always wins over this read.
const PER_SIDE_RE = new RegExp(
  [
    String.raw`\b(?:single|one)\s(?:arm|leg|side)\b`,
    String.raw`\bunilateral\b`,
    String.raw`\b(?:each|per)\sside\b`,
    String.raw`\bside\splank`,
    String.raw`\bsuitcase\b`,
    String.raw`\bcossack\b`,
    String.raw`\bworld\ss\sgreatest\b`,
    String.raw`\b90\s90\s(?:hip|switch|stretch|rotation|transition|hold)`,
    String.raw`\bcouch\sstretch\b`,
    String.raw`\bpigeon\b`,
    String.raw`\bankle\srockers?\b`,
    String.raw`\bbulgarian\b`,
    String.raw`\bsplit\ssquat\b`,
    String.raw`\bcopenhagen\b`,
    String.raw`\bhalf\skneeling\b`,
    String.raw`\bhip\sflexor\sstretch\b`,
    String.raw`\bopen\sbooks?\b`,
    String.raw`\bthread\sthe\sneedle\b`,
    String.raw`\bsleeper\sstretch\b`,
    String.raw`\bcross\sbody\b`,
    String.raw`\bleg\sswings?\b`,
    String.raw`\bclamshells?\b`,
    String.raw`\bside\slying\b`,
  ].join("|")
);

export function namePerSide(name: string): boolean {
  const norm = normalizeExerciseName(name);
  return !!norm && PER_SIDE_RE.test(norm);
}

function statedPerSide(value: unknown): boolean | null {
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  return null;
}

// PURE: facts → the input profile. No database.
export function deriveExerciseInput(facts: ExerciseInputFacts): ExerciseInput {
  const name = String(facts.name ?? "").trim();
  const mode: "reps" | "timed" =
    facts.mode === "timed" ? "timed" : facts.mode === "reps" ? "reps" : detectExerciseMode(name);
  const stated = validInputProfile(facts.input_profile);
  const perSide = statedPerSide(facts.per_side) ?? namePerSide(name);
  if (stated) return { profile: stated, mode, per_side: perSide, source: "stated" };
  const group = canonicalGroup(facts.muscle_group ?? null) ?? classifyMuscleGroup(name);
  const guideStretch =
    String(facts.guide_category ?? "")
      .trim()
      .toLowerCase() === "stretching";
  // A logged load outranks the name: "Goblet Squat Stretch" at 35 lb is loaded work,
  // and a mobility read would strip its target weight, its top set and its RIR. Only
  // a STATED profile (above) can call a loaded history mobility.
  if (!facts.loaded_history && (isMobility(group) || isPrepMovement(name) || guideStretch)) {
    return { profile: "mobility", mode, per_side: perSide, source: "derived" };
  }
  if (!facts.loaded_history && isKnownBodyweightMovement(name, facts.equipment ?? null)) {
    return { profile: "bodyweight", mode, per_side: perSide, source: "derived" };
  }
  return { profile: "loaded", mode, per_side: perSide, source: "derived" };
}

function loadedExerciseIds(): Set<number> {
  try {
    return new Set(
      (
        db
          .prepare(`SELECT DISTINCT exercise_id AS id FROM logged_sets WHERE weight IS NOT NULL AND weight <> 0`)
          .all() as Array<{ id: number }>
      ).map((row) => Number(row.id))
    );
  } catch {
    return new Set();
  }
}

function guideCategoryByExerciseId(): Map<number, string> {
  try {
    return new Map(
      (
        db
          .prepare(`SELECT exercise_id AS id, category FROM exercise_guides WHERE exercise_id IS NOT NULL`)
          .all() as Array<{ id: number; category: string | null }>
      ).map((row) => [Number(row.id), String(row.category ?? "")])
    );
  } catch {
    return new Map();
  }
}

// Batch read for a list of exercise rows (two queries total, never one per row).
export function withExerciseInputs<T extends Record<string, any>>(rows: T[]): Array<T & { input: ExerciseInput }> {
  if (!rows.length) return [];
  const loaded = loadedExerciseIds();
  const guides = guideCategoryByExerciseId();
  return rows.map((row) => ({
    ...row,
    input: deriveExerciseInput({
      name: String(row.name ?? ""),
      muscle_group: row.muscle_group ?? null,
      mode: row.mode ?? null,
      equipment: row.equipment ?? null,
      guide_category: guides.get(Number(row.id)) ?? null,
      input_profile: row.input_profile ?? null,
      per_side: row.per_side ?? null,
      loaded_history: loaded.has(Number(row.id)),
    }),
  }));
}

// Through the one resolver ladder (exact → alias → key), never a raw name compare.
function storedRowFor(name: string): any {
  try {
    const resolved = resolveExerciseName(name);
    if (resolved.exercise_id == null) return null;
    return db.prepare(`SELECT * FROM exercises WHERE id = ?`).get(resolved.exercise_id) ?? null;
  } catch {
    return null;
  }
}

// One exercise by NAME. A name with no stored row (an agent-minted drill that has
// never been logged) is still read from its name alone, so a brand-new "Couch
// Stretch" is mobility on its very first card.
export function exerciseInputFor(name: string, modeHint?: string | null): ExerciseInput {
  const row = storedRowFor(String(name ?? "").trim());
  if (!row) return deriveExerciseInput({ name, mode: modeHint ?? null });
  let loadedHistory = false;
  let guideCategory: string | null = null;
  try {
    loadedHistory = !!db
      .prepare(`SELECT 1 FROM logged_sets WHERE exercise_id = ? AND weight IS NOT NULL AND weight <> 0 LIMIT 1`)
      .get(row.id);
    guideCategory =
      (db.prepare(`SELECT category FROM exercise_guides WHERE exercise_id = ? LIMIT 1`).get(row.id) as any)?.category ??
      null;
  } catch {
    /* absence-tolerant: derive from the row alone */
  }
  return deriveExerciseInput({
    name: String(row.name ?? name),
    muscle_group: row.muscle_group ?? null,
    mode: row.mode ?? modeHint ?? null,
    equipment: row.equipment ?? null,
    guide_category: guideCategory,
    input_profile: row.input_profile ?? null,
    per_side: row.per_side ?? null,
    loaded_history: loadedHistory,
  });
}
