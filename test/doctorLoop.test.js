import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { db, repo, resetTables, seedHealthDoc, marker } from "./_seed.js";
import { markerGroupInText } from "../dist/repo/propagation-data.js";

beforeEach(() => {
  resetTables(
    "health_documents",
    "health_directives",
    "health_reviews",
    "attention_schedule",
    "profile",
  );
});

test("recommendedPanel subtracts labs and DEXA already on file", () => {
  seedHealthDoc("2026-01-01", [
    marker("ApoB", 78, { unit: "mg/dL" }),
    marker("Lp(a)", 40, { unit: "nmol/L" }),
    marker("HbA1c", 5.1, { unit: "%" }),
    marker("hs-CRP", 0.7, { unit: "mg/L" }),
    marker("Ferritin", 80, { unit: "ng/mL" }),
    marker("TSH", 1.8, { unit: "uIU/mL" }),
    marker("Free T4", 1.2, { unit: "ng/dL" }),
    marker("Free T3", 3.1, { unit: "pg/mL" }),
    marker("25-OH Vitamin D", 45, { unit: "ng/mL" }),
  ]);
  seedHealthDoc("2026-01-10", [
    marker("Body Fat %", 22, { unit: "%" }),
    marker("ALMI", 8.1, { unit: "kg/m2" }),
  ], "dexa");

  const labels = repo.recommendedPanel().map((x) => x.label);
  assert.ok(!labels.includes("ApoB"));
  assert.ok(!labels.includes("Lp(a)"));
  assert.ok(!labels.includes("HbA1c"));
  assert.ok(!labels.includes("hs-CRP"));
  assert.ok(!labels.includes("Ferritin"));
  assert.ok(!labels.includes("Thyroid panel (TSH, Free T4, Free T3)"));
  assert.ok(!labels.includes("DEXA body composition"));
  assert.ok(labels.includes("Fasting insulin"));
  assert.ok(labels.includes("Urine albumin/creatinine ratio"));
});

test("refreshDoctorLoopAttention schedules active lab and DEXA retests through attention policies", () => {
  seedHealthDoc("2026-01-01", [
    marker("ApoB", 125, { unit: "mg/dL", flag: "high" }),
  ]);
  seedHealthDoc("2026-01-15", [
    marker("Body Fat %", 35, { unit: "%", flag: "high" }),
  ], "dexa");

  const rows = repo.refreshDoctorLoopAttention();
  const apob = rows.find((r) => r.signal_key === "marker:apob");
  const dexa = rows.find((r) => r.signal_key === "dexa:body-composition");

  assert.equal(apob.tier, "active");
  assert.equal(apob.next_due, "2026-03-26");
  assert.match(apob.reason, /ApoB/i);
  assert.ok(apob.release_condition);

  assert.equal(dexa.tier, "active");
  assert.equal(dexa.next_due, "2026-04-09");
  assert.equal(dexa.domain, "body");
  assert.match(dexa.reason, /Body composition/i);

  const read = repo.doctorLoopRead({ asOf: "2026-04-10" });
  assert.ok(read.due.some((r) => r.signal_key === "marker:apob"));
  assert.ok(read.due.some((r) => r.signal_key === "dexa:body-composition"));
  assert.ok(read.frame.includes("Informational"));
});

test("clean stable markers converge to released attention instead of fixed retest cadence", () => {
  seedHealthDoc("2026-01-01", [
    marker("ApoB", 70, { unit: "mg/dL", flag: "normal" }),
    marker("HbA1c", 5.1, { unit: "%", flag: "normal" }),
  ]);

  const rows = repo.refreshDoctorLoopAttention();
  const apob = rows.find((r) => r.signal_key === "marker:apob");
  const a1c = rows.find((r) => r.signal_key === "marker:hba1c");

  assert.equal(apob.tier, "released");
  assert.equal(apob.next_due, null);
  assert.match(apob.reason, /goes quiet/i);
  assert.equal(a1c.tier, "released");
  assert.equal(repo.doctorLoopRead({ asOf: "2027-01-01" }).due.length, 0);
});

