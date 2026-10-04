// Unit tests for the shared attention-label helpers (src/repo/attention-labels.ts) —
// pure, DB-free. The marker-slug extraction is what drives MARKER-LEVEL dedupe across
// the forward timeline and the next-checkup read; the sentinel guard is what keeps two
// unrelated non-marker follow-ups from silently collapsing into one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { followupLabel, labRecheckLabel, markerLabelFromSlug, markerSlugFromSignalKey } from "../dist/repo/attention-labels.js";

test("markerSlugFromSignalKey extracts a real marker slug for cadence + marker follow-ups", () => {
  assert.equal(markerSlugFromSignalKey("marker:hs-crp"), "hs-crp");
  // A follow-up that named a real marker dedupes against that marker's cadence row.
  assert.equal(markerSlugFromSignalKey("review-followup:hs-crp:recheck-hs-crp"), "hs-crp");
  assert.equal(markerSlugFromSignalKey("review-followup:apob:recheck-apob"), "apob");
});

test("markerSlugFromSignalKey returns null for the non-marker sentinel and non-marker signals", () => {
  // The "lab-follow-up" sentinel is shared by every non-marker follow-up, so it must NOT
  // be a dedupe key — null makes callers key on the full signal_key and both survive.
  assert.equal(markerSlugFromSignalKey("review-followup:lab-follow-up:repeat-sleep-study"), null);
  assert.equal(markerSlugFromSignalKey("review-followup:lab-follow-up:repeat-colonoscopy"), null);
  assert.equal(markerSlugFromSignalKey("dexa:body-composition"), null);
  assert.equal(markerSlugFromSignalKey("add:apob"), null);
  assert.equal(markerSlugFromSignalKey(""), null);
  assert.equal(markerSlugFromSignalKey(null), null);
});

test("followupLabel strips the prefix and any trailing timing parenthetical", () => {
  assert.equal(followupLabel("Health review follow-up: Recheck hs-CRP (when rested)."), "Recheck hs-CRP");
  assert.equal(followupLabel("Health review follow-up: Repeat colonoscopy."), "Repeat colonoscopy.");
  assert.equal(followupLabel(""), null);
  assert.equal(followupLabel(null), null);
});

test("markerLabelFromSlug reads a marker slug back in its canonical display casing", () => {
  // The leak this guards: "marker:hs-crp" title-cased as "Hs Crp".
  assert.equal(markerLabelFromSlug("hs-crp"), "hs-CRP");
  assert.equal(markerLabelFromSlug("lp-a"), "Lp(a)");
  assert.equal(markerLabelFromSlug("ldl-c"), "LDL-C");
  assert.equal(markerLabelFromSlug("apob"), "ApoB");
  assert.equal(markerLabelFromSlug("hba1c"), "HbA1c");
  assert.equal(markerLabelFromSlug("vitamin-d"), "Vitamin D");
  // A marker the zone table does not know keeps its own words, capital first only.
  assert.equal(markerLabelFromSlug("some-new-analyte"), "Some new analyte");
  assert.equal(markerLabelFromSlug("lab-follow-up"), null, "the sentinel is not a marker");
  assert.equal(markerLabelFromSlug(""), null);
});

test("labRecheckLabel names the lab or scan a doctor-loop row is about", () => {
  assert.equal(labRecheckLabel("marker:hs-crp"), "hs-CRP");
  assert.equal(labRecheckLabel("directive-recheck:ldl-c"), "LDL-C");
  assert.equal(labRecheckLabel("review-followup:vitamin-d:retest-vitamin-d"), "Vitamin D");
  assert.equal(labRecheckLabel("dexa:body-composition"), "DEXA scan");
  assert.equal(labRecheckLabel("review-followup:lab-follow-up:repeat-sleep-study"), null);
  assert.equal(labRecheckLabel("training:strength:back-squat"), null);
});
