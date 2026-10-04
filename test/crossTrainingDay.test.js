// The cross-training day: stated, then observed (owner decision 2026-10-04).
//
// A Saturday ride before the Sunday long run is the athlete's week, not a conflict. The
// optional day they named lives in `endurance_schedule.cross_training` (never a run day);
// with none named, a non-run, non-light family on the same weekday in two of the last six
// weeks is the observed pattern. A known day blocks only its own date for a key run, so
// the long run keeps Sunday and carries a leg-load caveat instead; an unpatterned hard
// ride still blocks the next day.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { repo } from "./_seed.js";
import { crossTrainingDays, isKnownCrossTrainingDate } from "../dist/repo/cross-training-day.js";
import { raceBuild } from "../dist/repo/race-build.js";
import { dayFuelDemand } from "../dist/repo/fuel-demand.js";
import { normalizeEnduranceSchedule, isStatedRunDay, getEnduranceSchedule } from "../dist/repo/profile.js";
import { registerPersonTools } from "../dist/surfaces/mcp/person.js";
import { registerTrainingStatusTools } from "../dist/surfaces/mcp/training-status.js";
import { personRouter } from "../dist/routes/person.js";
import { applyChatActions } from "../dist/chatTurns.js";
import { normalizeChatAction } from "../dist/chatActions.js";
import { violatesReadingGrammar } from "../dist/repo/day-read-grammar.js";
import {
  FRI,
  SAT,
  SUN,
  activity,
  resetLiveWeekTables,
  ride,
  run,
  seedHistory,
  seedLiveWeek,
  seedProfile,
} from "./_liveWeekFixture.js";

const SAT_RIDE = [{ dow: 6, sport: "ride", optional: true }];

beforeEach(resetLiveWeekTables);

function longIntent(agenda) {
  return agenda.intents.find((intent) => intent.kind === "long");
}

// ── the long run keeps Sunday ────────────────────────────────────────────────────

for (const [name, crossTraining, source] of [
  ["stated", SAT_RIDE, "stated"],
  ["observed", undefined, "observed"],
]) {
  test(`a ${name} Saturday ride leaves the Sunday long run its date, with a leg-load caveat`, (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-04T07:00:00Z") });
    seedProfile({ crossTraining });
    seedHistory();
    seedLiveWeek({ withSunday: false });
    const known = isKnownCrossTrainingDate(SAT);
    assert.equal(known?.source, source);
    assert.equal(known?.sport_family, "ride");
    if (source === "observed") assert.equal(known.weeks_seen, 2);

    const agenda = repo.flexibleTrainingAgenda(SUN);
    const long = longIntent(agenda);
    assert.equal(long.status, "open");
    assert.equal(long.suggested_date, SUN, "the stated long run keeps Sunday");
    assert.match(long.rationale, /in the legs/);
    assert.match(long.rationale, /conversational/);
    assert.equal(agenda.next?.suggested_date, SUN);
    assert.match(agenda.next.guidance, /in the legs/);
    assert.notEqual(agenda.today_guidance, "not_first_choice");
  });
}

test("an unpatterned hard ride on a Wednesday still blocks Thursday's key run", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-30T20:00:00Z") });
  seedProfile();
  // History without any ride, so Wednesday is no pattern.
  for (const [date, km] of [
    ["2026-09-15", 8.0],
    ["2026-09-17", 6.5],
    ["2026-09-20", 12.0],
    ["2026-09-22", 8.0],
    ["2026-09-24", 7.0],
    ["2026-09-27", 12.9],
  ])
    run(date, km, { rpe: 3 });
  run("2026-09-29", 8, { rpe: 3 });
  ride("2026-09-30", 150, { load: 260, te: 4.2, name: "Road Ride" });
  assert.equal(isKnownCrossTrainingDate("2026-09-30"), null);
  const agenda = repo.flexibleTrainingAgenda("2026-09-30");
  const quality = agenda.intents.find((intent) => intent.kind === "quality");
  assert.ok(quality, "the week holds a quality run");
  assert.equal(quality.status, "open");
  assert.notEqual(quality.suggested_date, "2026-10-01", "Thursday stays blocked after an unpatterned hard ride");
});

