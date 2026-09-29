// The athlete's word on how a run felt outranks the watch's intensity grade.
//
// The live case (owner, 2026-09-29) — a stated-easy Tuesday: 9.68 km in 53.9 min at an
// average of 157 bpm, Garmin "load 219 · effect 4.5". "For that run I kept it
// conversational… it did not take a toll. My a bit elevated HR 150 would be a super
// super easy run." With nothing to say so, training effect 4.5 graded the day hard
// cardio, `harmEvidenceOnDay` charged it, and the run engine's demonstrated-capacity
// resume refused to climb through the week.
//
//   • a run stated easy (rpe ≤ 4) is not hard-cardio harm and not an easy-running miss
//     by heart rate alone;
//   • the NEXT MORNING still outranks the statement: a rest-grade readiness is harm;
//   • an unstated run at the same numbers reads exactly as before;
//   • with heart rate the statement is a talk-test observation, and three of them on
//     different days lift the personal easy line — bounded, never from one run;
//   • one writer behind REST, MCP and chat.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { db, repo, resetTables } from "./_seed.js";
import { harmEvidenceOnDay } from "../dist/repo/brain/read-adherence.js";
import { closedWeekRunHarm } from "../dist/repo/run-capacity.js";
import { RUN_CAPACITY_RESUME_VARIANTS, runIntensityDiscipline } from "../dist/repo/run-progression.js";
import { getHrModel, TALK_TEST_Z2_CAP_OF_LTHR } from "../dist/repo/hr-model.js";
import { recordCalibrationEvent } from "../dist/repo/calibration.js";
import { setActivityFeltEffort } from "../dist/repo/activity-effort.js";
import { trainingLogRouter } from "../dist/routes/training-log.js";
import { registerTrainingLogTools } from "../dist/surfaces/mcp/training-log.js";
import { applyChatActions } from "../dist/chatTurns.js";
import { localDateISO } from "../dist/repo/shared.js";

const RACE = "2031-11-02";
const HALF = 21.1;
const TODAY = "2031-09-30"; // Tuesday of the week being planned
const SUNDAY_BEFORE = "2031-09-28";
const EASY_TUESDAY = "2031-09-23"; // the stated-easy day of the week just closed
const MORNING_AFTER = "2031-09-24";

beforeEach(() => {
  resetTables(
    "activities",
    "garmin_activities",
    "garmin_daily_metrics",
    "garmin_sources",
    "calibration_events",
    "hr_model_state",
    "context_events",
    "sessions",
    "plan_items",
    "plan_days",
    "program_blocks",
    "app_state",
    "checkins",
    "profile"
  );
});

const run = (date, distance) =>
  repo.addActivity({ type: "run", duration_min: Math.round(distance * 6), distance_km: distance, date });

let garminSeq = 0;
// A watch run: the Garmin row and its activities mirror, linked.
function watchRun({ date, km = 9.68, minutes = 53.9, avgHr = 157, maxHr = 176, te = 4.5, load = 219 }) {
  garminSeq += 1;
  repo.upsertGarminActivity({
    external_id: `stated-${garminSeq}`,
    date,
    type: "running",
    name: "Run",
    duration_min: minutes,
    moving_min: minutes,
    distance_km: km,
    avg_hr: avgHr,
    max_hr: maxHr,
    aerobic_te: te,
    training_effect: te,
    training_load: load,
  });
  return db
    .prepare(`SELECT a.id FROM activities a JOIN garmin_activities g ON g.activity_id = a.id WHERE g.external_id = ?`)
    .get(`stated-${garminSeq}`).id;
}

