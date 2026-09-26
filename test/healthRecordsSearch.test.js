// Records search (v2 wave 3): one search across markers, health documents, visit notes
// and body readings, grouped out_of_range | panel | newest. The invariants that matter:
//   - "by panel" order IS MARKER_GROUPS order (the doctor export's clinical order)
//   - "out of range first" keys on the LAB's own flag; outside-optimal is its own mark and
//     never moves a lab-normal marker into the flagged section or merges into one word
//   - the internal marker-priority number never leaves the server (walk the JSON)
//   - every marker carries its reading's age for its own kind of marker
// Every fixture is synthetic: invented names, dates and values.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { marker, repo, resetTables, seedHealthDoc } from "./_seed.js";
import { markerGroupRank } from "../dist/repo/propagation-data.js";
import { parseRecordsGroup, searchRecords } from "../dist/domain/health/records-search.js";
import { connectedBrainRouter } from "../dist/routes/connected-brain.js";
import { registerConnectedBrainTools } from "../dist/surfaces/mcp/connected-brain.js";

const AS_OF = "2026-06-01";

beforeEach(() => {
  resetTables(
    "health_documents",
    "health_directives",
    "attention_schedule",
    "profile",
    "bodyweight_log",
    "body_measurements",
    "blood_pressure_readings",
    "daily_metrics"
  );
});

function seedPanel() {
  seedHealthDoc("2026-05-01", [
    marker("LDL-C", 150, { unit: "mg/dL", flag: "normal" }), // lab-normal, above optimal
    marker("ApoB", 130, { unit: "mg/dL", flag: "high" }), // lab-flagged
    marker("Ferritin", 90, { unit: "ng/mL", flag: "normal" }),
    marker("TSH", 1.9, { unit: "uIU/mL", flag: "normal" }),
    marker("HbA1c", 5.0, { unit: "%", flag: "normal" }),
  ]);
}

function allHits(read) {
  return read.sections.flatMap((s) => s.hits);
}

function walkKeys(value, seen = new Set()) {
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      seen.add(k);
      walkKeys(v, seen);
    }
  }
  return seen;
}

test("by panel: sections follow MARKER_GROUPS order, then the non-marker sections", () => {
  seedPanel();
  const read = searchRecords({ group: "panel", asOf: AS_OF });
  const markerSections = read.sections.filter((s) => s.hits.every((h) => h.type === "marker"));
  const keys = markerSections.map((s) => s.key);
  assert.deepEqual(
    keys,
    [...keys].sort((a, b) => markerGroupRank(a) - markerGroupRank(b)),
    "panel order = MARKER_GROUPS order"
  );
  // Concretely: iron → metabolic → lipids → thyroid (CBC before CMP before lipids before endocrine).
  assert.deepEqual(keys, ["iron", "metabolic", "lipids", "thyroid"]);
  for (const s of markerSections)
    assert.ok(
      s.hits.every((h) => h.group.key === s.key),
      `${s.key} holds only its own panel`
    );
});

test("by panel: a Body Composition panel and the body readings never share a section key", () => {
  seedPanel();
  repo.logWeight(170.2, "2026-05-20");
  repo.addBodyMeasurement("2026-05-21", { waist_in: 33.5 });
  const read = searchRecords({ group: "panel", asOf: AS_OF });
  const keys = read.sections.map((s) => s.key);
  assert.ok(keys.includes("body"), "the weigh-in files under the Body Composition panel");
  assert.ok(keys.includes("body_readings"), "the tape sites are their own section");
  assert.equal(new Set(keys).size, keys.length, "every section key is unique");
});

