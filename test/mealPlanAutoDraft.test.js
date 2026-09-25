// settings.meal_plan_auto_draft — meal plans are ideation, drafted when asked.
//
// The switch (default OFF) governs every AUTOMATIC meal-plan draft: the scheduler's
// weekly slot and the owned protective reshape channel that the fuel loop, a landed
// nutrition target and a new nutrition directive write into. Explicit drafts (chat,
// REST/MCP, the PWA button) never pass through it. Offline — no agent CLIs.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { db, repo, tsDaysAgo, localDaysAgo } from "./_seed.js";
import { addDaysISO, localDateISO } from "../dist/repo/shared.js";
import {
  retireMealRefreshWhileOff,
  runScheduledMealPlanDraft,
  scheduledMealPlanDue,
  weeklySlotStamp,
} from "../dist/scheduler.js";
import { operatorRouter } from "../dist/routes/operator.js";
import { draftMealPlan } from "../dist/coachOps.js";
import { runUnderfuelingControlLoop } from "../dist/domain/brain/underfueling-service.js";
import { applyDueAnnouncedDecisions, applyProposalWithAutonomy } from "../dist/domain/brain/autonomy-service.js";

const REQUEST = "meal_plan_refresh_requested";
const INSTRUCTION = "meal_plan_refresh_instruction";
const ATTEMPT = "meal_plan_refresh_attempt_state";
const SLOT = "meal_plan_refresh_last_slot";

function fakeDraft() {
  const calls = [];
  const draft = async (...args) => {
    calls.push(args);
    return { ok: true, id: 1 };
  };
  return { calls, draft };
}

function parkRequest(request = localDateISO()) {
  repo.setAppState(REQUEST, request);
  repo.setAppState(INSTRUCTION, "reshape the week without changing the target");
  repo.setAppState(
    ATTEMPT,
    JSON.stringify({ request, count: 2, next_attempt_at: new Date(Date.now() + 3_600_000).toISOString() })
  );
  return request;
}

const pending = () => [REQUEST, INSTRUCTION, ATTEMPT].map((key) => repo.getAppState(key) ?? "");

let server = null;
after(() => server?.close());