// Tue easy / Thu quality / Sun long, a supporting runner with a dated half — the same
// athlete as runCapacityFloor.test.js (a 32.5 km week run well, then a 17 km one), with
// the closed week's Tuesday run the watch's.
function seedAthlete() {
  repo.setProfile({
    age: 40,
    sex: "male",
    primary_discipline: "hybrid",
    endurance_sport: "running",
    training_intent: {
      priorities: ["longevity", "muscle", "strength", "leanness", "endurance"],
      endurance_role: "supporting",
    },
    endurance_goal: { mode: "race", event: "City Half", date: RACE, distance_km: HALF, target: "sub-2:00" },
    endurance_schedule: {
      days: [
        { dow: 0, kind: "long" },
        { dow: 2, kind: "easy" },
        { dow: 4, kind: "quality" },
      ],
      source: "athlete",
    },
  });
  for (const [date, km] of [
    ["2031-09-02", 5.0],
    ["2031-09-04", 5.5],
    ["2031-09-07", 10.0],
    ["2031-09-09", 4.5],
    ["2031-09-11", 6.0],
    ["2031-09-14", 12.9],
    ["2031-09-16", 4.9],
    ["2031-09-18", 9.9],
    ["2031-09-21", 17.7],
    ["2031-09-25", 5.0],
    ["2031-09-28", 8.0],
  ])
    run(date, km);
  // The lighter week's Tuesday: the watch graded it effect 4.5 at 157 bpm. Its length is
  // the capacity suite's own 4 km, so the closed week stays the 17 km that suite resumes
  // from — the live run's numbers are the fixtures further down.
  return watchRun({ date: EASY_TUESDAY, km: 4.0, minutes: 24 });
}

const resumes = (plan) => {
  const heads = RUN_CAPACITY_RESUME_VARIANTS.map((say) => say(33).slice(0, 20));
  return plan.rationale.some((line) => heads.some((head) => line.startsWith(head)));
};

// ── harm and the run engine ────────────────────────────────────────────────────

test("unstated: a 157-avg, effect-4.5 run on the easy Tuesday still grades hard cardio", () => {
  seedAthlete();
  repo.upsertGarminDailyMetric({ date: MORNING_AFTER, training_readiness: 50 });
  assert.equal(harmEvidenceOnDay(EASY_TUESDAY)?.kind, "hard_cardio");
  assert.equal(closedWeekRunHarm(SUNDAY_BEFORE)?.kind, "hard_cardio");
  assert.equal(resumes(repo.weeklyRunPlan(TODAY, { adjustToday: false })), false);
});

test("stated easy, neutral next morning: no harm, and the capacity resume stands", () => {
  const id = seedAthlete();
  repo.upsertGarminDailyMetric({ date: MORNING_AFTER, training_readiness: 50 });
  const said = setActivityFeltEffort(id, { rpe: 3, note: "kept it conversational, it did not take a toll" });
  assert.equal(said.ok, true);
  assert.equal(said.stated_easy, true);
  assert.equal(harmEvidenceOnDay(EASY_TUESDAY), null);
  assert.equal(closedWeekRunHarm(SUNDAY_BEFORE), null);
  const plan = repo.weeklyRunPlan(TODAY, { adjustToday: false });
  assert.ok(resumes(plan), plan.rationale.join(" | "));
});

test("the live run itself: 9.68 km at 157, effect 4.5, stated conversational — no harm", () => {
  seedAthlete();
  const live = watchRun({ date: "2031-09-30" });
  repo.upsertGarminDailyMetric({ date: "2031-10-01", training_readiness: 50 });
  assert.equal(harmEvidenceOnDay("2031-09-30")?.kind, "hard_cardio");
  setActivityFeltEffort(live, { rpe: 3 });
  assert.equal(harmEvidenceOnDay("2031-09-30"), null);
});

test("stated easy, good next morning: no harm", () => {
  const id = seedAthlete();
  repo.upsertGarminDailyMetric({ date: MORNING_AFTER, training_readiness: 78 });
  setActivityFeltEffort(id, { rpe: 2 });
  assert.equal(harmEvidenceOnDay(EASY_TUESDAY), null);
});

test("stated easy, but the next morning read rest-grade: the body's answer stands", () => {
  const id = seedAthlete();
  repo.upsertGarminDailyMetric({ date: MORNING_AFTER, training_readiness: 12 });
  setActivityFeltEffort(id, { rpe: 3 });
  assert.equal(harmEvidenceOnDay(EASY_TUESDAY)?.kind, "readiness_rest_grade");
  assert.equal(closedWeekRunHarm(SUNDAY_BEFORE)?.kind, "readiness_rest_grade");
  assert.equal(resumes(repo.weeklyRunPlan(TODAY, { adjustToday: false })), false);
});

test("a stated WORKING effort is not a talk test: the watch's grade stands", () => {
  const id = seedAthlete();
  setActivityFeltEffort(id, { rpe: 6 });
  assert.equal(harmEvidenceOnDay(EASY_TUESDAY)?.kind, "hard_cardio");
  // …and clearing it puts the run back exactly where it was.
  setActivityFeltEffort(id, { rpe: 3 });
  assert.equal(harmEvidenceOnDay(EASY_TUESDAY), null);
  setActivityFeltEffort(id, { rpe: null });
  assert.equal(harmEvidenceOnDay(EASY_TUESDAY)?.kind, "hard_cardio");
});

