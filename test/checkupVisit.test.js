// Two doctor-loop fixes, on fixtures shaped like the live record (today 2026-10-02):
//
//   1. Derived markers count as checked (src/repo/doctor-loop-derived.ts): a draw with
//      Total Cholesterol + HDL on it IS a non-HDL-C check, so the non-HDL-C recheck no
//      longer stays "open since" an older draw that happened to print the line — and the
//      attention row, the doctor loop and the next-checkup read all carry that one date.
//   2. Rechecks fold into one visit (nextCheckupRead().visit): the earliest ~5-day window
//      on/after the latest opening within ~10 weeks, two weeks clear of a dated race,
//      with already-open rechecks folded in and a due DEXA joining the same visit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { repo, seedHealthDoc, seedWeight, marker } from "./_seed.js";
import { effectiveMarkerCheckDate, withDerivedReadings } from "../dist/repo/doctor-loop-derived.js";

const AS_OF = "2026-10-02";
const mg = (name, value, flag = null) => marker(name, value, { unit: "mg/dL", flag });

function seedLiveShape({ race = "2026-11-01", dexa = true } = {}) {
  if (dexa) {
    seedHealthDoc(
      "2026-06-02",
      [
        marker("Body Fat %", 35.6, { unit: "%" }),
        marker("Fat Mass (Total)", 65.6, { unit: "lbs" }),
        marker("Lean Mass (Total)", 112.6, { unit: "lbs" }),
        marker("Bone Mineral Content (BMC)", 6.1, { unit: "lbs" }),
        marker("Visceral Fat", 1.13, { unit: "lbs" }),
      ],
      "dexa"
    );
  }
  seedHealthDoc("2026-06-11", [
    mg("Total Cholesterol", 290, "high"),
    mg("HDL Cholesterol", 56),
    mg("Non-HDL-C", 234, "high"),
    mg("ApoB", 148, "high"),
    mg("LDL-C", 207, "high"),
    marker("hs-CRP", 3.1, { unit: "mg/L", flag: "high" }),
    marker("Ferritin", 260, { unit: "ng/mL" }),
    marker("Testosterone", 380, { unit: "ng/dL" }),
  ]);
  // The newer draw prints TC and HDL but no non-HDL-C line.
  seedHealthDoc("2026-08-24", [
    mg("Total Cholesterol", 262, "high"),
    mg("HDL Cholesterol", 51),
    mg("ApoB", 134, "high"),
    mg("LDL-C", 186, "high"),
    marker("HbA1c", 5.6, { unit: "%" }),
    marker("Vitamin D", 28, { unit: "ng/mL", flag: "low" }),
  ]);
  seedWeight("2026-10-01", 159.8);
  if (race) {
    repo.setProfile({
      endurance_goal: { mode: "race", event: "Cambridge Half Marathon", date: race, distance_km: 21.1 },
    });
  }
}

// ---- 1. derived markers -------------------------------------------------------

test("withDerivedReadings extends a reported non-HDL-C series from a newer TC + HDL draw", () => {
  const markers = [
    {
      key: "non hdl c",
      name: "Non-HDL-C",
      unit: "mg/dL",
      latest: { value: 234, date: "2026-06-11", flag: "high", doc_id: 1 },
      points: [{ date: "2026-06-11", value: 234 }],
      reference: { low: null, high: 130 },
      reference_source: "source_lab",
    },
    {
      key: "total cholesterol",
      name: "Total Cholesterol",
      unit: "mg/dL",
      latest: { value: 262, date: "2026-08-24" },
      points: [
        { date: "2026-06-11", value: 290 },
        { date: "2026-08-24", value: 262 },
      ],
    },
    {
      key: "hdl cholesterol",
      name: "HDL Cholesterol",
      unit: "mg/dL",
      latest: { value: 51, date: "2026-08-24" },
      points: [
        { date: "2026-06-11", value: 56 },
        { date: "2026-08-24", value: 51 },
      ],
    },
  ];
  const out = withDerivedReadings(markers);
  const nonHdl = out.find((m) => m.key === "non hdl c");
  assert.equal(nonHdl.latest.date, "2026-08-24");
  assert.equal(nonHdl.latest.value, 211);
  assert.equal(nonHdl.latest.flag, null, "the lab never flagged a value it never printed");
  assert.equal(nonHdl.latest.doc_id, null);
  assert.equal(nonHdl.reference, null, "the older draw's printed range does not travel to the derived reading");
  assert.equal(markers[0].latest.date, "2026-06-11", "the input is not mutated");
  assert.equal(effectiveMarkerCheckDate("Non-HDL Cholesterol", markers), "2026-08-24");
  // Idempotent: a second pass finds nothing newer.
  assert.deepEqual(withDerivedReadings(out), out);
});

