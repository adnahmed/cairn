// What a movement's log row asks for (src/repo/exercise-input.ts). Invariants:
//   - mobility (a mobility group, a prep/stretch name, a guide filed "stretching")
//     never asks for a load or an RIR, whatever its mode
//   - a known bodyweight movement is "bodyweight" only until a load is ever logged
//     on it (a calf raise filed "bodyweight" but done holding dumbbells is loaded;
//     an assisted pull-up's negative weight is a load too)
//   - per_side is the stated column, else a conservative name read
//   - a stated input_profile / per_side override wins and can be cleared again
//   - an agent's load target or top set on a mobility item is dropped; a
//     composition read carries `input` per strength item
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, repo, resetTables } from "./_seed.js";
import { deriveExerciseInput, exerciseInputFor, namePerSide } from "../dist/repo/exercise-input.js";
import { applyExerciseEnrichment } from "../dist/repo/exercises.js";
import { normalizeSessionSuggestionResult } from "../dist/agent-contracts.js";
import { MOVEMENT_NOTES_CONTRACT } from "../dist/prompt/shared.js";

const DATE = "2031-05-12";

beforeEach(() => {
  resetTables(
    "daily_session_compositions",
    "daily_session_decisions",
    "logged_sets",
    "session_skips",
    "sessions",
    "plan_items",
    "plan_days",
    "exercise_guides",
    "exercises"
  );
});

function logWeighted(name, weight, reps = 10) {
  const ex = repo.findOrCreateExercise(name);
  const sess = repo.getOrCreateSession(DATE, null);
  db.prepare(`INSERT INTO logged_sets (session_id, exercise_id, set_number, weight, reps) VALUES (?, ?, 1, ?, ?)`).run(
    sess.id,
    ex.id,
    weight,
    reps
  );
}

test("deriveExerciseInput: mobility drills and stretches never ask for a load", () => {
  const rocker = deriveExerciseInput({
    name: "Ankle Rocker",
    muscle_group: "mobility",
    mode: "reps",
    equipment: "bodyweight",
  });
  assert.deepEqual(rocker, { profile: "mobility", mode: "reps", per_side: true, source: "derived" });
  const wgs = deriveExerciseInput({ name: "World's Greatest Stretch", muscle_group: "mobility", mode: "reps" });
  assert.equal(wgs.profile, "mobility");
  assert.equal(wgs.per_side, true, "a lunge-and-rotate drill is dosed per side");
  // A stored non-mobility group does not hide a stretch name, and a new couch stretch
  // with no stored mode reads as a hold.
  const couch = deriveExerciseInput({ name: "Couch Stretch", muscle_group: "quads" });
  assert.deepEqual(couch, { profile: "mobility", mode: "timed", per_side: true, source: "derived" });
  // The linked guide's own category is evidence too.
  const guide = deriveExerciseInput({ name: "Seated Floor Reach", guide_category: "stretching" });
  assert.equal(guide.profile, "mobility");
  // A bilateral breathing drill is not per side.
  assert.equal(
    deriveExerciseInput({ name: "90/90 Breathing", muscle_group: "mobility", mode: "timed" }).per_side,
    false
  );
  assert.equal(namePerSide("90/90 Hip Switch"), true);
});

test("deriveExerciseInput: bodyweight until a load is ever logged; loaded stays loaded", () => {
  assert.equal(deriveExerciseInput({ name: "Chest Dips", equipment: "parallel bars" }).profile, "bodyweight");
  assert.equal(
    deriveExerciseInput({ name: "Dead Hang", equipment: "pull-up bar", mode: "timed" }).profile,
    "bodyweight"
  );
  assert.equal(
    deriveExerciseInput({ name: "Standing Calf Raise", equipment: "bodyweight", loaded_history: true }).profile,
    "loaded",
    "a 'bodyweight' calf raise done holding dumbbells keeps its weight well"
  );
  assert.equal(
    deriveExerciseInput({ name: "Assisted Pull-Up", equipment: "an assisted pull-up machine" }).profile,
    "loaded"
  );
  assert.equal(deriveExerciseInput({ name: "Barbell Bench Press", equipment: "a barbell" }).profile, "loaded");
  assert.equal(
    deriveExerciseInput({ name: "Farmer's Carry", equipment: "dumbbells", mode: "timed" }).profile,
    "loaded"
  );
  assert.equal(deriveExerciseInput({ name: "Barbell Bench Press" }).per_side, false);
  assert.equal(deriveExerciseInput({ name: "Single-Arm Dumbbell Row" }).per_side, true);
});