test("a hand log shadowing the watch run carries its felt effort onto the watch row", () => {
  const watchId = seedAthlete();
  const hand = repo.addActivity({
    type: "run",
    date: EASY_TUESDAY,
    duration_min: 24,
    distance_km: 4.0,
    enrichment_status: null,
  });
  const said = setActivityFeltEffort(hand.id, { rpe: 3 });
  assert.equal(said.ok, true);
  assert.equal(said.activity.id, watchId);
  assert.equal(harmEvidenceOnDay(EASY_TUESDAY), null);
});

test("refusals: a bad id, an out-of-scale rpe, a missing row", () => {
  assert.equal(setActivityFeltEffort("abc", { rpe: 3 }).code, "invalid_id");
  assert.equal(setActivityFeltEffort(1, { rpe: 11 }).code, "invalid_rpe");
  assert.equal(setActivityFeltEffort(1, { rpe: undefined }).code, "invalid_rpe");
  assert.equal(setActivityFeltEffort(987654, { rpe: 3 }).code, "not_found");
});

// ── the personal HR model: intensity discipline + talk tests ─────────────────────

const REF = "2031-06-30";
const shift = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);

// The owner's model: a field-tested threshold of 167, so an easy line of 149 (0.89).
function seedFieldTestedModel() {
  for (const days of [60, 70, 80, 90])
    watchRun({ date: shift(REF, -days), km: 6, minutes: 36, avgHr: 145, maxHr: 182, te: 2.8, load: 60 });
  recordCalibrationEvent({
    kind: "lthr_tt",
    date: shift(REF, -30),
    target_key: "lthr",
    result: { lthr: 167 },
    source: "stated",
  });
}

test("the fixture model: threshold 167, easy line 149", () => {
  seedFieldTestedModel();
  const model = getHrModel(REF);
  assert.equal(model.lthr, 167);
  assert.equal(model.zones.z2_top, 149);
  assert.equal(model.easy_basis, "lthr");
});

test("stated-easy runs count as easy running, whatever the average", () => {
  seedFieldTestedModel();
  const ids = [2, 5, 9, 12].map((days) =>
    watchRun({ date: shift(REF, -days), minutes: 45, km: 8, avgHr: 157, te: 3.4, load: 120 })
  );
  const before = runIntensityDiscipline(REF);
  assert.equal(before.status, "compressed");
  assert.equal(before.above_easy_count, 4);
  for (const id of ids) setActivityFeltEffort(id, { rpe: 3 });
  const after = runIntensityDiscipline(REF);
  assert.equal(after.status, "polarized");
  assert.equal(after.easy_count, 4);
  assert.equal(after.above_easy_count, 0);
});

test("one conversational run never moves the easy line; three do, bounded by the threshold", () => {
  seedFieldTestedModel();
  const first = watchRun({ date: shift(REF, -3), minutes: 54, avgHr: 157 });
  const said = setActivityFeltEffort(first, { rpe: 3, note: "conversational" });
  assert.equal(said.talk_test?.kind, "talk_test");
  assert.equal(said.talk_test?.result.avg_hr, 157);
  assert.equal(said.talk_test?.result.note, "conversational");
  assert.equal(getHrModel(REF).zones.z2_top, 149, "one run is a statement, not a pattern");

  setActivityFeltEffort(watchRun({ date: shift(REF, -10), minutes: 48, avgHr: 155 }), { rpe: 3 });
  assert.equal(getHrModel(REF).zones.z2_top, 149, "two is still not a pattern");

  setActivityFeltEffort(watchRun({ date: shift(REF, -17), minutes: 60, avgHr: 158 }), { rpe: 2 });
  const model = getHrModel(REF);
  // Median 157 less the tolerance is 155, capped at 0.92 × 167 = 154.
  assert.equal(model.zones.z2_top, Math.round(167 * TALK_TEST_Z2_CAP_OF_LTHR));
  assert.equal(model.zones.z2_top, 154);
  assert.equal(model.easy_basis, "talk_test");
  assert.equal(model.talk_test_runs, 3);
  assert.ok(model.zones.z2_top < model.zones.z3_top, "easy never swallows the steady band");
  // The threshold itself is untouched.
  assert.equal(model.lthr, 167);
});

