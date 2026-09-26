// v2 wave 4, stream A — the six stones on Today.
//
// GET /api/today/stones projects the five signal dimensions and the domain reads onto
// six athlete-facing words (Strength, Endurance, Fuel, Recovery, Body, Heart). The
// mapping is the server's alone. A part of the picture with nothing fresh reads
// "quiet" — never low — a partial intake day is "in progress", a stale wearable is
// absent, and nothing in the payload is a score.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  db,
  repo,
  localDaysAgo,
  seedHealthDoc,
  marker,
  seedIntake,
  seedSleep,
  seedTrainingDay,
  seedWeight,
} from "./_seed.js";
import {
  BODY_STONE_MAX_AGE_DAYS,
  TODAY_STONE_LINES,
  TODAY_STONE_ORDER,
  TODAY_STONE_WORDS,
  todayStones,
} from "../dist/domain/today/today-stones.js";
import { violatesReadingGrammar } from "../dist/repo/day-read-grammar.js";
import { dayPlanningSignalState } from "../dist/repo/day-read.js";
import { raceBuild } from "../dist/repo/race-build.js";
import { localDateISO } from "../dist/repo/shared.js";
import { todayRouter } from "../dist/routes/today.js";
import { registerDailyDriverTools } from "../dist/surfaces/mcp/daily-driver.js";
import { CLIENT_ROUTE_DEFINITIONS } from "../dist/contracts/client-routes.js";

const KEYS = ["strength", "endurance", "fuel", "recovery", "body", "heart"];
const byKey = (read) => Object.fromEntries(read.stones.map((s) => [s.key, s]));
const LOW = /\blow\b|\bbehind\b|\bshort\b|\bpoor\b|\bbad\b/i;

