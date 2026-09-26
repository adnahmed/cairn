// v2 wave 1 — the Changes feed speaks the way the change went. A swap is titled as the
// swap; a hold as a hold, a new rep range as a reshape; a stored reason's absolute date
// is said relative to the row's day (in the projection only); a meal plan is not a
// change; a progression across several lifts with no written why gets a counted,
// rotating spoken one; and every why is a sentence or two, cut at a sentence.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDueAnnouncedDecisions, applyProposalWithAutonomy } from "../dist/domain/brain/autonomy-service.js";
import { brainChangesRead } from "../dist/domain/brain/changes-feed.js";
import * as repo from "../dist/repo.js";
import { localDateISO } from "../dist/repo/shared.js";

const PRESS = "ZVoice Press";
const ROW = "ZVoice Row";
const CURL = "ZVoice Curl";
const SEATED = "ZVoice Seated Calf Raise";
const STANDING = "ZVoice Standing Calf Raise";

const MONTH_DATE = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}\b/;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/;

function feedRows(read = brainChangesRead()) {
  return read.days.flatMap((day) => day.changes);
}

function humanDate(iso) {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${iso}T12:00:00Z`)
  );
}

function shiftDay(iso, days) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// A change the team made and that has landed, written straight to the ledger. Each gets
// its own action seed: the ledger folds two identical rows into one.
let seed = 0;
function landedDecision(fields) {
  const day = fields.effective_date ?? localDateISO();
  return repo.recordDecision({
    effective_date: day,
    kind: "training_target",
    domain: "training",
    summary: "A coaching change",
    rationale: null,
    source: "test",
    source_ref_type: null,
    source_ref_key: null,
    status: "applied",
    autonomy_tier: "quiet_apply",
    risk_class: "low",
    reversible: false,
    context: null,
    action: { seed: ++seed },
    specialist: null,
    applied_at: `${day}T09:00:00.000Z`,
    reverted_at: null,
    superseded_by: null,
    evaluator_version: null,
    ...fields,
  }).decision;
}

function seedDay(items) {
  repo.savePlanDay(1, "Mixed", "full", items);
}

function landDraft(draft) {
  const routed = applyProposalWithAutonomy(Number(draft.id), { requested_tier: "ask" });
  assert.equal(routed.decision.status, "announced", "under lead the change is decided and announced");
  return routed;
}

// ---------- 1. a swap is titled as the swap ----------

test("a swap reads as the swap before and after it lands, and a terse producer note is never its why", () => {
  repo.setSettings({ lead_mode: "lead" });
  seedDay([
    { exercise: PRESS, sets: 3, rep_low: 6, rep_high: 8, target_weight: 100 },
    { exercise: SEATED, sets: 3, rep_low: 10, rep_high: 15, target_weight: 90 },
  ]);
  const draft = repo.createProposal("stub", "swap calves", "", {
    summary: `Swap ${SEATED} → ${STANDING}`,
    changes: [
      {
        day_number: 1,
        swap: { from: SEATED, to: STANDING },
        target_weight: 90,
        reason: "Gym lacks seated calf machine; swap to standing calf raise matching working weight",
      },
    ],
  });
  const routed = landDraft(draft);

  let [row] = feedRows();
  assert.equal(row.title, `Swapped ${SEATED} for ${STANDING}`);
  assert.equal(row.why, null, "a note that never ends as a sentence is not spoken to the athlete");

  applyDueAnnouncedDecisions(routed.effective_date);
  [row] = feedRows(brainChangesRead({ asOf: routed.effective_date }));
  assert.equal(row.state, "applied");
  // The landed record also lists the swapped-in lift; it is the swap, not a second lift.
  assert.equal(row.title, `Swapped ${SEATED} for ${STANDING}`);
  assert.doesNotMatch(row.title, /targets on \d+ lifts/);
  assert.equal(row.why, null);
});

test("a swap whose reason is a sentence to the athlete keeps it as the why", () => {
  repo.setSettings({ lead_mode: "lead" });
  seedDay([{ exercise: SEATED, sets: 3, rep_low: 10, rep_high: 15, target_weight: 90 }]);
  const reason = "The gym doesn't have that machine, so the standing version takes its place at the same load.";
  landDraft(
    repo.createProposal("stub", "swap calves", "", {
      summary: `Swap ${SEATED} → ${STANDING}`,
      changes: [{ day_number: 1, swap: { from: SEATED, to: STANDING }, reason }],
    })
  );
  const [row] = feedRows();
  assert.equal(row.title, `Swapped ${SEATED} for ${STANDING}`);
  assert.equal(row.why, reason);
});

test("a landed swap names the lift the way the plan spells it and still reads as one swap", () => {
  const { id } = landedDecision({
    kind: "exercise_rotation",
    summary: "swap calves → standing",
    action: {
      changes: [
        {
          day_number: 1,
          exercise: STANDING,
          target_weight: 90,
          sets: 3,
          rep_low: 10,
          rep_high: 15,
          change: "updated",
          before: null,
        },
      ],
      swaps: [{ day_number: 1, from: SEATED, to: STANDING.toLowerCase() }],
    },
  });
  const row = feedRows().find((change) => change.id === id);
  assert.equal(row.title, `Swapped ${SEATED} for ${STANDING}`);
});

// ---------- 2. the title follows the direction the snapshot shows ----------

function progressionDraft(changes) {
  return repo.createProposal("auto-progression", "day 1 progression", "", {
    summary: `Auto-progression for day 1 — ${changes.length} lifts`,
    changes,
  });
}

test("a hold is titled as held, before and after it lands", () => {
  repo.setSettings({ lead_mode: "lead" });
  seedDay([{ exercise: PRESS, sets: 3, rep_low: 6, rep_high: 8, target_weight: 100 }]);
  const routed = landDraft(
    progressionDraft([
      {
        day_number: 1,
        exercise: PRESS,
        target_weight: 100,
        reason: "Keeping the load where it is. This muscle got a heavy dose recently, so hold steady.",
      },
    ])
  );
  let [row] = feedRows();
  assert.equal(row.title, `Held your ${PRESS} target`);
  assert.doesNotMatch(row.title, /^Moved/);

  applyDueAnnouncedDecisions(routed.effective_date);
  [row] = feedRows(brainChangesRead({ asOf: routed.effective_date }));
  assert.equal(row.state, "applied");
  assert.equal(row.title, `Held your ${PRESS} target`);
  assert.match(row.why, /^Keeping the load where it is\./);
});

test("raised, lowered, and a rep-range reshape each read as what they did", () => {
  const cases = [
    [{ target_weight: 110 }, { target_weight: 100, rep_low: 6, rep_high: 8, sets: 3 }, `Raised your ${PRESS} target`],
    [{ target_weight: 90 }, { target_weight: 100, rep_low: 6, rep_high: 8, sets: 3 }, `Lowered your ${PRESS} target`],
    // Less assist is a raise: the sign is the direction.
    [{ target_weight: -20 }, { target_weight: -30, rep_low: 6, rep_high: 8, sets: 3 }, `Raised your ${PRESS} target`],
    [
      { target_weight: 100, rep_low: 8, rep_high: 10 },
      { target_weight: 100, rep_low: 6, rep_high: 8, sets: 3 },
      `Reshaped your ${PRESS} rep range`,
    ],
    [{ target_weight: 100, sets: 4 }, { target_weight: 100, rep_low: 6, rep_high: 8, sets: 3 }, `Added volume to your ${PRESS}`],
  ];
  for (const [afterValues, before, title] of cases) {
    const { id } = landedDecision({
      source: "auto-progression",
      action: {
        changes: [
          {
            day_number: 1,
            exercise: PRESS,
            sets: before.sets,
            rep_low: before.rep_low,
            rep_high: before.rep_high,
            target_seconds: null,
            ...afterValues,
            change: "updated",
            before: { target_seconds: null, ...before },
          },
        ],
      },
    });
    const row = feedRows().find((change) => change.id === id);
    assert.equal(row.title, title, JSON.stringify(afterValues));
  }
});

test("two lifts that went different ways say so, and an unreadable direction stays 'moved'", () => {
  const raised = landedDecision({
    source: "auto-progression",
    action: {
      changes: [
        { day_number: 1, exercise: PRESS, target_weight: 105, before: { target_weight: 100 } },
        { day_number: 1, exercise: ROW, target_weight: 80, before: { target_weight: 80 } },
      ],
    },
  }).id;
  // An older row with no before-values: the feed does not guess a direction.
  const legacy = landedDecision({
    source: "auto-progression",
    action: { changes: [{ day_number: 1, exercise: CURL, target_weight: 30 }] },
  }).id;
  const rows = feedRows();
  assert.equal(
    rows.find((row) => row.id === raised).title,
    `Raised your ${PRESS} target and held your ${ROW} target`
  );
  assert.equal(rows.find((row) => row.id === legacy).title, `Moved your ${CURL} target`);
});

// ---------- 3. no absolute date inside a row that sits under its day ----------

test("a stored reason's pinned date reads as today in the feed, and the stored text keeps it", () => {
  repo.setSettings({ lead_mode: "lead" });
  seedDay([{ exercise: PRESS, sets: 3, rep_low: 6, rep_high: 8, target_weight: 100 }]);
  const draft = progressionDraft([
    {
      day_number: 1,
      exercise: PRESS,
      target_weight: 100,
      reason:
        "Keeping the load where it is — this muscle got a heavy dose recently, so today isn't the day to push. That's a brake, not a penalty.",
    },
  ]);
  // The stored reason is pinned to its date on purpose (it has to read true next month).
  const stored = repo.getProposal(Number(draft.id)).parsed.changes[0].reason;
  assert.match(stored, MONTH_DATE, "the ledger keeps its dated reason");
  landDraft(draft);

  const [row] = feedRows();
  assert.doesNotMatch(row.why, MONTH_DATE);
  assert.match(row.why, /so today isn't the day to push\./);
  assert.equal(
    repo.getProposal(Number(draft.id)).parsed.changes[0].reason,
    stored,
    "only the projection is rewritten"
  );
});

test("a row from earlier this week names the day the way the feed does, and a date nothing can say plainly takes its sentence", () => {
  const today = localDateISO();
  const day = shiftDay(today, -3);
  const { id } = landedDecision({
    effective_date: day,
    applied_at: `${day}T09:00:00.000Z`,
    kind: "recovery_adjustment",
    domain: "recovery",
    rationale: [
      `Your legs took a heavy dose, so on ${humanDate(day)} the load held.`,
      `A heavy block started ${humanDate(shiftDay(day, -20))}.`,
      `Soreness was logged through ${humanDate(shiftDay(day, -20))}.`,
    ].join(" "),
  });
  const session = landedDecision({
    effective_date: day,
    applied_at: `${day}T10:00:00.000Z`,
    kind: "recovery_adjustment",
    domain: "recovery",
    rationale: `The ${humanDate(shiftDay(day, -1))} session ran long, so the week of ${humanDate(day)} eases.`,
  }).id;
  const rows = feedRows();
  const row = rows.find((change) => change.id === id);
  assert.doesNotMatch(row.why, MONTH_DATE);
  assert.doesNotMatch(row.why, ISO_DATE);
  const weekdayOf = (iso) =>
    new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
  assert.equal(row.why, `Your legs took a heavy dose, so on ${weekdayOf(day)} the load held. Soreness was logged.`);
  assert.doesNotMatch(row.why, /that day/);
  // The week is said from where the reader stands: the row's week is "this week" while
  // it is still the current one.
  const monday = (iso) => shiftDay(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7));
  const week = monday(day) === monday(today) ? "this week" : "that week";
  assert.equal(
    rows.find((change) => change.id === session).why,
    `${weekdayOf(shiftDay(day, -1))}'s session ran long, so ${week} eases.`
  );
});