test("out of range first keys on the lab's range; outside-optimal is a separate section and mark", () => {
  seedPanel();
  const read = searchRecords({ group: "out_of_range", asOf: AS_OF });
  assert.equal(read.sections[0].key, "lab_out_of_range");
  assert.equal(read.sections[0].label, "Outside the lab's range");
  const out = read.sections[0].hits;
  assert.deepEqual(
    out.map((h) => [h.lab_flag, h.lab_out_of_range, h.lab_out_of_range_side, h.lab_range]),
    out.map(() => ["high", true, "high", "out"])
  );
  assert.ok(
    out.some((h) => /apob/i.test(h.name)),
    "the lab-flagged ApoB leads"
  );

  const ldl = allHits(read).find((h) => h.type === "marker" && /^LDL/i.test(h.name));
  assert.ok(ldl, "LDL-C is listed");
  assert.equal(ldl.lab_flag, null, "the lab called it normal");
  assert.equal(ldl.lab_out_of_range, false);
  assert.equal(ldl.outside_optimal, true, "outside optimal is its own fact");
  assert.equal(ldl.optimal_side, "above");
  assert.ok(!out.includes(ldl), "outside-optimal never moves a lab-normal marker into the lab's section");
  assert.equal(read.sections[1].key, "outside_optimal");
  assert.equal(read.sections[1].label, "Outside optimal");
  assert.ok(read.sections[1].hits.includes(ldl));
  const within = read.sections.find((s) => s.key === "lab_within_range");
  assert.equal(within.label, "Within the lab's range");
  assert.ok(within.hits.every((h) => h.lab_range === "within" && h.outside_optimal !== true));
  assert.equal(ldl.lab_ranged, true);
  assert.equal(read.counts.lab_out_of_range, 1);
  assert.ok(read.counts.outside_optimal >= 1);
  assert.ok(!("lab_flagged" in read.counts), "one count for the lab's range, never a second rule");
});

test("a value outside the range the lab printed is out of range even without a flag", () => {
  seedHealthDoc("2026-05-03", [
    { ...marker("Sodium", 129, { unit: "mmol/L" }), ref_low: 135, ref_high: 145 }, // no flag, below the printed range
    { ...marker("Potassium", 4.2, { unit: "mmol/L" }), ref_low: 3.5, ref_high: 5.1 }, // inside it
  ]);
  const read = searchRecords({ group: "out_of_range", asOf: AS_OF });
  const hit = (re) => allHits(read).find((h) => h.type === "marker" && re.test(h.name));
  const sodium = hit(/sodium/i);
  assert.equal(sodium.lab_flag, null, "the lab printed no flag");
  assert.equal(sodium.lab_out_of_range, true, "…but the value sits below the range it printed");
  assert.equal(sodium.lab_out_of_range_side, "low");
  assert.ok(read.sections.find((s) => s.key === "lab_out_of_range").hits.includes(sodium));
  const potassium = hit(/potassium/i);
  assert.equal(potassium.lab_range, "within");
  assert.ok(read.sections.find((s) => s.key === "lab_within_range").hits.includes(potassium));
  // The same rule, on the row the Records page consumes.
  assert.equal(sodium.marker.lab_out_of_range, true);
  assert.equal(sodium.marker.lab_out_of_range_side, "low");
});

test("a reading no lab ranged is never filed as within the lab's range", () => {
  seedPanel();
  repo.logWeight(170.2, "2026-05-20");
  seedHealthDoc("2026-05-02", [marker("Vitamin D", 38, { unit: "ng/mL" })]); // printed with no flag, no range
  const read = searchRecords({ group: "out_of_range", asOf: AS_OF });
  const section = (key) => read.sections.find((s) => s.key === key);
  const bw = allHits(read).find((h) => h.type === "marker" && /body weight/i.test(h.name));
  assert.ok(bw, "the weigh-in is a marker hit");
  assert.equal(bw.lab_ranged, false);
  assert.equal(bw.lab_range, "unranged");
  assert.ok(section("no_lab_range").hits.includes(bw), "a weigh-in files under Other readings");
  assert.equal(section("no_lab_range").label, "Other readings");
  assert.ok(!section("lab_within_range").hits.includes(bw), "never within a range no lab gave");
  const vitd = allHits(read).find((h) => h.type === "marker" && /vitamin d/i.test(h.name));
  assert.equal(vitd.lab_range, "unranged");
  assert.ok(
    [section("no_lab_range"), section("outside_optimal")].some((s) => s?.hits.includes(vitd)),
    "a result printed with no flag and no range makes no range claim"
  );
  const keys = read.sections.map((s) => s.key);
  assert.ok(keys.indexOf("lab_within_range") < keys.indexOf("no_lab_range"), "lab-ranged readings come first");
});