function assertCalm(read) {
  const json = JSON.stringify(read);
  assert.doesNotMatch(json, /"(?:score|grade|percent|percentile|impact_score)"/i, "no score field");
  for (const s of read.stones) {
    assert.ok(s.word && s.word.split(/\s+/).length <= 2, `${s.key}: one or two words, got "${s.word}"`);
    assert.doesNotMatch(s.word, /\d/, `${s.key}: a word carries no number`);
    assert.equal(violatesReadingGrammar(s.word), null, `${s.key} word "${s.word}"`);
    assert.equal(violatesReadingGrammar(s.line), null, `${s.key} line "${s.line}"`);
    assert.ok(["ok", "watch", "quiet"].includes(s.tone), `${s.key}: tone is a reading-layer tone`);
    assert.doesNotMatch(json, /#[0-9a-f]{3,6}\b/i, "no colours in the DTO");
  }
}

test("always six stones, in order, each opening a route the client knows", () => {
  const read = todayStones();
  assert.deepEqual(TODAY_STONE_ORDER, KEYS);
  assert.deepEqual(
    read.stones.map((s) => s.key),
    KEYS
  );
  assert.equal(read.date, localDateISO());
  for (const s of read.stones) {
    assert.ok(CLIENT_ROUTE_DEFINITIONS.tabs.includes(s.target.tab), `${s.key} tab`);
    if (s.target.section)
      assert.ok(CLIENT_ROUTE_DEFINITIONS.sections[s.target.tab].includes(s.target.section), `${s.key} section`);
    assert.ok(s.label);
  }
  assertCalm(read);
});

test("an empty record reads quiet everywhere — silence is never low", () => {
  const read = todayStones();
  for (const s of read.stones) {
    assert.equal(s.word, "quiet", s.key);
    assert.equal(s.tone, "quiet", s.key);
    assert.equal(s.line, null, s.key);
  }
});

test("missing sleep leaves Recovery quiet, never low; last night's sleep speaks", () => {
  // Other domains carry data, but no night is on record.
  seedWeight(localDaysAgo(1), 180);
  seedIntake(0, 450, {}, { eatenAt: "08:00" });
  let recovery = byKey(todayStones()).recovery;
  assert.equal(recovery.word, "quiet");
  assert.equal(recovery.tone, "quiet");
  assert.doesNotMatch(`${recovery.word} ${recovery.line ?? ""}`, LOW);

  seedSleep(localDateISO(), 470);
  recovery = byKey(todayStones()).recovery;
  assert.equal(recovery.word, TODAY_STONE_WORDS.recovery.rested);
  assert.equal(recovery.tone, "ok");
  assert.ok(recovery.line, "a signal-backed stone speaks its voice");
  assertCalm(todayStones());
});

test("a stale wearable reading is absent: Recovery stays quiet", () => {
  // A short night from days ago would brake if it were current. Stale = absent.
  seedSleep(localDaysAgo(5), 240);
  const recovery = byKey(todayStones()).recovery;
  assert.equal(recovery.word, "quiet");
  assert.equal(recovery.tone, "quiet");
  assert.equal(recovery.line, null);
});

test("a short night last night reads as recovery to watch, in the athlete voice", () => {
  seedSleep(localDateISO(), 280);
  const recovery = byKey(todayStones()).recovery;
  assert.equal(recovery.tone, "watch");
  assert.ok([TODAY_STONE_WORDS.recovery.needs_rest, TODAY_STONE_WORDS.recovery.recovering].includes(recovery.word));
  assert.ok(recovery.line);
  assert.doesNotMatch(recovery.line, /\bthe athlete\b/i, "never the machine register");
});

// The last-night law at the stones layer: an HRV/RHR caution from before last night is
// advice-only, and it may neither outrank last night's own sleep nor speak its "ease
// off" under a calm word.
test("a stale HRV/RHR caution never outranks last night's good sleep", () => {
  for (let d = 25; d >= 3; d--)
    repo.recordDailyMetrics("apple", localDaysAgo(d), { sleep_min: 470, hrv_ms: 70, resting_hr: 50 });
  for (const d of [2, 1])
    repo.recordDailyMetrics("apple", localDaysAgo(d), { sleep_min: 470, hrv_ms: 35, resting_hr: 64 });
  const hrv = dayPlanningSignalState(localDateISO()).dimensions.recovery_capacity.evidence.filter((item) =>
    /hrv|resting/i.test(item.field)
  );
  assert.ok(
    hrv.some((item) => item.direction === "caution" && item.advice_only),
    "fixture: the old excursion rides as advice"
  );

  // Before last night syncs: the advice alone reads calm and silent, never "ease off".
  let recovery = byKey(todayStones()).recovery;
  assert.equal(recovery.tone, "ok");
  assert.equal(recovery.line, null, "a non-braking caution never speaks under a calm word");

  repo.recordDailyMetrics("apple", localDateISO(), { sleep_min: 480 });
  recovery = byKey(todayStones()).recovery;
  assert.equal(recovery.word, TODAY_STONE_WORDS.recovery.rested, "last night leads");
  assert.equal(recovery.tone, "ok");
  assert.doesNotMatch(recovery.line ?? "", /variability|heart rate/i);
});

// A deliberate read: with no night dated today, the multi-night WINDOW (≤2 days old)
// may still speak — as a window claim, never in last night's words.
test("no night last night: a short recent window reads as a window, a normal one stays quiet", () => {
  seedSleep(localDaysAgo(1), 470);
  seedSleep(localDaysAgo(2), 460);
  assert.equal(byKey(todayStones()).recovery.word, "quiet", "a normal window says nothing about today");

  seedSleep(localDaysAgo(1), 300);
  seedSleep(localDaysAgo(2), 290);
  const recovery = byKey(todayStones()).recovery;
  assert.equal(recovery.word, TODAY_STONE_WORDS.recovery.recovering);
  assert.equal(recovery.tone, "watch");
  assert.ok(recovery.line);
  assert.doesNotMatch(recovery.line, /last night|one short night/i, "never last night's words");
});

test("Strength with nothing planned never claims a word over an empty plan", () => {
  repo.addCheckin(localDateISO(), { energy: 3, soreness: 2 });
  // A neutral soreness check-in is training-dimension evidence, but it says nothing
  // about lifting on a day with no plan.
  const strength = byKey(todayStones()).strength;
  assert.equal(strength.word, "quiet");
  assert.equal(strength.tone, "quiet");
  assert.equal(strength.line, null);
});

test("a partial intake day is in progress, never low; a complete day reads fueled", () => {
  seedIntake(0, 450, {}, { eatenAt: "08:00" });
  let fuel = byKey(todayStones()).fuel;
  assert.equal(fuel.word, TODAY_STONE_WORDS.fuel.in_progress);
  assert.equal(fuel.tone, "quiet");
  assert.doesNotMatch(`${fuel.word} ${fuel.line}`, LOW);

  seedIntake(0, 1100, {}, { eatenAt: "19:00" });
  fuel = byKey(todayStones()).fuel;
  assert.equal(fuel.word, TODAY_STONE_WORDS.fuel.fueled);
  assert.equal(fuel.tone, "ok");
});

test("the energy-balance estimate never names Fuel on its own: unsettled reads quiet, never refuel", () => {
  repo.setProfile({ age: 35, sex: "male", height_cm: 180, weight_lb: 184, goal_weight_lb: 170 });
  for (let d = 1; d <= 14; d++) seedWeight(localDaysAgo(d), 184);
  // A thin log inside the window: one morning meal on a past day, nothing today.
  seedIntake(3, 450, {}, { eatenAt: "08:00" });
  const est = dayPlanningSignalState(localDateISO()).dimensions.energy_fueling.evidence.find(
    (item) => item.field === "expenditure"
  );
  assert.ok(est, "precondition: the estimate is on the state");
  assert.notEqual(est.direction, "support", "precondition: the estimate is not settled");
  const fuel = byKey(todayStones()).fuel;
  // Its voice is always "not settled yet" — never under a calm word, and a data-quality
  // caution is never a reason to eat more.
  assert.equal(fuel.word, TODAY_STONE_WORDS.quiet);
  assert.equal(fuel.tone, "quiet");
  assert.equal(fuel.line, null);
});

test("Body reads the weight trend against the goal, and a stale weigh-in is quiet", () => {
  repo.setProfile({ age: 35, sex: "male", height_cm: 180, weight_lb: 184, goal_weight_lb: 170 });
  seedWeight(localDaysAgo(BODY_STONE_MAX_AGE_DAYS + 10), 184);
  assert.equal(byKey(todayStones()).body.word, "quiet");

  for (const [daysAgo, lb] of [
    [20, 184],
    [15, 183],
    [10, 182],
    [5, 181],
    [1, 180],
  ])
    seedWeight(localDaysAgo(daysAgo), lb);
  const body = byKey(todayStones()).body;
  assert.equal(body.word, TODAY_STONE_WORDS.body.toward);
  assert.equal(body.tone, "ok");
  assert.doesNotMatch(body.line, /\d/, "no number in the line");
});

test("Body read for a past date never fits weigh-ins logged after it", () => {
  repo.setProfile({ age: 35, sex: "male", height_cm: 180, weight_lb: 184, goal_weight_lb: 170 });
  for (const [daysAgo, lb] of [
    [40, 186],
    [36, 185],
    [32, 184],
    [30, 183],
    // After the read date: the scale climbs back.
    [20, 186],
    [10, 188],
    [2, 190],
  ])
    seedWeight(localDaysAgo(daysAgo), lb);
  assert.equal(byKey(todayStones()).body.word, TODAY_STONE_WORDS.body.away, "today the trend drifts");
  assert.equal(byKey(todayStones(localDaysAgo(30))).body.word, TODAY_STONE_WORDS.body.toward, "as of then, on course");
});

test("Heart: a waiting lab finding is worth a look; an in-date panel is steady; none is quiet", () => {
  seedHealthDoc(localDaysAgo(30), [marker("Glucose", 85, { unit: "mg/dL" })]);
  db.prepare(`DELETE FROM health_directives`).run();
  assert.equal(byKey(todayStones()).heart.word, TODAY_STONE_WORDS.heart.steady);

  db.prepare(
    `INSERT INTO health_directives (source, domain, marker, directive, rationale, status)
     VALUES ('markers', 'nutrition', 'LDL-C', 'Lean on fibre.', 'LDL-C sits above the band.', 'active')`
  ).run();
  const heart = byKey(todayStones()).heart;
  assert.equal(heart.word, TODAY_STONE_WORDS.heart.look);
  assert.equal(heart.tone, "watch");
  assert.doesNotMatch(heart.line, /LDL|\d/, "the finding waits on Stand; the stone names no value");
});

test("Endurance reads the race build's own week kind — never a second engine", () => {
  const TODAY = "2026-09-13";
  repo.setProfile({
    age: 40,
    sex: "male",
    primary_discipline: "hybrid",
    endurance_sport: "running",
    endurance_goal: {
      mode: "race",
      event: "Riverside Half",
      date: "2026-11-01",
      distance_km: 21.1,
      target: "sub-2:00",
    },
  });
  const build = raceBuild(TODAY);
  assert.ok(build.available);
  const kind = build.weeks.find((w) => w.current)?.kind;
  assert.ok(kind);
  const endurance = byKey(todayStones(TODAY)).endurance;
  assert.equal(endurance.word, TODAY_STONE_WORDS.endurance[kind]);
  assert.ok(TODAY_STONE_LINES.race[kind].includes(endurance.line));
});

test("Strength: the log is truth — work under way names the stone, printed from the server line", () => {
  seedTrainingDay(localDateISO());
  const strength = byKey(todayStones()).strength;
  assert.equal(strength.word, TODAY_STONE_WORDS.strength.under_way);
  assert.equal(strength.tone, "ok");
  assert.ok(strength.line, "the strength line rides verbatim");
});

test("every authored word and line holds the reading grammar and names no number", () => {
  const words = [TODAY_STONE_WORDS.quiet, ...KEYS.flatMap((k) => Object.values(TODAY_STONE_WORDS[k]))];
  for (const w of words) {
    assert.ok(w.split(/\s+/).length <= 2, w);
    assert.equal(violatesReadingGrammar(w), null, w);
    assert.doesNotMatch(w, LOW, w);
  }
  const lines = Object.values(TODAY_STONE_LINES).flatMap((v) => (Array.isArray(v) ? v : Object.values(v).flat()));
  assert.ok(lines.length > 10);
  for (const line of lines) {
    assert.equal(violatesReadingGrammar(line), null, line);
    assert.doesNotMatch(line, /\d/, line);
  }
});

test("REST and MCP mirror the same read", async () => {
  seedSleep(localDateISO(), 470);
  seedIntake(0, 450, {}, { eatenAt: "08:00" });
  let handler;
  for (const layer of todayRouter.stack) {
    if (layer.route?.path === "/today/stones" && layer.route.methods.get) handler = layer.route.stack.at(-1).handle;
  }
  assert.ok(handler, "GET /today/stones is routed");
  const rest = await new Promise((resolve) => handler({ query: {} }, { json: resolve }));
  const tools = new Map();
  registerDailyDriverTools({ tool: (n, _d, _s, h) => tools.set(n, h) });
  const mcp = JSON.parse((await tools.get("get_today_stones")({})).content[0].text);
  assert.deepEqual(mcp, rest);
  assert.equal(rest.stones.length, 6);
  assertCalm(rest);
});