test("a row from further back leaves out its own day — the day it sits under already says it", () => {
  const day = shiftDay(localDateISO(), -20);
  const { id } = landedDecision({
    effective_date: day,
    applied_at: `${day}T09:00:00.000Z`,
    kind: "recovery_adjustment",
    domain: "recovery",
    rationale: `On ${humanDate(day)} the week eased. Your legs took a heavy dose, so on ${humanDate(day)} the load held.`,
  });
  const session = landedDecision({
    effective_date: day,
    applied_at: `${day}T10:00:00.000Z`,
    kind: "recovery_adjustment",
    domain: "recovery",
    rationale: `The ${humanDate(shiftDay(day, -1))} session ran long, so the ${humanDate(day)} session was eased.`,
  }).id;
  const rows = feedRows(brainChangesRead({ days: 30 }));
  const row = rows.find((change) => change.id === id);
  assert.equal(row.why, "The week eased. Your legs took a heavy dose, so the load held.");
  assert.equal(
    rows.find((change) => change.id === session).why,
    "The previous day's session ran long, so the session was eased."
  );
  for (const change of [row, rows.find((c) => c.id === session)]) assert.doesNotMatch(change.why, /that day/);
});

test("a row landed today reads 'today' and 'yesterday'", () => {
  const today = localDateISO();
  const { id } = landedDecision({
    kind: "recovery_adjustment",
    domain: "recovery",
    rationale: `On ${humanDate(today)} the week eases, after the ${humanDate(shiftDay(today, -1))} session ran long.`,
  });
  const row = feedRows().find((change) => change.id === id);
  assert.equal(row.why, "Today the week eases, after yesterday's session ran long.");
});