test("a logged load outranks a stretch/prep NAME or a mobility group; only a stated profile can say mobility", () => {
  // "Goblet Squat Stretch" at 35 lb is loaded work: a mobility read would strip its
  // target weight, its top set and its RIR.
  assert.equal(
    deriveExerciseInput({ name: "Goblet Squat Stretch", equipment: "a dumbbell", loaded_history: true }).profile,
    "loaded"
  );
  assert.equal(deriveExerciseInput({ name: "Goblet Squat Stretch" }).profile, "mobility", "unloaded, the name reads");
  for (const name of ["Weighted Ankle Rocker", "Hip Activation Drill", "Banded Warm-Up Row"]) {
    assert.equal(deriveExerciseInput({ name, loaded_history: true }).profile, "loaded", name);
  }
  assert.equal(
    deriveExerciseInput({ name: "Kettlebell Halo", muscle_group: "mobility", loaded_history: true }).profile,
    "loaded",
    "a mobility group with a logged load is loaded too"
  );
  assert.equal(
    deriveExerciseInput({ name: "Seated Floor Reach", guide_category: "stretching", loaded_history: true }).profile,
    "loaded"
  );
  // A stated profile still wins over the history.
  assert.equal(
    deriveExerciseInput({ name: "Goblet Squat Stretch", loaded_history: true, input_profile: "mobility" }).profile,
    "mobility"
  );
});

test("listExercises: a stretch-named movement with a logged load keeps its weight well", () => {
  repo.upsertExercise({ name: "Goblet Squat Stretch", muscle_group: "mobility", mode: "reps" });
  logWeighted("Goblet Squat Stretch", 35, 8);
  assert.equal(exerciseInputFor("Goblet Squat Stretch").profile, "loaded");
  const byName = Object.fromEntries(repo.listExercises().map((e) => [e.name, e.input]));
  assert.equal(byName["Goblet Squat Stretch"].profile, "loaded");
});

test("a stated override wins over the derived read", () => {
  const stated = deriveExerciseInput({
    name: "Ankle Rocker",
    muscle_group: "mobility",
    mode: "reps",
    input_profile: "loaded",
    per_side: 0,
  });
  assert.deepEqual(stated, { profile: "loaded", mode: "reps", per_side: false, source: "stated" });
  // An unknown stated value is ignored, never trusted.
  assert.equal(deriveExerciseInput({ name: "Ankle Rocker", input_profile: "yoga" }).source, "derived");
});

test("listExercises carries `input`, with a logged load flipping bodyweight to loaded (assist counts)", () => {
  repo.upsertExercise({ name: "Ankle Rocker", muscle_group: "mobility", mode: "reps" });
  repo.upsertExercise({ name: "Neutral-Grip Pull-Up", muscle_group: "back" });
  repo.upsertExercise({ name: "Chest Dips", muscle_group: "chest" });
  logWeighted("Neutral-Grip Pull-Up", -30, 8);
  const byName = Object.fromEntries(repo.listExercises().map((e) => [e.name, e.input]));
  assert.equal(byName["Ankle Rocker"].profile, "mobility");
  assert.equal(byName["Ankle Rocker"].per_side, true);
  assert.equal(byName["Neutral-Grip Pull-Up"].profile, "loaded", "an assisted history keeps the weight well");
  assert.equal(byName["Chest Dips"].profile, "bodyweight");
});

test("updateExercise states and clears input_profile / per_side; bad values are refused", () => {
  repo.upsertExercise({ name: "Ankle Rocker", muscle_group: "mobility", mode: "reps" });
  const row = repo.findExercise("Ankle Rocker");
  repo.updateExercise(row.id, { input_profile: "loaded", per_side: false });
  assert.deepEqual(exerciseInputFor("Ankle Rocker"), {
    profile: "loaded",
    mode: "reps",
    per_side: false,
    source: "stated",
  });
  repo.updateExercise(row.id, { input_profile: null, per_side: null });
  assert.deepEqual(exerciseInputFor("Ankle Rocker"), {
    profile: "mobility",
    mode: "reps",
    per_side: true,
    source: "derived",
  });
  assert.throws(() => repo.updateExercise(row.id, { input_profile: "yoga" }), /input_profile must be one of/);
});