test("a same-day printed non-HDL-C wins, and a never-reported one is never invented", () => {
  const tc = {
    key: "total cholesterol",
    name: "Total Cholesterol",
    unit: "mg/dL",
    latest: { value: 262, date: "2026-08-24" },
    points: [{ date: "2026-08-24", value: 262 }],
  };
  const hdl = {
    key: "hdl cholesterol",
    name: "HDL Cholesterol",
    unit: "mg/dL",
    latest: { value: 51, date: "2026-08-24" },
    points: [{ date: "2026-08-24", value: 51 }],
  };
  const printed = {
    key: "non hdl c",
    name: "Non-HDL-C",
    unit: "mg/dL",
    latest: { value: 210, date: "2026-08-24" },
    points: [{ date: "2026-08-24", value: 210 }],
  };
  const same = withDerivedReadings([printed, tc, hdl]);
  assert.equal(same[0].latest.value, 210);
  const none = withDerivedReadings([tc, hdl]);
  assert.equal(none.length, 2);
  assert.equal(
    none.some((m) => m.key === "non hdl c"),
    false
  );
  // Components on different draws never pair up.
  const split = withDerivedReadings([
    { ...printed, latest: { value: 234, date: "2026-06-11" }, points: [{ date: "2026-06-11", value: 234 }] },
    tc,
    { ...hdl, latest: { value: 51, date: "2026-08-20" }, points: [{ date: "2026-08-20", value: 51 }] },
  ]);
  assert.equal(split[0].latest.date, "2026-06-11");
});

test("non-HDL-C reads as checked on the TC + HDL draw on every doctor-loop surface", () => {
  seedLiveShape({ race: null, dexa: false });
  repo.refreshDoctorLoopAttention();

  const row = repo.getAttentionSchedule("marker:non-hdl-c");
  assert.ok(row, "the reported series keeps its cadence row");
  assert.equal(row.last_checked, "2026-08-24");
  assert.equal(row.next_due, "2026-11-16", "the same lipid window as ApoB / LDL-C / TC");

  const loop = repo.doctorLoopRead({ asOf: AS_OF });
  const lipids = loop.attention.find((i) => i.key === "panel:lipids");
  assert.ok(lipids);
  assert.equal(lipids.due, false, "the lipid panel is no longer called due on the June draw");
  assert.equal(lipids.next_due, "2026-11-16");
  const src = lipids.sources.find((s) => s.signal_key === "marker:non-hdl-c");
  assert.equal(src.last_checked, "2026-08-24");

  const read = repo.nextCheckupRead({ asOf: AS_OF });
  assert.equal(
    read.due_now.some((i) => /non-hdl/i.test(i.label)),
    false
  );
  const upcoming = read.upcoming.find((i) => i.signal_key.startsWith("marker:") && /non-hdl|apob|ldl/i.test(i.label));
  assert.ok(upcoming);
  assert.equal(upcoming.next_due, "2026-11-16");
});

test("TC + HDL alone never grow a non-HDL-C recheck row", () => {
  seedHealthDoc("2026-08-24", [mg("Total Cholesterol", 262, "high"), mg("HDL Cholesterol", 51)]);
  repo.refreshDoctorLoopAttention();
  assert.equal(repo.getAttentionSchedule("marker:non-hdl-c"), null);
});

// ---- 2. one visit -------------------------------------------------------------