// ---------- 4. a meal plan is not a change to what the athlete does ----------

test("an agent's meal plan never reaches the Changes feed; a calorie target still does", () => {
  const mealPlan = landedDecision({
    kind: "meal_plan",
    domain: "nutrition",
    summary:
      "7-day sustainable recomposition meal plan anchored to your accepted calorie target with high-protein breakfasts",
    rationale: "A long paragraph about the week of meals. ".repeat(12).trim(),
    action: { meal_plan_id: 1, previous_meal_plan_id: null },
  });
  const target = landedDecision({
    kind: "nutrition_target",
    domain: "nutrition",
    summary: "Nudged your calorie target down a little",
    action: { target_kcal: 2300 },
  });
  const rows = feedRows();
  assert.equal(
    rows.some((row) => row.id === mealPlan.id),
    false,
    "meal ideas are never a change"
  );
  assert.ok(rows.some((row) => row.id === target.id));
  assert.equal(brainChangesRead().since_seen, rows.filter((row) => row.new).length);
});

// ---------- 5. a progression across several lifts gets a counted, spoken why ----------

const UP_WHYS = new Set([
  "Your recent sessions carried these, so each one moved up a step.",
  "Your logged sessions earned a step up on each of these.",
  "Each of these moved up a step on the strength of your recent sessions.",
]);