test("an agent's per_side:false never persists over the name read; a yes fills an unstated column", () => {
  const wgs = repo.findOrCreateExercise("World's Greatest Stretch", "mobility");
  applyExerciseEnrichment(wgs.id, { per_side: false });
  assert.equal(db.prepare(`SELECT per_side FROM exercises WHERE id = ?`).get(wgs.id).per_side, null);
  assert.equal(exerciseInputFor("World's Greatest Stretch").per_side, true, "the name read still stands");

  const bridge = repo.findOrCreateExercise("Glute Bridge March", "glutes");
  assert.equal(exerciseInputFor("Glute Bridge March").per_side, false);
  applyExerciseEnrichment(bridge.id, { per_side: true });
  assert.equal(db.prepare(`SELECT per_side FROM exercises WHERE id = ?`).get(bridge.id).per_side, 1);
  assert.equal(exerciseInputFor("Glute Bridge March").per_side, true);
});

test("exerciseInputFor reads a never-stored drill from its name alone", () => {
  assert.deepEqual(exerciseInputFor("Pigeon Stretch"), {
    profile: "mobility",
    mode: "timed",
    per_side: true,
    source: "derived",
  });
  assert.equal(exerciseInputFor("Cossack Squat Drill").profile, "mobility");
});

test("the schema carries both override columns (two-step: create block + migration)", () => {
  const cols = db
    .prepare(`PRAGMA table_info(exercises)`)
    .all()
    .map((c) => c.name);
  assert.ok(cols.includes("input_profile"));
  assert.ok(cols.includes("per_side"));
});

test("an agent's load target and top set on a mobility item are dropped; a lift keeps its own", () => {
  const result = normalizeSessionSuggestionResult({
    name: "Mobility reset",
    why: "A gentle flow.",
    items: [
      {
        exercise: "World's Greatest Stretch",
        sets: 2,
        rep_low: 6,
        rep_high: 6,
        mode: "reps",
        target_weight: 20,
        top_set: { sets: 1, reps: 6, target_weight: 30 },
      },
      { exercise: "Couch Stretch", sets: 2, target_seconds: 45, mode: "timed", target_weight: 10 },
    ],
  });
  assert.ok(result, "the suggestion normalizes");
  const [wgs, couch] = result.items;
  assert.equal(wgs.target_weight, null, "no load target on a stretch");
  assert.equal(wgs.top_set, undefined, "no heavier top set on a stretch");
  assert.equal(couch.target_weight, null);
  assert.equal(couch.target_seconds, 45, "the hold keeps its seconds");
});

test("a composition read carries each strength item's `input`", () => {
  repo.upsertExercise({ name: "Barbell Bench Press", muscle_group: "chest" });
  repo.prepareDailySession({
    date: DATE,
    source: "athlete_override",
    session: {
      name: "Mixed",
      why: "Prep then press.",
      items: [
        { exercise: "World's Greatest Stretch", sets: 2, rep_low: 6, rep_high: 6 },
        { exercise: "Couch Stretch", sets: 2, target_seconds: 45, mode: "timed" },
        { exercise: "Barbell Bench Press", sets: 3, rep_low: 5, rep_high: 8, target_weight: 135 },
      ],
    },
  });
  const active = repo.getActiveDailySession(DATE);
  const byName = Object.fromEntries(active.items.map((item) => [item.exercise, item.input]));
  assert.deepEqual(byName["World's Greatest Stretch"], {
    profile: "mobility",
    mode: "reps",
    per_side: true,
    source: "derived",
  });
  assert.deepEqual(byName["Couch Stretch"], { profile: "mobility", mode: "timed", per_side: true, source: "derived" });
  assert.equal(byName["Barbell Bench Press"].profile, "loaded");
});

test("detectExerciseMode: a static stretch is a hold, a controlled-rep drill stays reps", () => {
  assert.equal(repo.detectExerciseMode("Couch Stretch"), "timed");
  assert.equal(repo.detectExerciseMode("Pigeon Pose"), "timed");
  assert.equal(repo.detectExerciseMode("Hip Flexor Stretch"), "timed");
  assert.equal(repo.detectExerciseMode("World's Greatest Stretch"), "reps");
  assert.equal(repo.detectExerciseMode("Ankle Rocker"), "reps");
});

test("the plan/session prompts teach mobility prescription: no load, no RIR, holds timed, per side", () => {
  assert.match(MOVEMENT_NOTES_CONTRACT, /target_weight null and no top_set/);
  assert.match(MOVEMENT_NOTES_CONTRACT, /HOLD[^.]*"timed" with target_seconds/);
  assert.match(MOVEMENT_NOTES_CONTRACT, /PER SIDE/);
  assert.match(MOVEMENT_NOTES_CONTRACT, /Never an RIR on mobility/);
});
