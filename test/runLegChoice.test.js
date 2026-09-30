import assert from "node:assert/strict";
import test from "node:test";
import { buildRunLegChoice, isLegPlanDay, runLegChoiceGrammarPool } from "../dist/repo/run-leg-choice.js";
import { violatesReadingGrammar } from "../dist/repo/day-read.js";
import { localDaysAgo, savePlanDaySettled } from "./_seed.js";

const TODAY = localDaysAgo(0);
const line = (over = {}) => ({
  date: TODAY,
  day_number: 1,
  title: "Lower A",
  focus: "Squat & quads",
  role: null,
  state: "not_started",
  suggestion: null,
  suggestion_label: null,
  caveat: null,
  run_in: { km: 6.6 },
  reshaped: false,
  original: [],
  text: "Run in · Lower A still open",
  ...over,
});

function seedLegDay() {
  savePlanDaySettled(1, "Lower A", "Squat & quads", [
    { exercise: "Back Squat", sets: 3, rep_low: 5, rep_high: 7 },
    { exercise: "Romanian Deadlift", sets: 2, rep_low: 8, rep_high: 10 },
    { exercise: "Standing Calf Raise", sets: 2, rep_low: 12, rep_high: 15 },
  ]);
}

test("isLegPlanDay: mostly lower body with a main lower group", () => {
  assert.equal(isLegPlanDay(["quads", "hamstrings", "calves"]), true);
  assert.equal(isLegPlanDay(["quads", "chest"]), true);
  assert.equal(isLegPlanDay(["quads", "chest", "back"]), false);
  assert.equal(isLegPlanDay(["calves", "core"]), false);
  assert.equal(isLegPlanDay([]), false);
});

test("a run in and a leg day not started offers upper / lighter / rest", () => {
  seedLegDay();
  const choice = buildRunLegChoice(TODAY, line());
  assert.ok(choice);
  assert.match(choice.line, /Lower A/);
  assert.deepEqual(choice.options.map((o) => o.key), ["upper", "lighter", "rest"]);
  assert.equal(choice.options[0].focus, "upper body");
  assert.equal(choice.options[1].focus, "Squat & quads");
  assert.equal(choice.options[2].focus, null);
});

test("no offer without a run, once lifting started, on an upper day, or after a steer", () => {
  seedLegDay();
  assert.equal(buildRunLegChoice(TODAY, line({ run_in: null })), null);
  assert.equal(buildRunLegChoice(TODAY, line({ state: "in_progress" })), null);
  assert.equal(buildRunLegChoice(TODAY, line({ day_number: null })), null);
  assert.equal(buildRunLegChoice(TODAY, line(), { override: "rough night" }), null);
  savePlanDaySettled(2, "Push", "Chest and shoulders", [
    { exercise: "Bench Press", sets: 3, rep_low: 5, rep_high: 8 },
    { exercise: "Overhead Press", sets: 3, rep_low: 6, rep_high: 10 },
  ]);
  assert.equal(buildRunLegChoice(TODAY, line({ day_number: 2, title: "Push" })), null);
});

test("every string the offer can say passes the reading grammar", () => {
  for (const text of runLegChoiceGrammarPool()) {
    assert.equal(violatesReadingGrammar(text), null, `violated grammar: ${JSON.stringify(text)}`);
  }
});
