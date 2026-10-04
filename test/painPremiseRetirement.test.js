import { test } from "node:test";
import assert from "node:assert/strict";
import { adoptOrphanedDrafts, applyProposalWithAutonomy } from "../dist/domain/brain/autonomy-service.js";
import { recentlySettledPlaces, settledPainPlaceReader } from "../dist/repo/injury-symptom-link.js";
import { memoryForCoach, memoryPainHistory } from "../dist/repo/memory.js";
import { recurTrainingSymptom } from "../dist/repo/training-symptoms.js";
import { db, localDaysAgo, repo } from "./_seed.js";

// The live shape (2026-10-02): a right-flank pain from a Pallof press, reported Sep 25 and
// resolved Sep 28, filed three ways — a training symptom ("below right lateral"), an
// injury context event the symptom tie closes, and a chat memory that was never
// superseded. A monthly conference read the memory as current on Oct 2 and capped the
// Pallof press "to protect the healing right lateral flank"; two older weekly-review
// drafts from Sep 28 still waited beside it. Dates here are relative to today so the
// fixture keeps that shape whatever day the suite runs.
const ONSET = localDaysAgo(7);
const RESOLVED = localDaysAgo(4);
const TODAY = localDaysAgo(0);

function seedSettledFlank() {
  const symptom = Number(
    db
      .prepare(
        `INSERT INTO training_symptom_events
           (source_kind, area_text, status, scope, onset_on, last_reported_on, resolved_on, legacy_unconfirmed)
         VALUES ('chat', 'below right lateral', 'resolved', 'area', ?, ?, ?, 0)`
      )
      .run(ONSET, ONSET, RESOLVED).lastInsertRowid
  );
  db.prepare(
    `INSERT INTO context_events (kind, title, detail, start_date, resolved_at)
     VALUES ('injury', 'Right lateral / oblique discomfort', 'Pallof press', ?, NULL)`
  ).run(ONSET);
  return symptom;
}

function seedFlankMemory() {
  const row = repo.addMemory(
    "Experienced acute right lateral flank or ribcage pain triggered by a Pallof press, aggravated by deep breathing, bending, and transitional movements.",
    "injury",
    "chat-distill"
  );
  db.prepare(`UPDATE memory SET created_at = ? WHERE id = ?`).run(`${ONSET} 17:30:16`, row.id);
  return row.id;
}

function backdate(id, iso) {
  db.prepare("UPDATE plan_proposals SET created_at = ? WHERE id = ?").run(iso, Number(id));
}