test("a talk test the next morning disagreed with, or one taken back, does not count", () => {
  seedFieldTestedModel();
  const a = watchRun({ date: shift(REF, -3), minutes: 54, avgHr: 157 });
  const b = watchRun({ date: shift(REF, -10), minutes: 48, avgHr: 155 });
  const c = watchRun({ date: shift(REF, -17), minutes: 60, avgHr: 158 });
  for (const id of [a, b, c]) setActivityFeltEffort(id, { rpe: 3 });
  assert.equal(getHrModel(REF).zones.z2_top, 154);

  // Rest-grade the morning after one of them: two left, no pattern.
  repo.upsertGarminDailyMetric({ date: shift(REF, -16), training_readiness: 10 });
  assert.equal(getHrModel(REF).zones.z2_top, 149);
  resetTables("garmin_daily_metrics");
  assert.equal(getHrModel(REF).zones.z2_top, 154);

  // Re-stated as a working effort: the observation is withdrawn.
  setActivityFeltEffort(a, { rpe: 6 });
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM calibration_events WHERE kind = 'talk_test'`).get().n, 2);
  assert.equal(getHrModel(REF).zones.z2_top, 149);
});

test("short runs are not talk tests", () => {
  seedFieldTestedModel();
  for (const days of [3, 10, 17])
    setActivityFeltEffort(watchRun({ date: shift(REF, -days), minutes: 20, km: 3.5, avgHr: 157 }), { rpe: 3 });
  assert.equal(getHrModel(REF).zones.z2_top, 149);
});

// ── the capture paths: REST, MCP, chat ──────────────────────────────────────────

function withServer(fn) {
  const app = express();
  app.use(express.json());
  app.use("/api", trainingLogRouter);
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", async () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      try {
        resolve(await fn(base));
      } catch (error) {
        reject(error);
      } finally {
        server.close();
      }
    });
  });
}

test("PUT /api/activities/:id/effort states it; bad input is refused", async () => {
  const id = watchRun({ date: EASY_TUESDAY });
  await withServer(async (base) => {
    const put = (path, body) =>
      fetch(`${base}/api${path}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const ok = await put(`/activities/${id}/effort`, { rpe: 3, note: "conversational" });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.ok, true);
    assert.equal(body.rpe, 3);
    assert.equal(body.stated_easy, true);
    assert.equal((await put(`/activities/${id}/effort`, { rpe: 0 })).status, 400);
    assert.equal((await put(`/activities/987654/effort`, { rpe: 3 })).status, 404);
  });
  assert.equal(repo.getActivity(id).rpe, 3);
});

test("the set_activity_effort MCP tool is the near-mirror of the route", async () => {
  const tools = new Map();
  registerTrainingLogTools({ tool: (name, _d, _s, handler) => tools.set(name, handler) });
  const id = watchRun({ date: EASY_TUESDAY });
  const out = JSON.parse((await tools.get("set_activity_effort")({ id, rpe: 3 })).content[0].text);
  assert.equal(out.ok, true);
  assert.equal(out.stated_easy, true);
  assert.equal(repo.getActivity(id).rpe, 3);
});

test("chat: 'I kept that run conversational' lands on today's run", () => {
  const today = localDateISO();
  const id = watchRun({ date: today });
  const { applied } = applyChatActions(
    {
      actions: [
        { type: "set_activity_effort", rpe: 3, note: "For that run I kept it conversational, it did not take a toll" },
      ],
    },
    { agent: "stub", message: "For that run I kept it conversational.. it did not take a toll" }
  );
  assert.equal(applied.length, 1);
  assert.equal(applied[0].type, "set_activity_effort");
  assert.equal(applied[0].result.ok, true);
  assert.equal(repo.getActivity(id).rpe, 3);
  const event = db.prepare(`SELECT result_json FROM calibration_events WHERE kind = 'talk_test'`).get();
  assert.match(JSON.parse(event.result_json).note, /conversational/);
});

test("chat: a felt effort with no rpe, or no run that day, writes nothing", () => {
  const none = applyChatActions(
    { actions: [{ type: "set_activity_effort", note: "felt easy" }] },
    { agent: "stub", message: "felt easy" }
  );
  assert.equal(none.applied.length, 0);
  const noRun = applyChatActions(
    { actions: [{ type: "set_activity_effort", rpe: 3 }] },
    { agent: "stub", message: "easy run" }
  );
  assert.equal(noRun.applied[0].result.ok, false);
});
