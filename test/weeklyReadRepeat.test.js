// Weekly-read repeat detection (src/repo/weekly-read-repeat.ts + weeklyReadVerdict in
// src/coachOps/memory.ts): a weekly read that would say the same as last week says so
// in ONE calm line instead of repeating itself; a changed week, and the first week,
// get the full read. The comparison is structured (headline / one change / milestone
// word sets plus the week's discrete picture), never a sliced string. Offline: the
// verdict is exercised directly, exactly as insightVerdict is (no CLI spawn).
import { test } from "node:test";
import assert from "node:assert/strict";
import { db, repo, localDaysAgo, tsDaysAgo } from "./_seed.js";
import { weeklyReadVerdict } from "../dist/coachOps.js";
import {
  compareWeeklyReads,
  planWeeklyRead,
  previousWeeklyRead,
  storeWeeklyRead,
  weeklyReadContent,
  WEEKLY_READ_REPEAT_THRESHOLD,
} from "../dist/repo/weekly-read-repeat.js";

const LAST_WEEK = {
  found: true,
  text: "A solid week: three lifts landed and the long run held while the cut kept moving.",
  rationale: "Easy days have been drifting hard.",
  next_step: "Keep Thursday's run truly easy.",
};

// Same week, re-told: the model rephrases, the picture and the one change hold.
const SAME_AGAIN = {
  found: true,
  text: "Another solid week — three lifts landed, the long run held, and the cut kept moving.",
  rationale: "Easy days still drift hard.",
  next_step: "Keep Thursday's run truly easy",
};

function backdate(id, days) {
  db.prepare(`UPDATE insights SET created_at = ? WHERE id = ?`).run(tsDaysAgo(days), id);
}

// Store a read the way generateInsight does, as if written `days` ago.
function storeReadDaysAgo(parsed, days) {
  const verdict = weeklyReadVerdict({ parsed, today: localDaysAgo(days) });
  assert.equal(verdict.accept, true, "the seeded read is accepted");
  const row = storeWeeklyRead(verdict.plan, localDaysAgo(days));
  backdate(row.id, days);
  return { row, plan: verdict.plan };
}

test("first week (no read before) → the full read", () => {
  const verdict = weeklyReadVerdict({ parsed: LAST_WEEK });
  assert.equal(verdict.accept, true);
  assert.equal(verdict.plan.mode, "full");
  assert.equal(verdict.plan.reason, "first_week");
  assert.equal(verdict.plan.text, LAST_WEEK.text);
  assert.equal(verdict.plan.next_step, LAST_WEEK.next_step);
  assert.equal(verdict.plan.rationale, LAST_WEEK.rationale);
});

test("the same picture as last week → ONE calm line, no rationale, the one change in its own slot", () => {
  storeReadDaysAgo(LAST_WEEK, 7);
  const verdict = weeklyReadVerdict({ parsed: SAME_AGAIN });
  assert.equal(verdict.accept, true);
  assert.equal(verdict.plan.mode, "repeat");
  const line = verdict.plan.text;
  assert.equal(line, "Same picture as last week.", "one calm line that asserts no action itself");
  assert.equal(verdict.plan.rationale, null);
  assert.equal(verdict.plan.next_step, SAME_AGAIN.next_step, "the one change rides the card's One-change slot");

  // Stored like any weekly read: it waits in-app as the served weekly read (pull,
  // never push) — already `seen`, since "nothing new" is not news to the Brief.
  const row = storeWeeklyRead(verdict.plan);
  const served = repo.listVisibleInsights().find((i) => i.kind === "weekly_read");
  assert.equal(served.id, row.id);
  assert.equal(served.text, line);
  assert.equal(served.next_step, SAME_AGAIN.next_step);
  assert.equal(served.status, "seen");
  assert.equal(served.stale, undefined, "fresh when nothing has moved");
});

