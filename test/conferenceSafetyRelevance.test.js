import { test } from "node:test";
import assert from "node:assert/strict";
import {
  conferenceConflictInputs,
  deterministicConferenceConflicts,
  runCaseConference,
} from "../dist/domain/brain/case-conference.js";
import {
  revisionHoldsClinicalFloor,
  safetyConflictGovernsRevision,
} from "../dist/domain/brain/conference-conflicts.js";
import { getBrainDecision } from "../dist/repo/brain-decisions.js";
import { db, localDaysAgo, repo } from "./_seed.js";

// Ordinary training tweaks stop asking (athlete decision, 2026-10-02). Live, the monthly
// conference's Pallof-press cap was held at `ask` with review_reason_code "safety_floor"
// because the profile's own "No known active allergies" read as an allergy, and an
// allergy beside a meal plan is a safety conflict — which then held a TRAINING change.

const opinion = (domain, overrides = {}) => ({
  domain,
  recommendation: "Keep the change bounded.",
  rationale: "The shared snapshot supports a cautious next step.",
  evidence_keys: [`${domain}:evidence`],
  risks: [],
  contraindications: [],
  uncertainties: [],
  expected_outcomes: [],
  autonomy_ceiling: "ask",
  ...overrides,
});

const context = (overrides = {}) => ({
  goal_mode: "gain",
  goal: { ok: true, goal_mode: "gain", tdee: 2_800, effective_target: { target_kcal: 3_050 } },
  cut_quality: { active: false },
  signal_state: {
    dimensions: { recovery_capacity: { status: "supportive", reason: "Sleep and HRV both read normal." } },
    action: { readiness: "ready", directives: { training: "proceed", fueling: "normal", schedule: "normal" } },
  },
  context_events: [],
  training_signals: { progression: [{ exercise: "Pallof Press", progress_ready: true }], autoregulation: null },
  progression: [{ exercise: "Pallof Press", action: "overload" }],
  health: [],
  supplements: [],
  directives: [],
  health_focus: { priorities: [], surfaced: [], lead: null, act_now: 0, track: 0 },
  profile: { allergies: null },
  family: [],
  meal_plan: null,
  day_intake: { count: 0 },
  endurance_goal: null,
  training_intent: { priorities: ["muscle", "strength"], endurance_role: "none" },
  discipline: { primary: "strength", endurance_sport: null },
  ...overrides,
});

const conductor = (revision, overrides = {}) => ({
  kind: "case_conference",
  domain: "training",
  summary: "Keep the next change bounded.",
  rationale: "The shared snapshot supports one reversible step.",
  risk_class: "low",
  reversible: true,
  autonomy_tier: "ask",
  parallel_actions: [],
  resolved_conflicts: [],
  deferred: [],
  expectations: [],
  review_window: "Review in two weeks.",
  user_explanation: "The Pallof press holds at 42.5 lb this week.",
  revision,
  ...overrides,
});

const pallofCap = {
  type: "plan_update",
  summary: "Cap the Pallof press",
  changes: [{ day_number: 5, exercise: "Pallof Press", target_weight: 42.5, sets: 2, reason: "A bounded hold." }],
};

function seedPallofDay() {
  repo.savePlanDay(5, "Lower B", "Legs", [
    { exercise: "Pallof Press", sets: 2, rep_low: 12, rep_high: 12, target_weight: 50 },
  ]);
}

test('"No known active allergies" and its cousins name no allergy and no medication', () => {
  for (const said of ["No known active allergies", "None", "NKDA", "no known drug allergies.", "N/A"]) {
    const inputs = conferenceConflictInputs(context({ profile: { allergies: said }, meal_plan: { id: 1 } }));
    assert.deepEqual(inputs.knownAllergies, [], said);
  }
  const meds = conferenceConflictInputs(
    context({
      supplements: [{ name: "Creatine" }],
      health: [{ clinical_facts: [{ kind: "medication", name: "No current medications", status: "active" }] }],
    })
  );
  assert.deepEqual(meds.activeMedications, []);
  assert.ok(
    !deterministicConferenceConflicts(
      context({ profile: { allergies: "No known active allergies" }, meal_plan: { id: 1 } })
    ).includes("allergy_meal")
  );
  // A real allergy still reads.
  assert.deepEqual(
    conferenceConflictInputs(context({ profile: { allergies: "peanuts" }, meal_plan: { id: 1 } })).knownAllergies,
    ["peanuts"]
  );
});

test("a safety conflict holds only the change it governs", () => {
  const nutrition = { type: "nutrition_target", summary: "Hold", nutrition: { target_kcal: 2000, protein_g: 175 } };
  assert.equal(safetyConflictGovernsRevision("allergy_meal", pallofCap), false);
  assert.equal(safetyConflictGovernsRevision("medication_supplement", pallofCap), false);
  assert.equal(safetyConflictGovernsRevision("allergy_meal", nutrition), true);
  assert.equal(safetyConflictGovernsRevision("medication_supplement", nutrition), true);
  assert.equal(safetyConflictGovernsRevision("injury_load", pallofCap), true, "a training change loads by default");
  assert.equal(safetyConflictGovernsRevision("injury_load", pallofCap, { easesLoad: true }), false);
  assert.equal(safetyConflictGovernsRevision("injury_load", nutrition), false);
  assert.equal(safetyConflictGovernsRevision("race_strength", pallofCap), false, "not a safety conflict at all");
});