// Two series fold onto one attention signal (an LDL-C calculated and a direct draw, and a
// VLDL that must not fold at all). The schedule follows the NEWEST reading, never the
// series that happened to be processed last.
test("one attention observation per signal, from the newest reading", () => {
  seedHealthDoc("2026-01-10", [marker("LDL Cholesterol Calc", 160, { unit: "mg/dL" })]);
  seedHealthDoc("2026-02-20", [marker("LDL-C (Direct)", 170, { unit: "mg/dL" })]);
  seedHealthDoc("2026-03-01", [marker("VLDL Cholesterol", 20, { unit: "mg/dL" })]);
  const rows = repo.refreshDoctorLoopAttention().filter((r) => r.signal_key === "marker:ldl-c");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].last_checked, "2026-02-20");
  assert.equal(repo.getAttentionSchedule("marker:ldl-c").last_checked, "2026-02-20");
  assert.notEqual(rows[0].tier, "confirming", "an off-optimal LDL is never read as clean now");
});

test("an off-optimal total testosterone gets a recheck cadence", () => {
  seedHealthDoc("2026-01-10", [marker("Testosterone, Total", 300, { unit: "ng/dL" })]);
  const row = repo.refreshDoctorLoopAttention().find((r) => r.signal_key === "marker:testosterone");
  assert.ok(row, "testosterone is on the schedule");
  assert.equal(row.tier, "active");
});

// ---- the doctor loop shows each follow-up once -------------------------------------

function seedReview(createdAt, followups) {
  db.prepare(`INSERT INTO health_reviews (created_at, agent, parsed_json) VALUES (?, 'stub', ?)`).run(
    createdAt,
    JSON.stringify({ headline: "steady", followups })
  );
}

function row(signal_key, fields = {}) {
  return repo.upsertAttentionSchedule({
    signal_key,
    domain: "health",
    tier: "active",
    next_due: "2026-06-01",
    last_checked: "2026-03-01",
    reason: "x",
    release_condition: "x",
    source: "doctor-loop",
    state: {},
    ...fields,
  });
}

test("many review, directive and cadence rows for one marker collapse to one follow-up", () => {
  // The live shape: a vitamin D recheck filed by the marker cadence, by a Done'd
  // directive, and once per wording by every review since; lipids once per marker.
  seedHealthDoc("2026-01-10", [
    marker("Vitamin D", 22, { unit: "ng/mL", flag: "low" }),
    marker("LDL-C", 160, { unit: "mg/dL", flag: "high" }),
    marker("ApoB", 110, { unit: "mg/dL", flag: "high" }),
  ]);
  const d = repo.addDirective({
    source: "markers",
    marker: "Vitamin D",
    domain: "watch",
    directive: "Retest vitamin D in ~12 weeks.",
    intent_key: "recheck",
  });
  repo.updateDirective(d.id, { status: "resolved", status_at: "2026-01-20" });

  const wordings = [
    ["Retest vitamin D (25-OH)", "in 8 weeks"],
    ["Recheck vitamin D after the dose change", "3 months"],
    ["Repeat vitamin D level", "in 10 weeks"],
  ];
  ["2026-01-15", "2026-02-15", "2026-03-15"].forEach((date, i) => {
    seedReview(`${date} 09:00:00`, [
      { what: wordings[i][0], when: wordings[i][1] },
      { what: "Repeat lipid panel incl. ApoB and LDL-C", when: "in 12 weeks" },
      { what: "Retest fasting lipids", when: "in 12 weeks" },
    ]);
    repo.refreshDoctorLoopAttention(); // one nightly pass per review
  });

  // Only the LATEST review's follow-ups stay filed; older wordings are retired.
  const reviewRows = db
    .prepare("SELECT signal_key FROM attention_schedule WHERE signal_key LIKE 'review-followup:%'")
    .all()
    .map((r) => r.signal_key);
  assert.ok(reviewRows.includes("review-followup:vitamin-d:repeat-vitamin-d-level"));
  assert.ok(!reviewRows.some((k) => /retest-vitamin-d|recheck-vitamin-d/.test(k)), "superseded wordings are gone");

  const read = repo.doctorLoopRead({ asOf: "2026-05-01" });
  const keys = read.attention.map((i) => i.key);
  assert.equal(new Set(keys).size, keys.length, "every item has its own identity");

  const vitD = read.attention.filter((i) => i.markers.includes("Vitamin D"));
  assert.equal(vitD.length, 1, "one vitamin D follow-up");
  assert.equal(vitD[0].key, "panel:vitamins");
  const vitSources = vitD[0].sources.map((s) => s.signal_key).sort();
  assert.deepEqual(vitSources, [
    "directive-recheck:vitamin-d",
    "marker:vitamin-d",
    "review-followup:vitamin-d:repeat-vitamin-d-level",
  ]);
  assert.equal(vitD[0].source_count, 3);
  // The earliest still-open due across its sources: the cadence's 90-day window from
  // the January draw (the directive's 12 weeks and the review's 10 weeks land later).
  const earliest = vitD[0].sources
    .map((s) => s.next_due)
    .filter(Boolean)
    .sort()[0];
  assert.equal(vitD[0].next_due, earliest);
  assert.equal(vitD[0].next_due, "2026-04-10");
  assert.equal(vitD[0].due, true);
  assert.equal(vitD[0].latest_evidence.date, "2026-03-15", "the newest evidence is the latest review");

  const lipids = read.attention.filter((i) => i.key === "panel:lipids");
  assert.equal(lipids.length, 1, "one lipid follow-up, however many lipid rows feed it");
  assert.ok(lipids[0].markers.includes("ApoB") && lipids[0].markers.includes("LDL-C"));
  assert.ok(
    lipids[0].sources.some((s) => s.signal_key === "review-followup:lab-follow-up:retest-fasting-lipids"),
    "a follow-up that only says 'lipids' joins the lipid panel"
  );
  assert.equal(read.due.filter((i) => i.key === "panel:lipids").length, 1);
  assert.equal(read.due.filter((i) => i.key === "panel:vitamins").length, 1);
  assert.doesNotMatch(JSON.stringify(read), /impact_score/);
});