test("one ride in six weeks is an outing, not a pattern; a light ride never makes one", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-04T20:00:00Z") });
  seedProfile();
  ride(SAT, 142, { load: 240, te: 4 });
  assert.deepEqual(crossTrainingDays(SUN), []);
  // A short easy spin on the Saturday two weeks earlier reads light.
  ride("2026-09-19", 15, { load: 10, te: 1 });
  assert.deepEqual(crossTrainingDays(SUN), []);
});

// ── the race build ───────────────────────────────────────────────────────────────

for (const [name, crossTraining, source] of [
  ["observed", undefined, "observed"],
  ["stated", SAT_RIDE, "stated"],
]) {
  test(`the race build places the ${name} Saturday ride the day before the long run`, (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-04T20:00:00Z") });
    seedProfile({ crossTraining });
    seedHistory();
    seedLiveWeek();
    const build = raceBuild(SUN);
    assert.ok(build.ride, "the ride is read");
    assert.equal(build.ride.source, source);
    assert.equal(build.ride.sport_family, "ride");
    assert.equal(build.ride.weekday, "Saturday");
    assert.equal(build.ride.day_number, 6);
    assert.match(build.ride.placement, /the day before the long run/);
    assert.match(build.ride.placement, /legs/);
    assert.equal(violatesReadingGrammar(build.ride.placement), null);
    const saturday = build.leg_map.find((day) => day.day_number === 6);
    assert.equal(saturday?.ride, true);
  });
}

// ── fuel ─────────────────────────────────────────────────────────────────────────

test("an upcoming Saturday that is the known ride day is fuelled big; a logged one stays log-truth", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-05T08:00:00Z") });
  seedProfile();
  seedHistory();
  seedLiveWeek();
  const ahead = dayFuelDemand("2026-10-10", { today: "2026-10-05" });
  assert.equal(ahead.demand, "big");
  assert.ok(ahead.drivers.includes("your usual Saturday ride"), JSON.stringify(ahead.drivers));
  assert.ok(ahead.evidence.includes("cross_training_day"));

  const logged = dayFuelDemand(SAT, { today: "2026-10-05" });
  assert.equal(logged.demand, "big");
  assert.ok(logged.drivers.includes("long ride or endurance session on this day"));
  assert.ok(!logged.evidence.includes("cross_training_day"), "a logged day is described by its log");
});

test("the stated optional ride is named as the athlete's own", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-05T08:00:00Z") });
  seedProfile({ crossTraining: SAT_RIDE });
  seedHistory();
  seedLiveWeek();
  const ahead = dayFuelDemand("2026-10-10", { today: "2026-10-05" });
  assert.ok(ahead.drivers.includes("the optional ride you named"), JSON.stringify(ahead.drivers));
});

// ── the schedule field ───────────────────────────────────────────────────────────

test("normalizeEnduranceSchedule keeps cross-training out of the run days", () => {
  const schedule = normalizeEnduranceSchedule({
    days: [
      { dow: 0, kind: "long" },
      { dow: 2, kind: "easy" },
      { dow: 6, kind: "ride", optional: true },
      { dow: 5, kind: "eazy" },
    ],
    cross_training: [{ dow: 3, sport: "kayaking" }, { dow: 9, sport: "ride" }, "nonsense"],
  });
  assert.deepEqual(
    schedule.days.map((d) => [d.dow, d.kind]),
    [
      [0, "long"],
      [2, "easy"],
    ],
    "a run day never holds a non-run kind, and the typo is dropped alone"
  );
  assert.deepEqual(schedule.cross_training, [
    { dow: 3, sport: "paddle", optional: true },
    { dow: 6, sport: "ride", optional: true },
  ]);
  // A days[] that names only the cross-training day is understood, not rejected.
  const only = normalizeEnduranceSchedule({ days: [{ dow: 6, kind: "mtb", optional: true }] });
  assert.deepEqual(only.days, []);
  assert.deepEqual(only.cross_training, [{ dow: 6, sport: "ride", optional: true }]);
  // At most three.
  const many = normalizeEnduranceSchedule({
    days: [{ dow: 0, kind: "long" }],
    cross_training: [0, 1, 2, 3, 4].map((dow) => ({ dow, sport: "swim" })),
  });
  assert.equal(many.cross_training.length, 3);
});

