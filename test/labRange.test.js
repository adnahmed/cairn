// "Out of range" per the LAB (src/repo/lab-range.ts) — the one rule the Records page,
// the records search and the marker DTO share. Out = the lab flagged it, or its value
// sits outside the range the lab PRINTED; a curated interval and the optimal band never
// count; a reading with no document behind it (weigh-in, home cuff, wearable) is never
// the lab's. Synthetic rows only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { labRangeFields, labRangeRead } from "../dist/repo/lab-range.js";

const row = (latest, extra = {}) => ({ name: "Synthetic", latest: { doc_id: 7, ...latest }, ...extra });
const printed = { reference: { low: 5, high: 9 }, reference_source: "source_lab" };

test("the lab's own flag puts a reading out of range", () => {
  assert.deepEqual(labRangeRead(row({ value: 12, flag: "high" })), {
    state: "out",
    side: "high",
    basis: "lab_flag",
    flag: "high",
  });
  assert.deepEqual(labRangeRead(row({ value: 1, flag: "low" })), {
    state: "out",
    side: "low",
    basis: "lab_flag",
    flag: "low",
  });
  // An abnormal mark with no side takes its side from the printed range, else none.
  assert.equal(labRangeRead(row({ value: 12, flag: "abnormal" }, printed)).side, "high");
  assert.equal(labRangeRead(row({ value: "positive", flag: "abnormal" })).side, null);
  assert.equal(labRangeRead(row({ value: "positive", flag: "abnormal" })).state, "out");
});

test("a value outside the range the lab printed is out, even unflagged or marked normal", () => {
  assert.deepEqual(labRangeRead(row({ value: 4, flag: null }, printed)), {
    state: "out",
    side: "low",
    basis: "printed_range",
    flag: null,
  });
  assert.equal(labRangeRead(row({ value: 10, flag: "normal" }, printed)).state, "out");
  assert.equal(labRangeRead(row({ value: 7, flag: null }, printed)).state, "within");
  assert.equal(labRangeRead(row({ value: 7, flag: "normal" })).state, "within", "the lab said normal");
  // One-sided printed range.
  const floor = { reference: { low: 40, high: null }, reference_source: "source_lab" };
  assert.equal(labRangeRead(row({ value: 30 }, floor)).side, "low");
  assert.equal(labRangeRead(row({ value: 90 }, floor)).state, "within");
});

test("a curated interval, the optimal band and a missing range make no lab claim", () => {
  const curated = { reference: { low: 5, high: 9 }, reference_source: "Synthetic curated source" };
  assert.equal(labRangeRead(row({ value: 4, flag: null }, curated)).state, "unranged");
  assert.equal(
    labRangeRead(row({ value: 150, flag: null }, { optimal: { low: 20, high: 100 }, in_optimal: false })).state,
    "unranged",
    "outside optimal is never outside the lab's range"
  );
  assert.equal(labRangeRead(row({ value: 38, flag: null })).state, "unranged");
  assert.equal(labRangeRead(row({ value: "n/a" }, printed)).state, "unranged", "a value that cannot be compared");
});

test("a reading with no document behind it is never the lab's", () => {
  // A home cuff reading carries Cairn's own high/low threshold, not a lab's.
  const cuff = { name: "Systolic BP", latest: { value: 142, flag: "high", doc_id: null, kind: "vitals" } };
  assert.deepEqual(labRangeRead(cuff), { state: "unranged", side: null, basis: null, flag: null });
  assert.equal(labRangeRead({ name: "Body Weight", latest: { value: 170, flag: null } }).state, "unranged");
  assert.equal(labRangeRead(null).state, "unranged");
});

test("the DTO fields carry the read finished", () => {
  assert.deepEqual(labRangeFields(row({ value: 4 }, printed)), {
    lab_range: "out",
    lab_out_of_range: true,
    lab_out_of_range_side: "low",
  });
  assert.deepEqual(labRangeFields(row({ value: 7 }, printed)), {
    lab_range: "within",
    lab_out_of_range: false,
    lab_out_of_range_side: null,
  });
});
