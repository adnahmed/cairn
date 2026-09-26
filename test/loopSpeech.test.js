// How the doctor loop speaks a marker to a person (src/repo/loop-speech.ts): a plain
// Title-case noun reads lower case mid-sentence; an analyte whose casing carries meaning
// (ApoB, LDL-C, hs-CRP, Lp(a), HbA1c, TSH, the D in vitamin D) is kept as written.
// Synthetic labels only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { followThroughQuestion, recheckQuestion, spokenMarkerName, workupQuestion } from "../dist/repo/loop-speech.js";

test("plain nouns lower-case mid-sentence; analyte casing is kept", () => {
  const cases = [
    ["Hemoglobin and Iron", "hemoglobin and iron"],
    ["Fasting insulin", "fasting insulin"],
    ["Vitamin D", "vitamin D"],
    ["25-OH Vitamin D", "25-OH vitamin D"],
    ["Thyroid panel (TSH, Free T4, Free T3)", "thyroid panel (TSH, free T4, free T3)"],
    ["ApoB, LDL-C and HDL-C", "ApoB, LDL-C and HDL-C"],
    ["hs-CRP", "hs-CRP"],
    ["Lp(a)", "Lp(a)"],
    ["HbA1c", "HbA1c"],
    ["Non-HDL-C", "Non-HDL-C"],
    ["DEXA body composition", "DEXA body composition"],
    ["Urine albumin/creatinine ratio", "urine albumin/creatinine ratio"],
  ];
  for (const [label, spoken] of cases) assert.equal(spokenMarkerName(label), spoken, label);
});

test("the shared questions read as calm speech", () => {
  assert.equal(
    recheckQuestion({ kind: "lab", label: "Hemoglobin and Iron" }),
    "Is it time to recheck hemoglobin and iron?"
  );
  assert.equal(recheckQuestion({ kind: "lab", label: "hs-CRP" }), "Is it time to recheck hs-CRP?");
  assert.equal(
    recheckQuestion({ kind: "dexa", label: "Body composition (DEXA)" }),
    "Is it time for a repeat body-composition (DEXA) scan?"
  );
  assert.equal(
    recheckQuestion({ kind: "review", label: "Retest synthetic panel" }),
    'The last health review suggested "Retest synthetic panel" — is now a good time for it?'
  );
  assert.equal(workupQuestion("Fasting insulin"), "Would it be worth adding fasting insulin to the next draw?");
  assert.equal(workupQuestion("Lp(a)"), "Would it be worth adding Lp(a) to the next draw?");
  assert.equal(followThroughQuestion("Ferritin"), "How is my ferritin tracking — is it worth a recheck?");
});