function hoursAgoIso(hours) {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

function seedLowerPlan() {
  repo.savePlanDay(3, "Lower A", "Legs", [
    { exercise: "Back Squat", sets: 3, rep_low: 5, rep_high: 7, target_weight: 185 },
    { exercise: "Leg Extension", sets: 2, rep_low: 12, rep_high: 15, target_weight: 135 },
  ]);
  repo.savePlanDay(5, "Lower B", "Legs", [
    { exercise: "Barbell Deadlift", sets: 3, rep_low: 5, rep_high: 6, target_weight: 225 },
    { exercise: "Pallof Press", sets: 2, rep_low: 12, rep_high: 12, target_weight: 50 },
  ]);
}

const WEEKLY =
  "case conference: Weekly team review for the week starting tomorrow. Each specialist: the ONE next step.";
const MONTHLY = "case conference: Standing monthly whole-person review. Reconcile the next bounded revision.";

// Proposal 154/155's shape: a squat re-entry plus a Pallof removal, held on the
// clinician floor.
function weeklyReviewDraft() {
  return repo.createProposal("case_conference", WEEKLY, "", {
    summary: "Re-enter Back Squat behind a brace gate; remove Pallof Press while the right oblique settles.",
    rationale: "Muscle leads the block.",
    changes: [
      {
        day_number: 3,
        exercise: "Back Squat",
        target_weight: 185,
        sets: 3,
        rep_low: 5,
        rep_high: 7,
        reason: "Untested prescription must be trained once before it can progress.",
        note: "Any pull or pain at the right flank at any warm-up ends the squat for the day.",
      },
      {
        day_number: 5,
        exercise: "Pallof Press",
        remove: true,
        reason: "Triggered the right lateral/oblique irritation; stays out until the flank is pain-free for 48 hours.",
      },
    ],
  });
}

// Proposal 160's shape: one protective cap, held at the (bogus) safety floor.
function monthlyFlankCapDraft() {
  return repo.createProposal("case_conference", MONTHLY, "", {
    summary: "Cap Day 5 Pallof Press at 42.5 lb to protect healing right lateral flank.",
    rationale: "Protect the flank.",
    changes: [
      {
        day_number: 5,
        exercise: "Pallof Press",
        mode: "reps",
        sets: 2,
        rep_low: 12,
        rep_high: 12,
        target_weight: 42.5,
        reason:
          "Cap anti-rotation load at tolerated 42.5 lb rather than auto-progressed 50 lb to avoid shear stress on healing right lateral flank strain.",
      },
    ],
  });
}

function receiptFor(proposalId) {
  return repo
    .listBrainDecisions({ status: "superseded", limit: 100 })
    .find((d) => d.context?.thaw_receipt === true && d.source_ref_key === String(proposalId));
}

// ---- 1. a pain memory follows its symptom --------------------------------------

test("a pain memory reads as history once its same-place symptom has resolved", () => {
  seedSettledFlank();
  const id = seedFlankMemory();
  const row = memoryForCoach(40).find((m) => m.id === id);
  assert.ok(row, "still surfaced — history is context, not deleted");
  assert.match(row.content, /\[History, not current: the right flank settled on \d{4}-\d{2}-\d{2}\.\]$/);
  assert.equal(row.pain_history.resolved_on, RESOLVED);
  // Read-side only: the stored row is untouched.
  assert.doesNotMatch(repo.getMemory(id).content, /History/);
  assert.equal(repo.getMemory(id).superseded_by, null);
});

test("a recurrence makes the pain memory current again", () => {
  const symptom = seedSettledFlank();
  const id = seedFlankMemory();
  assert.ok(memoryPainHistory([repo.getMemory(id)])[0].pain_history, "settled before it comes back");
  recurTrainingSymptom(symptom, { on: TODAY });
  const row = memoryForCoach(40).find((m) => m.id === id);
  assert.equal(row.pain_history, undefined, "a returned pain is never hidden as history");
  assert.doesNotMatch(row.content, /History/);
});

test("an open symptom at the same place keeps the memory current, whatever else resolved", () => {
  seedSettledFlank();
  const id = seedFlankMemory();
  repo.reportTrainingSymptom({ area_text: "right flank", onset_on: TODAY });
  assert.equal(memoryPainHistory([repo.getMemory(id)])[0].pain_history, undefined);
});

test("the matcher stays narrow: another side, another place, a later recap and a learning stay current", () => {
  seedSettledFlank();
  const left = repo.addMemory("Left flank pain after side planks.", "injury", "chat");
  const knee = repo.addMemory("Right knee pain on deep lunges.", "injury", "chat");
  const recap = repo.addMemory("Right flank pain from the Pallof press is fully gone.", "observation", "chat");
  const learning = repo.addMemory("Right flank pain tends to settle within a few days.", "learning", "chat");
  for (const id of [left.id, knee.id, learning.id]) {
    db.prepare(`UPDATE memory SET created_at = ? WHERE id = ?`).run(`${ONSET} 12:00:00`, id);
  }
  // Written two days AFTER the resolution: a recap, not the episode.
  db.prepare(`UPDATE memory SET created_at = ? WHERE id = ?`).run(`${localDaysAgo(2)} 12:00:00`, recap.id);
  const rows = memoryPainHistory([left, knee, recap, learning].map((m) => repo.getMemory(m.id)));
  assert.deepEqual(
    rows.map((m) => m.pain_history ?? null),
    [null, null, null, null]
  );
});

test("a structural injury is never settled by a soreness symptom", () => {
  seedSettledFlank();
  const settled = settledPainPlaceReader(TODAY);
  assert.equal(settled("Torn right lateral flank muscle, painful on breathing.", ONSET), null);
  assert.ok(settled("Right lateral flank pain on breathing.", ONSET));
});

test("recently settled places list the resolved flank, and drop it once it is open again", () => {
  const symptom = seedSettledFlank();
  const settled = recentlySettledPlaces(TODAY);
  assert.equal(settled.length, 1);
  assert.equal(settled[0].resolved_on, RESOLVED);
  recurTrainingSymptom(symptom, { on: TODAY });
  assert.deepEqual(recentlySettledPlaces(TODAY), []);
});

// ---- 3. drafts retire on a dead premise ----------------------------------------

test("the live three: a settled-pain cap and two older weekly reviews all retire, with readable receipts", () => {
  repo.setSettings({ lead_mode: "lead" });
  seedLowerPlan();
  seedSettledFlank();
  seedFlankMemory();
  const p154 = weeklyReviewDraft();
  const p155 = weeklyReviewDraft();
  const p160 = monthlyFlankCapDraft();
  for (const proposal of [p154, p155]) {
    const held = applyProposalWithAutonomy(proposal.id, { clinical: true });
    assert.equal(held.tier, "clinician");
  }
  const capHold = applyProposalWithAutonomy(p160.id, { requested_tier: "announce", clamp_refused: true });
  assert.equal(capHold.review_reason_code, "safety_floor");
  // Two of them were written four days ago; the cap three hours ago (past the grace).
  backdate(p154.id, new Date(Date.now() - 4 * 86_400_000 - 3_600_000).toISOString());
  backdate(p155.id, new Date(Date.now() - 4 * 86_400_000).toISOString());
  backdate(p160.id, hoursAgoIso(3));

  const sweep = adoptOrphanedDrafts();
  assert.equal(sweep.retired, 3);
  for (const proposal of [p154, p155, p160]) {
    assert.equal(repo.getProposal(proposal.id).status, "superseded", `proposal ${proposal.id} retired`);
  }
  assert.deepEqual(repo.awaitingBrainDecisions(), [], "nothing is left waiting on the athlete");

  const cap = receiptFor(p160.id);
  assert.equal(cap.context.review_reason_code, "premise_gone");
  assert.equal(cap.action.outcome, "superseded_pain_settled");
  assert.match(
    cap.rationale,
    /^Your right flank settled on [A-Z][a-z]{2} \d{1,2}, so this protective change has nothing left to protect\./
  );
  const capHoldAfter = repo.getBrainDecision(capHold.decision.id);
  assert.equal(capHoldAfter.status, "superseded");
  assert.equal(capHoldAfter.context.retire_reason, "premise_gone");

  for (const proposal of [p154, p155]) {
    const receipt = receiptFor(proposal.id);
    assert.equal(receipt.context.review_reason_code, "source_superseded");
    assert.equal(receipt.action.outcome, "superseded_by_newer_review");
    assert.match(receipt.rationale, /^A newer team review replaced this one\./);
  }
});

test("a protective cap stays while the place is still open", () => {
  repo.setSettings({ lead_mode: "lead" });
  seedLowerPlan();
  const symptom = seedSettledFlank();
  recurTrainingSymptom(symptom, { on: localDaysAgo(1) });
  const cap = monthlyFlankCapDraft();
  applyProposalWithAutonomy(cap.id, { requested_tier: "announce", clamp_refused: true });
  backdate(cap.id, hoursAgoIso(3));
  assert.equal(adoptOrphanedDrafts().retired, 0);
  assert.equal(repo.getProposal(cap.id).status, "draft");
});

test("a mixed draft is not retired by a settled pain — only a draft whose every change protects it", () => {
  repo.setSettings({ lead_mode: "lead" });
  seedLowerPlan();
  seedSettledFlank();
  const mixed = repo.createProposal("case_conference", MONTHLY, "", {
    summary: "Cap the Pallof press and add a deadlift step.",
    changes: [
      {
        day_number: 5,
        exercise: "Pallof Press",
        target_weight: 42.5,
        reason: "Protect the healing right lateral flank.",
      },
      { day_number: 5, exercise: "Barbell Deadlift", target_weight: 230, reason: "Earned the step at RIR 2." },
    ],
  });
  applyProposalWithAutonomy(mixed.id, { requested_tier: "announce", clamp_refused: true });
  backdate(mixed.id, hoursAgoIso(3));
  assert.equal(adoptOrphanedDrafts().retired, 0);
  assert.equal(repo.getProposal(mixed.id).status, "draft");
});

test("a weekly review whose week has passed retires; one still inside its week stays", () => {
  repo.setSettings({ lead_mode: "lead" });
  seedLowerPlan();
  const progressDraft = () =>
    repo.createProposal("case_conference", WEEKLY, "", {
      summary: "Step the squat.",
      changes: [{ day_number: 3, exercise: "Back Squat", target_weight: 190, reason: "Earned the step." }],
    });
  const current = progressDraft();
  applyProposalWithAutonomy(current.id, { requested_tier: "ask", clamp_refused: true });
  backdate(current.id, new Date(Date.now() - 3 * 86_400_000).toISOString());
  assert.equal(adoptOrphanedDrafts().retired, 0, "its week is still running");
  assert.equal(repo.getProposal(current.id).status, "draft");

  backdate(current.id, new Date(Date.now() - 9 * 86_400_000).toISOString());
  assert.equal(adoptOrphanedDrafts().retired, 1);
  const receipt = receiptFor(current.id);
  assert.equal(receipt.action.outcome, "superseded_week_passed");
  assert.match(receipt.rationale, /week this review was written for has passed/);
});

test("a newer review over a DIFFERENT scope leaves the older one alone", () => {
  repo.setSettings({ lead_mode: "lead" });
  seedLowerPlan();
  const training = repo.createProposal("case_conference", MONTHLY, "", {
    summary: "Step the squat.",
    changes: [{ day_number: 3, exercise: "Back Squat", target_weight: 190, reason: "Earned the step." }],
  });
  applyProposalWithAutonomy(training.id, { requested_tier: "ask", clamp_refused: true });
  backdate(training.id, hoursAgoIso(5));
  repo.createProposal("case_conference", MONTHLY, "", {
    kind: "nutrition_target",
    summary: "Hold intake.",
    nutrition: { target_kcal: 2000, protein_g: 175 },
  });
  assert.equal(adoptOrphanedDrafts().retired, 0);
  assert.equal(repo.getProposal(training.id).status, "draft");
});