test("the visit folds every open and opening recheck into one window two weeks clear of the race", () => {
  seedLiveShape();
  const read = repo.nextCheckupRead({ refresh: true, asOf: AS_OF });
  const v = read.visit;
  assert.ok(v, "a visit is composed");
  // The latest opening within ten weeks is HbA1c / vitamin D on Nov 22 (lipids open on
  // Nov 16); the half on Nov 1 is already 14+ days clear of it.
  assert.equal(v.window_start, "2026-11-22");
  assert.equal(v.window_end, "2026-11-26");

  const byLabel = (re) => v.labs.find((l) => re.test(l.label));
  for (const re of [/hs-crp/i, /ferritin/i, /testosterone/i]) {
    const lab = byLabel(re);
    assert.ok(lab, `${re} folds into the visit`);
    assert.equal(lab.state, "past_window");
    assert.equal(lab.last_date, "2026-06-11");
  }
  const lipids = byLabel(/apob|ldl|non-hdl/i);
  assert.ok(lipids);
  assert.equal(lipids.state, "opens_in_window");
  assert.equal(lipids.last_date, "2026-08-24");
  assert.equal(byLabel(/hba1c/i).state, "opens_in_window");
  assert.equal(byLabel(/vitamin d/i).state, "opens_in_window");

  assert.match(v.why, /Nov 22 and Nov 26/);
  assert.match(v.why, /Cambridge Half Marathon on Nov 1/);
  assert.match(v.why, /DEXA/);

  assert.ok(v.dexa, "the due DEXA re-scan joins the same visit");
  assert.equal(v.dexa.last_date, "2026-06-02");
  assert.equal(v.dexa.last_weight_lb, 184.3, "fat + lean + bone from the scan itself");
  assert.equal(v.dexa.current_weight_lb, 159.8);
  assert.match(v.dexa.why, /184\.3 lb/);
  assert.match(v.dexa.why, /24\.5 lb lighter/);

  assert.ok(v.prep.some((p) => /morning/i.test(p) && /before 10 a\.m\./.test(p) && /fasted/i.test(p)));
  assert.ok(v.prep.some((p) => /no hard training the day before/i.test(p)));
  assert.ok(v.prep.some((p) => /DEXA/.test(p) && /same conditions/i.test(p)));
  assert.ok(Array.isArray(v.add));

  // Calm and informational: no gate language, no score.
  const text = JSON.stringify(v);
  assert.doesNotMatch(text, /you (should|must)|overdue|score/i);
});

test("a race inside or just before the window pushes the visit to two weeks after it", () => {
  seedLiveShape({ race: "2026-11-20" });
  const v = repo.nextCheckupRead({ refresh: true, asOf: AS_OF }).visit;
  assert.ok(v);
  assert.equal(v.window_start, "2026-12-04");
  assert.equal(v.window_end, "2026-12-08");
  assert.match(v.why, /at least two weeks after Cambridge Half Marathon on Nov 20/);
});

test("past-window rechecks alone set a window starting today, and a race ten days ago pushes it", () => {
  seedHealthDoc("2026-06-11", [marker("hs-CRP", 3.1, { unit: "mg/L", flag: "high" })]);
  repo.setProfile({ endurance_goal: { mode: "race", event: "Autumn 10k", date: "2026-09-22", distance_km: 10 } });
  const v = repo.nextCheckupRead({ refresh: true, asOf: AS_OF }).visit;
  assert.ok(v);
  // Today (Oct 2) is ten days after the race: the window moves to Oct 6.
  assert.equal(v.window_start, "2026-10-06");
  assert.equal(v.labs.length, 1);
  assert.equal(v.labs[0].state, "past_window");
  assert.equal(v.dexa, null);
});

test("a DEXA-only visit says so and carries the scan conditions", () => {
  seedHealthDoc("2026-06-02", [marker("Body Fat %", 35.6, { unit: "%" })], "dexa");
  seedWeight("2026-06-02", 184.3);
  seedWeight("2026-10-01", 159.8);
  const v = repo.nextCheckupRead({ refresh: true, asOf: AS_OF }).visit;
  assert.ok(v);
  assert.equal(v.labs.length, 0);
  assert.equal(v.window_start, AS_OF);
  assert.ok(v.dexa);
  assert.equal(v.dexa.last_weight_lb, 184.3, "a weigh-in on the scan day stands in for the scan weight");
  assert.match(v.why, /repeat DEXA scan/i);
  assert.deepEqual(v.prep.length, 1);
});

test("visit is null when nothing is due or opening within ten weeks", () => {
  assert.equal(repo.nextCheckupRead({ refresh: true, asOf: AS_OF }).visit, null, "empty record");
  // A fresh flagged lipid draw opens its recheck ~12 weeks out — past the horizon.
  seedHealthDoc("2026-09-30", [mg("ApoB", 134, "high")]);
  const read = repo.nextCheckupRead({ refresh: true, asOf: AS_OF });
  assert.equal(read.visit, null);
});
