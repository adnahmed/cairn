// Visit questions and "evidence the team would like" (v2 wave 3).
//   - each doctor-loop follow-up proposes ONE question (the loop is already collapsed
//     per panel), plus any clinical ask the team holds for a doctor, printed as written
//   - the evidence read is at most ONE calm line, or null — pull, never push
// Every fixture is synthetic: invented names, dates and values.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { localDaysAgo, marker, repo, resetTables, seedHealthDoc } from "./_seed.js";
import {
  visitQuestionsRead,
  resolveVisitQuestions,
  parseVisitQuestionList,
} from "../dist/domain/health/visit-questions.js";
import { evidenceWantedRead } from "../dist/domain/health/evidence-wanted.js";
import { registerConnectedBrainTools } from "../dist/surfaces/mcp/connected-brain.js";

beforeEach(() => {
  resetTables(
    "health_documents",
    "health_directives",
    "health_reviews",
    "attention_schedule",
    "profile",
    "brain_decisions",
    "bodyweight_log"
  );
});

function seedLipidFollowUp() {
  seedHealthDoc("2026-01-01", [
    marker("ApoB", 125, { unit: "mg/dL", flag: "high" }),
    marker("LDL-C", 160, { unit: "mg/dL", flag: "high" }),
  ]);
  repo.refreshDoctorLoopAttention();
}

