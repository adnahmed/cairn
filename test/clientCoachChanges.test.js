import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "src/client/coach-meals-screen.ts"), "utf8");

test("Plan Changes is history-first and keeps manual reviews secondary", () => {
  assert.match(source, /headerTitle\.textContent = "Changes"/);
  assert.match(source, /Program change history/);
  assert.match(source, /Meal-plan change history/);
  assert.match(source, /<details class="changes-manual"/);
  assert.match(source, /<summary class="lbl">Manual review<\/summary>/);
  assert.ok(source.indexOf("Program change history") < source.indexOf("Manual review"));
  assert.match(source, /state\.planSeg = "coach"/, "the internal review route remains stable");
  assert.match(source, /id="runbtn" class="pillbtn pill-accent"/);
  assert.match(source, /Ask team to review program/);
  assert.match(source, /id="mealbtn" class="pillbtn pill-accent"/);
  assert.match(source, /Ask team to refresh meals/);
  assert.doesNotMatch(source, /ASK TEAM TO REVIEW PROGRAM|ASK TEAM TO REFRESH MEALS|class="logbtn"/);
});

test("Changes lives under Ask: no Plan seg bar, one quiet way back to Ask", () => {
  const coach = source.slice(source.indexOf("async function renderCoach"), source.indexOf("wireHomeBack(view);\n  mountCoachChanges();"));
  assert.match(coach, /homeBackHtml\("ask", "Ask"\)/);
  assert.doesNotMatch(coach, /segBar\(|planSeg\(\)/);
  assert.match(source, /wireHomeBack\(view\)/);
  // The shared helper lives in the shell and opens the named home's landing view.
  const shell = readFileSync(join(root, "src/client/ui-shell.ts"), "utf8");
  assert.match(shell, /function homeBackHtml\(home: ClientHomeName, label: string\): string/);
  assert.match(shell, /activateTab\(\(e\.currentTarget as HTMLElement \| null\)\?\.dataset\.homeBack \|\| "today"\)/);
  assert.doesNotMatch(source, /wireSeg\(PLAN_HANDLERS\)/, "neither Fuel nor Changes wears the Plan bar");
});

test("meal-plan Hold and Undo use the durable decision rollback path", () => {
  // The revert POST itself is the shared decision-undo component's
  // (test/decisionUndo.test.js drives it); the meal-plan journal (the lazy meals
  // bundle's meal-journal-client.ts) mounts it for both actions.
  const journal = readFileSync(join(root, "src/client/meal-journal-client.ts"), "utf8");
  assert.match(journal, /CairnDecisionUndoController\.mount\(\s*host,/);
  assert.match(journal, /"meal-decision-hold": \{/);
  assert.match(journal, /"meal-decision-undo": \{/);
  assert.match(journal, /swrInvalidate\(MEALS_KEY\)/);
  assert.match(journal, /await repaintMealHistory\(\)/);
  assert.match(journal, /Undo recorded — showing your current meals/);
  assert.doesNotMatch(journal + source, /Put back the previous meal plan/);
  // Fuel reaches the journal only once its fold asks for it.
  assert.match(source, /withBundle\("meals", \(\) => CairnMealJournal\.paint\(token, slot, peek\)\)/);
});