async function settingsApi(method, body) {
  if (!server) {
    const app = express();
    app.use(express.json());
    app.use("/api", operatorRouter);
    server = await new Promise((resolve, reject) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
      s.on("error", reject);
    });
  }
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/settings`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal(res.status, 200);
  return (await res.json()).settings;
}

test("the switch round-trips through PUT/GET /api/settings", async () => {
  assert.equal((await settingsApi("GET")).meal_plan_auto_draft, false);
  assert.equal((await settingsApi("PUT", { meal_plan_auto_draft: true })).meal_plan_auto_draft, true);
  assert.equal((await settingsApi("GET")).meal_plan_auto_draft, true);
  assert.equal((await settingsApi("PUT", { meal_plan_auto_draft: false })).meal_plan_auto_draft, false);
  assert.equal((await settingsApi("GET")).meal_plan_auto_draft, false);
});

test("automatic meal plans are off by default and the switch persists", () => {
  assert.equal(repo.getSettings().meal_plan_auto_draft, false, "a fresh install drafts meal plans on request only");
  assert.equal(repo.setSettings({ meal_plan_auto_draft: true }).meal_plan_auto_draft, true);
  assert.equal(repo.getSettings().meal_plan_auto_draft, true);
  assert.equal(repo.setSettings({ lead_mode: "lead" }).meal_plan_auto_draft, true, "an unrelated save keeps it");
  assert.equal(repo.setSettings({ meal_plan_auto_draft: false }).meal_plan_auto_draft, false);
});

test("off: the scheduler finds nothing due and retires a parked request instead of retrying it", () => {
  const s = repo.getSettings();
  const now = new Date();
  const request = parkRequest();

  const work = scheduledMealPlanDue(now, s);
  assert.deepEqual(work, { enabled: false, request: null, refreshDue: false, due: false });
  assert.equal(repo.getAppState(REQUEST), request, "the due check is a pure read; it retires nothing");

  assert.equal(retireMealRefreshWhileOff(s), true);
  assert.deepEqual(pending(), ["", "", ""], "request, instruction and retry state are cleared together");
  const slot = weeklySlotStamp(now, s.coach_day, s.coach_hour);
  assert.equal(repo.getSchedulerOperation(SLOT, slot), null, "an off tick opens no operation for this week's slot");
  assert.equal(repo.getAppState(SLOT) ?? "", "", "nor acknowledges it");
  // The next idle minute is a calm no-op, not a second clear.
  assert.equal(retireMealRefreshWhileOff(s), false);
  assert.equal(scheduledMealPlanDue(now, s).due, false);
});

test("off: a successful reshape's leftover retry history is not a parked request", () => {
  const history = JSON.stringify({
    request: "2026-01-01",
    count: 1,
    next_attempt_at: null,
    in_flight_until: null,
    last_error: null,
  });
  repo.setAppState(ATTEMPT, history);
  assert.equal(retireMealRefreshWhileOff(repo.getSettings()), false, "nothing parked, nothing retired or logged");
  assert.equal(repo.getAppState(ATTEMPT), history);
});

test("on: the retire step leaves a parked request for the owner", () => {
  repo.setSettings({ meal_plan_auto_draft: true });
  const request = parkRequest();
  assert.equal(retireMealRefreshWhileOff(repo.getSettings()), false);
  assert.equal(repo.getAppState(REQUEST), request);
});

test("off: the scheduler never calls the meal-plan draft", async () => {
  const s = repo.getSettings();
  const { calls, draft } = fakeDraft();
  const work = scheduledMealPlanDue(new Date(), s);
  const run = await runScheduledMealPlanDraft(new Date(), s, work, {
    instruction: "x",
    nutritionChanged: false,
    draft,
  });
  assert.equal(run.drafted, false);
  assert.equal(calls.length, 0);
});

test("switched off mid-tick: work computed while on still does not draft", async () => {
  repo.setSettings({ meal_plan_auto_draft: true });
  const now = new Date();
  const work = scheduledMealPlanDue(now, repo.getSettings());
  assert.equal(work.due, true);

  repo.setSettings({ meal_plan_auto_draft: false }); // e.g. during the nutrition check-in await
  parkRequest();
  const { calls, draft } = fakeDraft();
  const run = await runScheduledMealPlanDraft(now, repo.getSettings(), work, {
    instruction: "x",
    nutritionChanged: false,
    draft,
  });
  assert.equal(run.drafted, false);
  assert.equal(calls.length, 0);
  assert.deepEqual(pending(), ["", "", ""]);
});

test("on: the weekly slot drafts once, then the slot is acknowledged", async () => {
  repo.setSettings({ meal_plan_auto_draft: true });
  const s = repo.getSettings();
  const now = new Date();
  const work = scheduledMealPlanDue(now, s);
  assert.equal(work.enabled, true);
  assert.equal(work.refreshDue, false);
  assert.equal(work.due, true, "this week's slot has not run yet");

  const { calls, draft } = fakeDraft();
  const run = await runScheduledMealPlanDraft(now, s, work, {
    instruction: "Refresh the upcoming week",
    nutritionChanged: true,
    draft,
  });
  assert.deepEqual(run, { drafted: true, ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "auto");
  assert.equal(calls[0][1], "Refresh the upcoming week");
  assert.deepEqual(calls[0][3], { coordinated_update: true });

  assert.equal(scheduledMealPlanDue(now, s).due, false, "the same slot never drafts twice");
});

test("on: an owned protective request drafts as a coordinated update and clears on success", async () => {
  repo.setSettings({ meal_plan_auto_draft: true });
  const s = repo.getSettings();
  const now = new Date();
  const request = localDateISO();
  repo.setAppState(REQUEST, request);
  repo.setAppState(INSTRUCTION, "carb-forward reshape");

  const work = scheduledMealPlanDue(now, s);
  assert.equal(work.request, request);
  assert.equal(work.refreshDue, true);
  assert.equal(work.due, true);

  const { calls, draft } = fakeDraft();
  const run = await runScheduledMealPlanDraft(now, s, work, {
    instruction: "carb-forward reshape",
    nutritionChanged: false,
    draft,
  });
  assert.deepEqual(run, { drafted: true, ok: true });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][3], { coordinated_update: true });
  assert.equal(repo.getAppState(REQUEST), "", "the fulfilled request is released");
  assert.equal(scheduledMealPlanDue(now, s).due, false, "the reshape also covers this week's slot");
});

test("off: an explicit draft still reaches the agent", async () => {
  assert.equal(repo.getSettings().meal_plan_auto_draft, false);
  // The offline stub answers outside the meal-plan contract, so the draft fails —
  // but it fails AT THE AGENT, which proves the switch never intercepts a request.
  const result = await draftMealPlan("stub", "explicit ask while automatic plans are off");
  assert.equal(result.tried.length, 1);
  assert.equal(result.tried[0].agent, "stub");
  assert.doesNotMatch(String(result.error ?? ""), /auto/i);
});

test("off: a new nutrition directive does not queue a meal refresh", () => {
  db.prepare(`INSERT INTO meal_plans (created_at, status, parsed_json) VALUES (?, 'accepted', ?)`).run(
    tsDaysAgo(3),
    JSON.stringify({ source_ts: localDaysAgo(3), days: [] })
  );
  db.prepare(
    `INSERT INTO health_directives (created_at, source, domain, marker, directive, directive_key, status)
     VALUES (?, 'markers', 'nutrition', 'ApoB', 'Cut saturated fat; add soluble fiber.', 'apob:nutrition:lever', 'active')`
  ).run(tsDaysAgo(0));

  assert.equal(repo.maybeRequestMealRefreshForDirectives({ agentsAvailable: true }), false);
  assert.equal(repo.getAppState(REQUEST) ?? "", "");
  assert.equal(repo.getAppState("meal_directive_refresh_sig") ?? "", "", "no signature is burned while off");

  repo.setSettings({ meal_plan_auto_draft: true });
  assert.equal(repo.maybeRequestMealRefreshForDirectives({ agentsAvailable: true }), true, "on, the same set fires");
});

test("off: an execution gap holds calories without queueing a meal reshape or a cooldown", () => {
  repo.setSettings({ lead_mode: "lead", proactive_enabled: true });
  const today = localDateISO();
  const read = {
    as_of: today,
    state: "execution_gap",
    confidence: "medium",
    window: { since: addDaysISO(today, -14), through: addDaysISO(today, -1), calendar_days: 14 },
    uncertainty: {
      deadband_kcal: 225,
      deadband_basis: "test",
      missing_food_days: 0,
      partial_food_days: 0,
      note: "estimates",
    },
    intake: {
      observed_days: 10,
      credible_days: 10,
      compared_days: 10,
      materially_below_days: 5,
      near_target_days: 0,
      average_gap_kcal: -400,
      current_target_kcal: 2200,
      maintenance_estimate_kcal: 2600,
    },
    correction: {
      target_id: 1,
      effective_date: addDaysISO(today, -30),
      age_days: 30,
      upward_delta_kcal: null,
      settling: false,
    },
    channels: [],
    agreeing_channels: ["weight_trend", "performance", "recovery"],
    conflicting_channels: [],
    rationale: "Several independent completed-day outcome channels agree.",
    action: {
      kind: "reshape_meals",
      kcal_delta: 0,
      training: "hold_aggression",
      line: "Make the existing target easier to complete.",
    },
    evidence_keys: ["test:underfueling"],
    signature: "execution_gap",
  };

  const result = runUnderfuelingControlLoop(today, { read });
  assert.equal(result.action, "none");
  assert.deepEqual(pending(), ["", "", ""]);
  assert.equal(repo.getAppState("underfuel_execution_last_action"), null, "no cooldown, so turning it on acts at once");

  repo.setSettings({ meal_plan_auto_draft: true });
  assert.equal(runUnderfuelingControlLoop(today, { read }).action, "meal_reshape_queued");
});

test("off: a landed nutrition target does not hand off a meal realignment", () => {
  repo.setSettings({ lead_mode: "lead" });
  const proposal = repo.createProposal("stub", "weekly nutrition response", "", {
    kind: "nutrition_target",
    summary: "Small measured intake adjustment",
    nutrition: { target_kcal: 2_250, protein_g: 170, reason: "The measured trend missed its expected band." },
  });
  const scheduled = applyProposalWithAutonomy(proposal.id, { requested_tier: "quiet_apply" });
  const due = applyDueAnnouncedDecisions(scheduled.effective_date);
  assert.deepEqual(due.applied, [scheduled.decision.id], "the target itself still lands");
  assert.equal(repo.getProposal(proposal.id).status, "applied");
  assert.equal(repo.getAppState(REQUEST) ?? "", "", "no meal plan will be drafted unasked");
});