function seedClinicalAsk(text) {
  return repo.recordDecision({
    effective_date: localDaysAgo(1),
    kind: "lifestyle_adjustment",
    domain: "health",
    summary: "Synthetic clinical hold",
    rationale: "Synthetic rationale.",
    source: "test",
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

test("each doctor-loop follow-up appears once, worded as a calm question", () => {
  seedLipidFollowUp();
  const read = visitQuestionsRead({ asOf: "2026-05-01" });
  const loop = read.questions.filter((q) => q.source === "doctor_loop");
  const ids = loop.map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length, "no follow-up is asked twice");
  const lipids = loop.filter((q) => q.id === "loop:panel:lipids");
  assert.equal(lipids.length, 1, "ApoB and LDL-C share one lipid-panel question");
  assert.match(lipids[0].text, /^Is it time to recheck .+\?$/);
  const texts = read.questions.map((q) => q.text.toLowerCase());
  assert.equal(new Set(texts).size, texts.length, "no question text repeats");
  assert.match(read.frame, /not medical advice/i);
  for (const q of read.questions)
    assert.doesNotMatch(q.text, /\bmust\b|\b\d{1,3}\s*\/\s*100\b/i, "no gate words, no scores");
  // The basis is read by the athlete: the loop's machine status clause, which merges the
  // lab flag and the optimal band into one "optimal/lab range", never reaches it. It
  // says which fact holds — here both, as two separate sentences — then the policy.
  assert.ok(lipids[0].basis, "the follow-up carries its plain reason");
  for (const q of loop) assert.doesNotMatch(q.basis ?? "", /optimal\/lab|follow-up lever|off optimal or|active lever/i);
  const [labFact, optimalFact] = lipids[0].basis.split(". ");
  assert.match(labFact, /\blab\b.*\bhigh\b|\bhigh\b.*\blab\b/i, "the lab's own flag, as its own sentence");
  assert.doesNotMatch(labFact, /optimal/i, "the lab's fact never mentions the optimal band");
  assert.match(optimalFact, /above its optimal range/, "the optimal band, as its own sentence");
  assert.match(lipids[0].basis, /Lipids take about three months/, "then the plain policy sentence");
});

test("loop questions speak marker names as plain words, keeping analyte casing", () => {
  seedHealthDoc("2026-01-01", [
    marker("Hemoglobin", 12.1, { unit: "g/dL", flag: "low" }),
    marker("Ferritin", 12, { unit: "ng/mL", flag: "low" }),
    marker("hs-CRP", 3.4, { unit: "mg/L", flag: "high" }),
  ]);
  repo.refreshDoctorLoopAttention();
  const texts = visitQuestionsRead({ asOf: "2026-05-01" }).questions.map((q) => q.text);
  const iron = texts.find((t) => /hemoglobin|ferritin/i.test(t));
  assert.match(
    iron ?? "",
    /^Is it time to recheck (ferritin and hemoglobin|hemoglobin and ferritin)\?$/,
    texts.join(" | ")
  );
  assert.ok(texts.includes("Is it time to recheck hs-CRP?"), "analyte casing is kept");
  const workups = texts.filter((t) => /worth adding/i.test(t));
  assert.ok(workups.length, "worth-adding questions are proposed");
  for (const t of workups) assert.match(t, /^Would it be worth adding .+ to the next draw\?$/);
  for (const t of texts)
    assert.doesNotMatch(t, /(?<!^)\b(Hemoglobin|Iron|Fasting|Ferritin)\b/, "no capitalised noun mid-sentence");
});

test("a follow-up a year out is not a question for this visit", () => {
  seedLipidFollowUp();
  // Right after the draw the lipid recheck is ~12 weeks out (inside the horizon).
  const soon = visitQuestionsRead({ asOf: "2026-01-02" });
  assert.ok(
    soon.questions.some((q) => q.id === "loop:panel:lipids"),
    "an opening recheck is askable"
  );
  // Pushed far past the horizon (as of long before the draw) it is not.
  const early = visitQuestionsRead({ asOf: "2025-01-01" });
  assert.ok(!early.questions.some((q) => q.id === "loop:panel:lipids"));
});

test("a clinical ask the team holds for a doctor leads, printed as written", () => {
  seedLipidFollowUp();
  const text = "Synthetic note: ask whether the new routine changes when the next draw should be.";
  const decision = seedClinicalAsk(text);
  const read = visitQuestionsRead({ asOf: "2026-05-01" });
  assert.equal(read.questions[0].source, "clinical_ask");
  assert.equal(read.questions[0].id, `ask:${decision.id}`);
  assert.equal(read.questions[0].text, text);
  assert.equal(read.questions.filter((q) => q.source === "clinical_ask").length, 1);
});

test("the athlete's final list replaces the proposals and matches proposals by text", () => {
  seedLipidFollowUp();
  const proposed = visitQuestionsRead({ asOf: "2026-05-01" }).questions;
  const keep = proposed[0].text;
  const out = resolveVisitQuestions([keep, "My own synthetic question?", keep], { asOf: "2026-05-01" });
  assert.equal(out.length, 2, "a repeated line is kept once");
  assert.equal(out[0].id, proposed[0].id, "a kept proposal keeps its id");
  assert.equal(out[1].source, "athlete");
  assert.equal(parseVisitQuestionList(undefined), undefined, "not sent → proposals stand");
  assert.deepEqual(parseVisitQuestionList(""), [], "sent empty → no questions");
  assert.deepEqual(parseVisitQuestionList(["a?", 3, "  b? "]), ["a?", "b?"]);
});

test("evidence wanted: one calm line for the overdue recheck, else nothing", () => {
  seedLipidFollowUp();
  const due = evidenceWantedRead({ asOf: "2026-05-01" });
  assert.ok(due.item, "an overdue lipid recheck is named");
  assert.equal(due.item.key, "panel:lipids");
  assert.equal(due.item.kind, "recheck");
  assert.match(due.item.line, /^When it suits you, a recheck of ApoB and LDL-C would help the team/);
  assert.doesNotMatch(due.item.line, /\bmust\b|overdue|urgent/i, "calm, never a nag");
  assert.equal(Array.isArray(due.item), false, "at most one item");

  const notYet = evidenceWantedRead({ asOf: "2026-01-15" });
  assert.equal(notYet.item, null, "nothing is overdue two weeks after the draw");
  assert.match(notYet.frame, /Nothing waits on it/);
});

test("evidence wanted falls back to an off reading past its own marker's window — never a genetic one", () => {
  seedHealthDoc("2025-01-01", [
    marker("hs-CRP", 3.4, { unit: "mg/L", flag: "high" }), // fast class: past validity after ~6 months
    marker("Lp(a)", 180, { unit: "nmol/L", flag: "high" }), // genetic: never ages out
  ]);
  const read = evidenceWantedRead({ asOf: "2026-06-01" });
  assert.ok(read.item);
  assert.match(read.item.key, /^aging:/);
  assert.match(read.item.label, /crp/i);
  assert.equal(read.item.since, "2025-01-01");
  assert.match(read.item.line, /a fresh hs-CRP reading/, "the analyte keeps its casing");

  resetTables("health_documents");
  seedHealthDoc("2025-01-01", [marker("Lp(a)", 180, { unit: "nmol/L", flag: "high" })]);
  assert.equal(evidenceWantedRead({ asOf: "2026-06-01" }).item, null, "a genetic marker is never evidence wanted");
});

test("evidence wanted counts off-optimal only where the optimal band is trusted", () => {
  // A composite name is never given an optimal mark (the Records view shows none), so a
  // lab-normal one is never the evidence line — the same guard as the Records marks.
  seedHealthDoc("2025-01-01", [marker("Total Cholesterol / HDL Ratio", 3.1, { flag: "normal" })]);
  assert.equal(evidenceWantedRead({ asOf: "2026-06-01" }).item, null, "an untrusted band never names evidence");

  // Control: a lab-normal reading outside a trusted optimal band, past its window, does.
  seedHealthDoc("2025-01-01", [marker("LDL-C", 150, { unit: "mg/dL", flag: "normal" })]);
  const read = evidenceWantedRead({ asOf: "2026-06-01" });
  assert.ok(read.item, "a trusted off-optimal aged reading is named");
  assert.match(read.item.label, /ldl/i);
});

test("the MCP tools mirror the reads", async () => {
  seedLipidFollowUp();
  const tools = new Map();
  registerConnectedBrainTools({ tool: (name, _d, _s, handler) => tools.set(name, handler) });
  const q = JSON.parse((await tools.get("get_visit_questions")({ as_of: "2026-05-01" })).content[0].text);
  assert.ok(q.questions.some((x) => x.id === "loop:panel:lipids"));
  const e = JSON.parse((await tools.get("get_evidence_wanted")({ as_of: "2026-05-01" })).content[0].text);
  assert.equal(e.item.key, "panel:lipids");
});