test("a home cuff reading is never the lab's: Cairn's own high is not a lab flag", () => {
  repo.addBloodPressureReading({ systolic: 142, diastolic: 86, measured_at: "2026-05-21T08:00:00" });
  const read = searchRecords({ group: "out_of_range", asOf: AS_OF });
  const sys = allHits(read).find((h) => h.type === "marker" && /systolic/i.test(h.name));
  assert.ok(sys, "the home reading is a marker hit");
  assert.equal(sys.lab_flag, null);
  assert.equal(sys.lab_out_of_range, false);
  assert.equal(sys.lab_range, "unranged");
  assert.ok(!(read.sections.find((s) => s.key === "lab_out_of_range")?.hits ?? []).includes(sys));
});

test("the internal priority number and the optimal distance never leave the server", async () => {
  seedPanel();
  for (const group of ["out_of_range", "panel", "newest"]) {
    const keys = walkKeys(JSON.parse(JSON.stringify(searchRecords({ group, asOf: AS_OF }))));
    assert.ok(!keys.has("impact_score"), `no impact_score in ${group}`);
    assert.ok(!keys.has("distance"), `no optimal distance in ${group}`);
  }
  // Over the wire too.
  const app = express();
  app.use("/api", connectedBrainRouter);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/records/search?group=panel&q=`);
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.ok(!body.includes("impact_score"), "the REST body carries no impact_score");
    assert.equal(JSON.parse(body).group, "panel");
  } finally {
    server.close();
  }
});

test("GET /api/markers/priority: the page's rows carry the lab's range, never the optimal distance", async () => {
  seedPanel();
  seedHealthDoc("2026-05-03", [
    { ...marker("Sodium", 129, { unit: "mmol/L" }), ref_low: 135, ref_high: 145 },
    marker("VLDL Cholesterol", 45, { unit: "mg/dL", flag: "normal" }), // an untrusted optimal match
  ]);
  const app = express();
  app.use("/api", connectedBrainRouter);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/markers/priority`);
    const body = await res.json();
    assert.equal(res.status, 200);
    const keys = walkKeys(body);
    assert.ok(!keys.has("distance"), "the optimal distance stays in-process");
    assert.ok(!keys.has("impact_score"));
    const row = (re) => body.markers.find((m) => re.test(m.name));
    assert.deepEqual(
      [row(/apob/i).lab_out_of_range, row(/apob/i).lab_out_of_range_side, row(/apob/i).lab_range],
      [true, "high", "out"]
    );
    assert.deepEqual([row(/sodium/i).lab_out_of_range, row(/sodium/i).lab_out_of_range_side], [true, "low"]);
    assert.deepEqual([row(/^ldl/i).lab_out_of_range, row(/^ldl/i).lab_range], [false, "within"]);
    const vldl = row(/vldl/i);
    assert.equal(vldl.optimal, null, "an untrusted band is cleared, as the packet clears it");
    assert.equal(vldl.in_optimal, null);
    // The page's rows and the search's hits are one projection.
    const hits = allHits(searchRecords({ group: "panel", asOf: AS_OF })).filter((h) => h.type === "marker");
    for (const m of body.markers) {
      const hit = hits.find((h) => h.name === m.name);
      assert.equal(hit.lab_out_of_range, m.lab_out_of_range, `${m.name}: one rule on page and search`);
      assert.equal(hit.outside_optimal === true, m.in_optimal === false, `${m.name}: one optimal mark`);
    }
  } finally {
    server.close();
  }
});