test("an allergy beside a meal plan no longer holds a training load cap: it lands under lead", async () => {
  repo.setSettings({ lead_mode: "lead" });
  seedPallofDay();
  const result = await runCaseConference(
    "stub",
    { question: "Standing monthly whole-person review.", domains: ["training", "nutrition"] },
    {
      context: () => context({ profile: { allergies: "peanuts" }, meal_plan: { id: 7 } }),
      specialistRun: async (_agent, _prompt, domain) => opinion(domain),
      conductorRun: async () => conductor(pallofCap),
    }
  );
  assert.deepEqual(result.unresolved_conflicts, ["allergy_meal"], "still recorded as what the layer saw");
  const recorded = getBrainDecision(result.recorded_decision_id);
  assert.notEqual(recorded.status, "review", "a food question never parks a training change");
  assert.notEqual(recorded.context.review_reason_code, "safety_floor");
  assert.equal(repo.awaitingBrainDecisions().length, 0);
});

test("a PROTECTIVE reduction on a hurt part lands under lead; a load step on it still asks", async () => {
  repo.setSettings({ lead_mode: "lead" });
  seedPallofDay();
  const hurt = () => context({ context_events: [{ kind: "injury", title: "Right flank" }] });
  const eased = await runCaseConference(
    "stub",
    { question: "Protect the flank?", domains: ["training", "recovery"] },
    {
      context: hurt,
      specialistRun: async (_agent, _prompt, domain) => opinion(domain),
      conductorRun: async () => conductor(pallofCap),
    }
  );
  assert.deepEqual(eased.unresolved_conflicts, ["injury_load"]);
  assert.notEqual(getBrainDecision(eased.recorded_decision_id).status, "review");

  seedPallofDay();
  const loaded = await runCaseConference(
    "stub",
    { question: "Step the Pallof press?", domains: ["training", "recovery"] },
    {
      context: hurt,
      specialistRun: async (_agent, _prompt, domain) => opinion(domain),
      conductorRun: async () =>
        conductor({
          type: "plan_update",
          summary: "Step the Pallof press",
          changes: [{ day_number: 5, exercise: "Pallof Press", target_weight: 55, reason: "Earned." }],
        }),
    }
  );
  const held = getBrainDecision(loaded.recorded_decision_id);
  assert.equal(held.status, "review", "loading a hurt part still waits on the athlete");
  assert.equal(held.context.review_reason_code, "safety_floor");
});

test("review_everything still asks about an ordinary training tweak", async () => {
  repo.setSettings({ lead_mode: "review_everything" });
  seedPallofDay();
  const result = await runCaseConference(
    "stub",
    { question: "Standing monthly whole-person review.", domains: ["training"] },
    {
      context: () => context(),
      specialistRun: async (_agent, _prompt, domain) => opinion(domain),
      conductorRun: async () => conductor(pallofCap),
    }
  );
  assert.equal(getBrainDecision(result.recorded_decision_id).status, "review");
});

test("a 'take it to your doctor if it worsens' contingency in a training change is not the clinical floor", () => {
  const inputs = conferenceConflictInputs(context());
  const withContingency = {
    ...pallofCap,
    changes: [
      {
        ...pallofCap.changes[0],
        note: "If the right flank hurts with breathing at rest or is worsening, take it to your doctor for a rib or oblique assessment.",
      },
    ],
  };
  assert.equal(revisionHoldsClinicalFloor(inputs, withContingency), false);
});

test("every seat hears the pain state: open now, and what settled as history", async () => {
  const onset = localDaysAgo(7);
  const resolved = localDaysAgo(4);
  db.prepare(
    `INSERT INTO training_symptom_events
       (source_kind, area_text, status, scope, onset_on, last_reported_on, resolved_on, legacy_unconfirmed)
     VALUES ('chat', 'right flank', 'resolved', 'area', ?, ?, ?, 0)`
  ).run(onset, onset, resolved);
  repo.reportTrainingSymptom({ area_text: "left knee", onset_on: localDaysAgo(1) });
  const prompts = [];
  await runCaseConference(
    "stub",
    { question: "Standing monthly whole-person review.", domains: ["training"] },
    {
      context: () => context(),
      specialistRun: async (_agent, prompt, domain) => {
        prompts.push(prompt);
        return opinion(domain);
      },
      conductorRun: async (_agent, prompt) => {
        prompts.push(prompt);
        return conductor(null);
      },
    }
  );
  assert.equal(prompts.length, 2);
  for (const prompt of prompts) {
    assert.match(prompt, /open now: left knee\./);
    assert.match(prompt, new RegExp(`Resolved — history, not current: right flank \\(settled ${resolved}\\)`));
    assert.match(prompt, /A resolved pain never caps, holds or excludes a load/);
  }
});

// ---- the doctor list holds health ---------------------------------------------------

function clinicianHold(kind, domain, text) {
  return repo.recordDecision({
    effective_date: localDaysAgo(1),
    kind,
    domain,
    summary: text,
    rationale: "Synthetic rationale.",
    source: "case_conference",
    source_ref_type: null,
    source_ref_key: null,
    status: "review",
    autonomy_tier: "clinician",
    risk_class: "clinical",
    reversible: true,
    context: { clinical: true },
    action: { user_explanation: text },
    specialist: null,
    applied_at: null,
    reverted_at: null,
    superseded_by: null,
    evaluator_version: null,
  }).decision;
}

test("a training draft never lands under 'For you and your doctor'; a health finding does", () => {
  const squat = clinicianHold(
    "training_structure",
    "training",
    "Wednesday's Lower A brings the squat back at 185 for 3 sets of 5-7 behind a brace check."
  );
  const lab = clinicianHold("lifestyle_adjustment", "health", "Repeat the lipid panel and talk about a statin.");
  const waiting = repo.awaitingBrainDecisions();
  const squatRow = waiting.find((row) => row.id === squat.id);
  const labRow = waiting.find((row) => row.id === lab.id);
  assert.ok(squatRow, "the held training change still waits — the floor is untouched");
  assert.equal(squatRow.for_clinician, false);
  assert.equal(labRow.for_clinician, true);
});