test("the read folds rows already on file, ignoring released and non-doctor rows", () => {
  // The state a live DB carries before its next refresh: duplicates already persisted.
  row("marker:vitamin-d", { next_due: "2026-06-01", last_checked: "2026-03-01" });
  row("directive-recheck:vitamin-d", {
    next_due: "2026-05-20",
    last_checked: "2026-02-25",
    source: "directive-recheck",
  });
  row("review-followup:vitamin-d:a", { next_due: "2026-04-20", last_checked: "2026-03-20", source: "health_review" });
  row("review-followup:vitamin-d:b", { next_due: "2026-04-02", last_checked: "2026-02-01", source: "health_review" });
  row("review-followup:vitamin-d:c", { next_due: "2026-04-15", last_checked: "2026-01-15", source: "health_review" });
  // Run its course: never resurrects the follow-up or its date.
  row("review-followup:vitamin-d:old", { tier: "released", next_due: "2026-01-01", source: "health_review" });
  // Another loop's row in the same domain is not a doctor follow-up.
  row("expectation-followup:1", { next_due: "2026-03-01", source: "expectation-followup" });

  const read = repo.doctorLoopRead({ asOf: "2026-05-01" });
  assert.equal(read.attention.length, 1);
  const [item] = read.attention;
  assert.equal(item.key, "panel:vitamins");
  assert.equal(item.label, "Vitamin D");
  assert.equal(item.kind, "lab");
  assert.equal(item.next_due, "2026-04-02", "earliest still-open due");
  assert.equal(item.signal_key, "review-followup:vitamin-d:b", "the row carrying that date speaks for it");
  assert.equal(item.latest_evidence.date, "2026-03-20");
  assert.equal(item.latest_evidence.signal_key, "review-followup:vitamin-d:a");
  assert.equal(item.source_count, 5);
  assert.ok(!item.sources.some((s) => s.signal_key.endsWith(":old")));
  assert.deepEqual(
    read.due.map((i) => i.key),
    ["panel:vitamins"]
  );
});