test("a repeat read that goes stale no longer states the change anywhere on the served row", () => {
  storeReadDaysAgo(LAST_WEEK, 7);
  const verdict = weeklyReadVerdict({ parsed: SAME_AGAIN });
  assert.equal(verdict.plan.mode, "repeat");
  const row = storeWeeklyRead(verdict.plan);
  // A session logged after the read moves the picture (the freshness signature).
  repo.getOrCreateSession(localDaysAgo(0));
  const served = repo.listVisibleInsights().find((i) => i.kind === "weekly_read");
  assert.equal(served.id, row.id);
  assert.equal(served.stale, true);
  assert.equal(served.next_step, null, "the stale guard takes the change back");
  assert.ok(!/thursday/i.test(served.text), "the line itself never carried the change");
  assert.ok(!/thursday/i.test(served.rationale ?? ""));
});

test("a changed week → the full read, even when the headline echoes last week's", () => {
  storeReadDaysAgo(LAST_WEEK, 7);
  // New one change: a different suggestion is news, not a repeat.
  const moved = weeklyReadVerdict({
    parsed: { ...SAME_AGAIN, next_step: "Add a second strength day on Saturday." },
  });
  assert.equal(moved.accept, true, "the old text guard no longer silences a changed week");
  assert.equal(moved.plan.mode, "full");
  assert.equal(moved.plan.reason, "changed");
  assert.equal(moved.plan.next_step, "Add a second strength day on Saturday.");

  // A different week told differently.
  const different = weeklyReadVerdict({
    parsed: {
      found: true,
      text: "A lighter week with a trip in the middle — rest was the right call.",
      next_step: null,
    },
  });
  assert.equal(different.plan.mode, "full");
  assert.equal(different.plan.reason, "changed");
});

test("the picture moving (a new trip logged) is never 'the same picture', whatever the prose says", () => {
  storeReadDaysAgo(LAST_WEEK, 7);
  db.prepare(`INSERT INTO context_events (kind, title, start_date, archived) VALUES ('trip', 'Work trip', ?, 0)`).run(
    localDaysAgo(1)
  );
  const verdict = weeklyReadVerdict({ parsed: SAME_AGAIN });
  assert.equal(verdict.plan.mode, "full");
  assert.equal(verdict.plan.reason, "changed");
});

test("a one-tap day chip or the rest trade's claimed day keeps the same picture; a trip still breaks it", () => {
  storeReadDaysAgo(LAST_WEEK, 7);
  repo.toggleContextTag("alcohol", localDaysAgo(2));
  db.prepare(
    `INSERT INTO context_events (kind, title, start_date, end_date, meta_json, archived) VALUES ('life_event', 'Rest day — traded', ?, ?, ?, 0)`
  ).run(localDaysAgo(1), localDaysAgo(1), JSON.stringify({ claims_day: true, rest_trade: true }));
  const verdict = weeklyReadVerdict({ parsed: SAME_AGAIN });
  assert.equal(verdict.plan.mode, "repeat", "routine chips are not a new picture");

  db.prepare(`INSERT INTO context_events (kind, title, start_date, archived) VALUES ('trip', 'Work trip', ?, 0)`).run(
    localDaysAgo(1)
  );
  const moved = weeklyReadVerdict({ parsed: SAME_AGAIN });
  assert.equal(moved.plan.mode, "full");
  assert.equal(moved.plan.reason, "changed");
});

test("many re-reads of one week never lose last week's basis", () => {
  storeReadDaysAgo(LAST_WEEK, 7);
  // Far more same-week re-reads than any row or ledger bound (planned directly: the
  // word guard would silence near-identical re-reads, and it is not under test here).
  for (let i = 0; i < 25; i++) {
    storeWeeklyRead(planWeeklyRead({ text: `A different week, take ${i}: a trip and two rest days.` }));
  }
  const prev = previousWeeklyRead();
  assert.ok(prev, "last week's read is still found");
  assert.ok(prev.picture, "with its recorded picture, not a column fallback");
  assert.equal(weeklyReadVerdict({ parsed: SAME_AGAIN }).plan.mode, "repeat");
});

test("a read older than last week (a gap) → the full read", () => {
  storeReadDaysAgo(LAST_WEEK, 20);
  assert.equal(previousWeeklyRead(), null);
  const verdict = weeklyReadVerdict({ parsed: SAME_AGAIN });
  assert.equal(verdict.plan.mode, "full");
  assert.equal(verdict.plan.reason, "first_week");
});