test("a multi-lift progression with no written why says which way the lifts went", () => {
  repo.setSettings({ lead_mode: "lead" });
  seedDay([
    { exercise: PRESS, sets: 3, rep_low: 6, rep_high: 8, target_weight: 100 },
    { exercise: ROW, sets: 3, rep_low: 8, rep_high: 10, target_weight: 80 },
    { exercise: CURL, sets: 3, rep_low: 10, rep_high: 12, target_weight: 30 },
  ]);
  landDraft(
    progressionDraft([
      { day_number: 1, exercise: PRESS, target_weight: 105 },
      { day_number: 1, exercise: ROW, target_weight: 85 },
      { day_number: 1, exercise: CURL, target_weight: 35 },
    ])
  );
  const [row] = feedRows();
  assert.equal(row.title, "Raised your targets on 3 lifts");
  assert.ok(UP_WHYS.has(row.why), `a known step-up phrasing, got ${JSON.stringify(row.why)}`);
  // One wording per row per day: reading again says the same thing.
  assert.equal(feedRows()[0].why, row.why);
});

test("a mixed progression names the count up and held, never a cause the data doesn't show", () => {
  const { id } = landedDecision({
    source: "auto-progression",
    action: {
      changes: [
        { day_number: 1, exercise: PRESS, target_weight: 105, before: { target_weight: 100 } },
        { day_number: 1, exercise: ROW, target_weight: 85, before: { target_weight: 80 } },
        { day_number: 1, exercise: CURL, target_weight: 30, before: { target_weight: 30 } },
      ],
    },
  });
  const row = feedRows().find((change) => change.id === id);
  assert.equal(row.title, "Adjusted your targets on 3 lifts");
  assert.ok(
    ["Two moved up a step and one held where it was.", "Of these, two moved up a step and one held where it was."].includes(
      row.why
    ),
    row.why
  );
});

test("the composed why stays null when a direction is unreadable or the change is not the engine's", () => {
  const unreadable = landedDecision({
    source: "auto-progression",
    action: {
      changes: [
        { day_number: 1, exercise: PRESS, target_weight: 105, before: { target_weight: 100 } },
        { day_number: 1, exercise: ROW, target_weight: 85 },
      ],
    },
  }).id;
  const agent = landedDecision({
    source: "stub",
    summary: "Auto-progression for day 1 — 2 lifts",
    action: {
      changes: [
        { day_number: 1, exercise: PRESS, target_weight: 105, before: { target_weight: 100 } },
        { day_number: 1, exercise: ROW, target_weight: 85, before: { target_weight: 80 } },
      ],
    },
  }).id;
  const rows = feedRows();
  assert.equal(rows.find((row) => row.id === unreadable).why, null);
  assert.equal(rows.find((row) => row.id === agent).why, null);
});

// ---------- 6. a why is a sentence or two, cut at a sentence ----------

test("a long why is capped at a sentence boundary, never mid-word", () => {
  const sentences = [
    "Your pressing has climbed steadily for three weeks and every set landed inside the range.",
    "The step up keeps that going without asking more of your shoulders than they have shown.",
    "Sleep has been steady, so recovery is not the limiter right now for this lift.",
    "If a set stalls, the load holds and the reps climb first before anything else moves.",
    "That keeps the work honest and the progress calm across the whole block.",
  ];
  const { id } = landedDecision({ kind: "recovery_adjustment", domain: "recovery", rationale: sentences.join(" ") });
  const row = feedRows().find((change) => change.id === id);
  assert.equal(row.why, `${sentences[0]} ${sentences[1]}`);
  assert.ok(row.why.length <= 240);

  const oneLong = `${"The load holds while the reps climb across every working set, ".repeat(6).trim()} and then it moves.`;
  const long = landedDecision({ kind: "recovery_adjustment", domain: "recovery", rationale: oneLong }).id;
  const cut = feedRows().find((change) => change.id === long).why;
  assert.ok(cut.length <= 240, `capped, got ${cut.length}`);
  assert.ok(cut.endsWith("…"));
  const kept = cut.slice(0, -1);
  assert.ok(oneLong.startsWith(kept), "a prefix of what was written");
  assert.match(oneLong[kept.length], /[\s,]/, "cut at a word boundary, never mid-word");
});