test("search spans documents, visit notes and body readings; every word must match", () => {
  seedPanel();
  repo.addHealthDocument({
    kind: "visit_note",
    doc_date: "2026-04-10",
    original_name: "synthetic-visit.pdf",
    summary: "Synthetic follow-up visit. Plan: repeat the lipid panel in three months.",
    parsed_json: { assessment: "Synthetic assessment text about sleep hygiene." },
    enrichment_status: "done",
  });
  repo.logWeight(170.2, "2026-05-20");
  repo.logWeight(169.8, "2026-05-27");
  repo.addBodyMeasurement("2026-05-21", { waist_in: 33.5 });

  const lipid = searchRecords({ q: "lipid panel", group: "newest", asOf: AS_OF });
  const note = allHits(lipid).find((h) => h.type === "visit_note");
  assert.ok(note, "the visit note matches its own words");
  assert.match(note.snippet, /lipid panel/i);
  assert.equal(note.snippet.match(/Synthetic follow-up visit/g).length, 1, "the summary is quoted once");
  assert.ok(
    allHits(lipid).every((h) => h.type !== "body"),
    "body readings do not match 'lipid panel'"
  );

  const sleep = searchRecords({ q: "sleep hygiene", asOf: AS_OF });
  assert.ok(
    allHits(sleep).some((h) => h.type === "visit_note"),
    "the parsed note body is searchable"
  );

  const waist = searchRecords({ q: "waist", asOf: AS_OF });
  const w = allHits(waist).find((h) => h.id === "body:waist");
  assert.ok(w, "a tape site is a body reading");
  assert.equal(w.value, 33.5);
  assert.equal(w.unit, "in");

  // A weigh-in is already a marker series (Body Weight), never a second body row.
  const weight = searchRecords({ q: "weight", asOf: AS_OF });
  const bw = allHits(weight).filter((h) =>
    /weight/i.test(h.type === "marker" ? h.name : h.type === "body" ? h.label : "")
  );
  assert.equal(bw.length, 1, "one hit for body weight");
  assert.equal(bw[0].type, "marker");
  assert.equal(bw[0].value, 169.8, "the latest weigh-in");

  const everything = searchRecords({ q: "", group: "out_of_range", asOf: AS_OF });
  const sectionKeys = everything.sections.map((s) => s.key);
  assert.ok(
    sectionKeys.includes("visit_notes") && sectionKeys.includes("documents") && sectionKeys.includes("body_readings")
  );
  assert.ok(everything.counts.visit_notes === 1 && everything.counts.body === 1);

  const none = searchRecords({ q: "ferritin zzzsynthetic", asOf: AS_OF });
  assert.equal(allHits(none).length, 0, "every word must match");
});

test("newest puts the freshest reading first across kinds", () => {
  seedHealthDoc("2025-01-15", [marker("TSH", 2.1, { unit: "uIU/mL" })]);
  seedHealthDoc("2026-03-01", [marker("Ferritin", 60, { unit: "ng/mL" })]);
  repo.logWeight(171, "2026-05-30");
  const read = searchRecords({ group: "newest", asOf: AS_OF });
  assert.equal(read.sections.length, 1);
  const dates = read.sections[0].hits.map((h) => h.date);
  assert.deepEqual(dates, [...dates].sort().reverse(), "newest first");
  assert.match(read.sections[0].hits[0].name, /body weight/i);
});

test("each marker carries its reading's age for its own kind of marker", () => {
  seedHealthDoc("2025-01-01", [marker("hs-CRP", 3.1, { unit: "mg/L", flag: "high" })]); // fast class, ~17 months
  seedHealthDoc("2026-05-01", [marker("TSH", 1.9, { unit: "uIU/mL" })]);
  const read = searchRecords({ asOf: AS_OF });
  const crp = allHits(read).find((h) => h.type === "marker" && /crp/i.test(h.name));
  const tsh = allHits(read).find((h) => h.type === "marker" && /tsh/i.test(h.name));
  assert.equal(crp.staleness.validity_class, "fast");
  assert.equal(crp.staleness.freshness, "past");
  assert.ok(crp.staleness.age_days > 365);
  assert.ok(crp.staleness.note, "a past reading says so in words");
  assert.ok(crp.lab_flag === "high", "an old reading keeps its lab flag — the age is a field, not a filter");
  assert.equal(tsh.staleness.freshness, "current");
  assert.equal(tsh.staleness.note, null);
});

test("group parsing defaults to out_of_range; the MCP tool mirrors the route", async () => {
  assert.equal(parseRecordsGroup("panel"), "panel");
  assert.equal(parseRecordsGroup("bogus"), "out_of_range");
  assert.equal(parseRecordsGroup(undefined), "out_of_range");
  seedPanel();
  const tools = new Map();
  registerConnectedBrainTools({ tool: (name, _d, _s, handler) => tools.set(name, handler) });
  const out = await tools.get("search_health_records")({ q: "apob", group: "panel", as_of: AS_OF });
  const read = JSON.parse(out.content[0].text);
  assert.deepEqual(read, JSON.parse(JSON.stringify(searchRecords({ q: "apob", group: "panel", asOf: AS_OF }))));
  assert.ok(!out.content[0].text.includes("impact_score"));
});