test("an acknowledged Done whose reading still stands keeps its follow-up visible exactly once", () => {
  seedHealthDoc("2026-01-10", [marker("Vitamin D", 22, { unit: "ng/mL", flag: "low" })]);
  const d = repo.addDirective({
    source: "markers",
    marker: "Vitamin D",
    domain: "watch",
    directive: "Retest vitamin D in ~12 weeks.",
    intent_key: "recheck",
  });
  repo.updateDirective(d.id, { status: "resolved", status_at: "2026-01-20" });
  // The engine keeps a Done on a standing reading in effect as acknowledged.
  db.prepare("UPDATE health_directives SET status = 'active', status_at = '2026-01-20' WHERE id = ?").run(d.id);
  repo.refreshDoctorLoopAttention();
  repo.refreshDoctorLoopAttention();

  const items = repo.doctorLoopRead({ asOf: "2026-02-01" }).attention.filter((i) => i.key === "panel:vitamins");
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].sources.map((s) => s.signal_key).sort(), [
    "directive-recheck:vitamin-d",
    "marker:vitamin-d",
  ]);
});

test("a dismissed recheck directive never brings its follow-up back", () => {
  seedHealthDoc("2026-01-10", [marker("Vitamin D", 22, { unit: "ng/mL", flag: "low" })]);
  const done = repo.addDirective({
    marker: "Vitamin D",
    domain: "watch",
    directive: "Retest vitamin D in ~12 weeks.",
    intent_key: "recheck",
  });
  repo.updateDirective(done.id, { status: "resolved", status_at: "2026-01-20" });
  assert.ok(repo.getAttentionSchedule("directive-recheck:vitamin-d"), "Done files the recheck");

  const later = repo.addDirective({
    marker: "Vitamin D",
    domain: "watch",
    directive: "Recheck vitamin D in 3 months.",
    intent_key: "recheck",
  });
  repo.updateDirective(later.id, { status: "dismissed", status_at: "2026-02-01" });
  assert.equal(repo.getAttentionSchedule("directive-recheck:vitamin-d"), null, "Dismiss cancels it at once");

  // A row that predates this rule is healed on the refresh pass.
  row("directive-recheck:vitamin-d", {
    next_due: "2026-04-14",
    last_checked: "2026-01-20",
    source: "directive-recheck",
  });
  repo.refreshDoctorLoopAttention();
  assert.equal(repo.getAttentionSchedule("directive-recheck:vitamin-d"), null);

  const items = repo.doctorLoopRead({ asOf: "2026-05-01" }).attention.filter((i) => i.key === "panel:vitamins");
  assert.equal(items.length, 1, "the marker's own cadence still stands");
  assert.deepEqual(
    items[0].sources.map((s) => s.signal_key),
    ["marker:vitamin-d"]
  );
});

test("a review follow-up a newer reading already answered is retired", () => {
  seedHealthDoc("2026-01-01", [marker("Ferritin", 18, { unit: "ng/mL", flag: "low" })]);
  seedReview("2026-02-01 09:00:00", [{ what: "Retest ferritin", when: "in 6 weeks" }]);
  repo.refreshDoctorLoopAttention();
  assert.ok(repo.getAttentionSchedule("review-followup:ferritin:retest-ferritin"), "filed while unanswered");

  seedHealthDoc("2026-03-10", [marker("Ferritin", 45, { unit: "ng/mL" })]);
  repo.refreshDoctorLoopAttention();
  assert.equal(repo.getAttentionSchedule("review-followup:ferritin:retest-ferritin"), null);
});

test("markerGroupInText names one panel from prose, on word boundaries", () => {
  assert.equal(markerGroupInText("Repeat lipid panel").key, "lipids");
  assert.equal(markerGroupInText("Recheck hemoglobin A1c").key, "metabolic", "longest match wins");
  assert.equal(markerGroupInText("Recheck overall health at your visit"), null, "'alt' never fires inside 'health'");
  assert.equal(markerGroupInText("Repeat lipid panel and hs-CRP"), null, "two panels is no single panel");
  assert.equal(markerGroupInText("Repeat sleep study"), null);
});