test("a stated Saturday ride is never a stated run day", () => {
  seedProfile({ crossTraining: SAT_RIDE });
  assert.equal(isStatedRunDay(SAT), false);
  assert.equal(isStatedRunDay(SUN), true);
  assert.deepEqual(getEnduranceSchedule().cross_training, SAT_RIDE);
});

function callPutProfile(body) {
  const layer = personRouter.stack.find((entry) => entry.route?.path === "/profile" && entry.route?.methods?.put);
  const handler = layer?.route?.stack[0]?.handle;
  assert.ok(handler, "PUT /profile is registered");
  let payload;
  handler(
    { body },
    {
      status() {
        return this;
      },
      json(value) {
        payload = value;
        return this;
      },
    }
  );
  return payload;
}

function registeredTools(register) {
  const tools = new Map();
  register({
    tool(name, _description, schema, handler) {
      tools.set(name, { schema, handler });
    },
  });
  return tools;
}

test("PUT /profile, MCP set_profile and the chat action all round-trip a cross-training day", async () => {
  // PUT /profile — the decision's own shape inside days[].
  callPutProfile({
    endurance_schedule: {
      days: [
        { dow: 0, kind: "long" },
        { dow: 6, kind: "ride", optional: true },
      ],
    },
  });
  assert.deepEqual(getEnduranceSchedule().cross_training, SAT_RIDE);
  assert.deepEqual(getEnduranceSchedule().days, [{ dow: 0, kind: "long" }]);

  // MCP set_profile — its zod schema takes the field, and an unreadable entry is
  // dropped by the parser rather than failing the call.
  const setProfileTool = registeredTools(registerPersonTools).get("set_profile");
  const args = z.object(setProfileTool.schema).parse({
    endurance_schedule: {
      days: [{ dow: 2, kind: "easy" }],
      cross_training: [
        { dow: 6, sport: "ride" },
        { dow: 3, sport: "underwater basket weaving" },
      ],
    },
  });
  await setProfileTool.handler(args);
  assert.deepEqual(getEnduranceSchedule().cross_training, [
    { dow: 3, sport: "other", optional: true },
    { dow: 6, sport: "ride", optional: true },
  ]);

  // Re-stating only the run days (set_endurance_schedule carries no such field) keeps it.
  const setRunDays = registeredTools(registerTrainingStatusTools).get("set_endurance_schedule");
  await setRunDays.handler({
    days: [
      { dow: 0, kind: "long" },
      { dow: 4, kind: "quality" },
    ],
  });
  assert.equal(getEnduranceSchedule().days.length, 2);
  assert.equal(getEnduranceSchedule().cross_training.length, 2, "the stated cross-training day survives");
  // The same tool's schema takes a ride day inside days[] and an explicit cross_training.
  const runDaysArgs = z.object(setRunDays.schema).parse({
    days: [
      { dow: 0, kind: "long" },
      { dow: 6, kind: "ride", optional: true },
    ],
  });
  await setRunDays.handler(runDaysArgs);
  assert.deepEqual(getEnduranceSchedule().days, [{ dow: 0, kind: "long" }]);
  assert.deepEqual(getEnduranceSchedule().cross_training, SAT_RIDE, "a ride in days[] moves to cross_training");
  await setRunDays.handler(z.object(setRunDays.schema).parse({ days: [{ dow: 0, kind: "long" }], cross_training: [] }));
  assert.equal(getEnduranceSchedule().cross_training, undefined, "an explicit [] clears through the tool");
  await setRunDays.handler({
    days: [
      { dow: 0, kind: "long" },
      { dow: 4, kind: "quality" },
    ],
    cross_training: [
      { dow: 3, sport: "other" },
      { dow: 6, sport: "ride" },
    ],
  });

  // Chat: the action normalizes and applies with the day intact.
  const action = normalizeChatAction({
    type: "set_endurance_schedule",
    days: [
      { dow: 0, kind: "long" },
      { dow: 2, kind: "easy" },
      { dow: 4, kind: "quality" },
      { dow: 6, kind: "ride", optional: true },
    ],
  });
  assert.ok(action);
  applyChatActions({ actions: [action] }, { agent: "stub", message: "Saturday is my optional MTB, never a run" });
  const stored = getEnduranceSchedule();
  assert.deepEqual(
    stored.days.map((d) => d.dow),
    [0, 2, 4]
  );
  assert.deepEqual(stored.cross_training, SAT_RIDE);
  // An explicit [] clears it.
  callPutProfile({ endurance_schedule: { days: [{ dow: 0, kind: "long" }], cross_training: [] } });
  assert.equal(getEnduranceSchedule().cross_training, undefined);
});