test("an earlier read THIS week is not 'last week'", () => {
  const row = repo.addInsight({ kind: "weekly_read", text: LAST_WEEK.text, next_step: LAST_WEEK.next_step });
  assert.ok(row);
  assert.equal(previousWeeklyRead(), null);
});

test("a run of same weeks stays one line each, compared with the words last actually said", () => {
  storeReadDaysAgo(LAST_WEEK, 14);
  const second = storeReadDaysAgo(SAME_AGAIN, 7);
  assert.equal(second.plan.mode, "repeat");
  const third = weeklyReadVerdict({ parsed: SAME_AGAIN });
  assert.equal(third.accept, true, "the second one-liner is not silenced as a text repeat of the first");
  assert.equal(third.plan.mode, "repeat");
  assert.equal(third.plan.repeat_of, second.row.id);
});

test("a legacy weekly read (written before the ledger) is compared from its own columns", () => {
  const legacy = repo.addInsight({ kind: "weekly_read", text: LAST_WEEK.text, next_step: LAST_WEEK.next_step });
  backdate(legacy.id, 7);
  const verdict = weeklyReadVerdict({ parsed: SAME_AGAIN });
  assert.equal(verdict.plan.mode, "repeat");
});

test("a read the athlete waved off last week is never carried forward as the same picture", () => {
  const { row } = storeReadDaysAgo(LAST_WEEK, 7);
  repo.updateInsight(row.id, { feedback: "down" });
  const verdict = weeklyReadVerdict({ parsed: SAME_AGAIN });
  assert.deepEqual(verdict, { accept: false, agent_ran: true }, "the downvote-aware text guard answers instead");
});

test("the milestone step is carried in the One-change slot when there is no next_step", () => {
  const withMilestone = {
    found: true,
    text: "A steady week: runs on their days and lifts held.",
    next_step: null,
    milestone_step: { milestone: "the half-marathon build", step: "one longer easy run" },
  };
  storeReadDaysAgo(withMilestone, 7);
  const verdict = weeklyReadVerdict({
    parsed: { ...withMilestone, text: "Another steady week — runs on their days, lifts held." },
  });
  assert.equal(verdict.plan.mode, "repeat");
  assert.equal(verdict.plan.text, "Same picture as last week.");
  assert.equal(verdict.plan.next_step, "Toward the half-marathon build: one longer easy run");
});

test("nothing to change either week → 'nothing new worth changing'", () => {
  const quiet = { found: true, text: "A calm, steady week — nothing needs changing.", next_step: null };
  storeReadDaysAgo(quiet, 7);
  const verdict = weeklyReadVerdict({
    parsed: { ...quiet, text: "Another calm, steady week; nothing needs changing." },
  });
  assert.equal(verdict.plan.text, "Same picture as last week — nothing new worth changing.");
  assert.equal(verdict.plan.next_step, null);
});

test("silence stays silence: found:false and an unusable payload are not reads", () => {
  assert.deepEqual(weeklyReadVerdict({ parsed: { found: false } }), { accept: false, agent_ran: true });
  assert.deepEqual(weeklyReadVerdict({ parsed: null }), { accept: false, agent_ran: false });
  assert.equal(planWeeklyRead({ text: "  " }), null);
});

test("the comparison is structured and thresholded per slot", () => {
  const picture = { directive_keys: [], latest_doc_date: null, latest_context_event_id: null };
  const a = weeklyReadContent(LAST_WEEK);
  assert.ok(a.headline.includes("lifts") && !a.headline.includes("the"), "stopword-trimmed word set");
  assert.deepEqual(compareWeeklyReads({ content: a, picture }, { content: weeklyReadContent(SAME_AGAIN), picture }), {
    repeat: true,
    changed: [],
  });
  // One side with a change and the other without is a change.
  const noMove = weeklyReadContent({ ...SAME_AGAIN, next_step: null });
  assert.deepEqual(compareWeeklyReads({ content: a, picture }, { content: noMove, picture }).changed, ["move"]);
  // No recorded picture for last week → content alone decides.
  assert.equal(
    compareWeeklyReads({ content: a, picture: null }, { content: weeklyReadContent(SAME_AGAIN), picture }).repeat,
    true
  );
  assert.equal(WEEKLY_READ_REPEAT_THRESHOLD, 0.5);
});