const RUN_DAYS = [
  [0, "long"],
  [2, "easy"],
  [4, "quality"],
];

test("a cross-training-only update keeps the stored run days", async () => {
  seedProfile();
  const action = normalizeChatAction({
    type: "set_endurance_schedule",
    days: [{ dow: 6, kind: "ride", optional: true }],
  });
  assert.ok(action);
  applyChatActions({ actions: [action] }, { agent: "stub", message: "Saturday is my optional ride" });
  let stored = getEnduranceSchedule();
  assert.deepEqual(
    stored.days.map((d) => [d.dow, d.kind]),
    RUN_DAYS
  );
  assert.deepEqual(stored.cross_training, SAT_RIDE);

  // MCP sends the same ride-only days[], and days:[] plus cross_training.
  seedProfile();
  const setRunDays = registeredTools(registerTrainingStatusTools).get("set_endurance_schedule");
  await setRunDays.handler({ days: [{ dow: 6, kind: "ride", optional: true }] });
  stored = getEnduranceSchedule();
  assert.deepEqual(
    stored.days.map((d) => [d.dow, d.kind]),
    RUN_DAYS
  );
  assert.deepEqual(stored.cross_training, SAT_RIDE);

  seedProfile();
  await setRunDays.handler({ days: [], cross_training: [{ dow: 6, sport: "ride" }] });
  stored = getEnduranceSchedule();
  assert.deepEqual(
    stored.days.map((d) => [d.dow, d.kind]),
    RUN_DAYS
  );
  assert.deepEqual(stored.cross_training, SAT_RIDE);

  // days:[] with no cross-training key is the explicit clear of the run days.
  seedProfile({ crossTraining: SAT_RIDE });
  await setRunDays.handler({ days: [] });
  stored = getEnduranceSchedule();
  assert.deepEqual(stored.days, []);
  assert.deepEqual(stored.cross_training, SAT_RIDE);
});

test("a stated Saturday swim before the long run does not claim the legs", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-04T07:00:00Z") });
  seedProfile({ crossTraining: [{ dow: 6, sport: "swim", optional: true }] });
  seedHistory();
  // The live week (Tue easy, Fri moved quality) with a Saturday swim in place of the MTB.
  seedLiveWeek({ withSunday: false, withSaturday: false });
  activity(SAT, { type: "swim", km: 2.5, min: 55, garmin: { type: "lap_swimming", name: "Pool Swim", aerobic_te: 3.4, load: 120 } });
  const agenda = repo.flexibleTrainingAgenda(SUN);
  const long = longIntent(agenda);
  assert.equal(long.suggested_date, SUN);
  assert.match(long.rationale, /swim/);
  assert.match(long.rationale, /sits the day before/);
  assert.doesNotMatch(long.rationale, /legs/);

  const build = raceBuild(SUN);
  assert.match(build.ride.placement, /swim/);
  assert.match(build.ride.placement, /the day before the long run/);
  assert.doesNotMatch(build.ride.placement, /spinning|you ride|legs/);
  assert.equal(violatesReadingGrammar(build.ride.placement), null);
});

test("a hike on the stated MTB Saturday still blocks Sunday's long run", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-03T20:00:00Z") });
  seedProfile({ crossTraining: SAT_RIDE });
  seedHistory();
  seedLiveWeek({ withSunday: false, withSaturday: false });
  activity(SAT, { type: "hike", min: 180, km: 12 });
  const agenda = repo.flexibleTrainingAgenda(SAT);
  const long = longIntent(agenda);
  assert.ok(long, "the week still holds a long run");
  assert.notEqual(long.suggested_date, SUN);
});
