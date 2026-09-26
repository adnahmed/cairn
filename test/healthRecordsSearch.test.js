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

test("out of range first keys on the lab flag; outside-optimal is a separate mark", () => {
  seedPanel();
  const read = searchRecords({ group: "out_of_range", asOf: AS_OF });
  assert.equal(read.sections[0].key, "lab_flagged");
  const flagged = read.sections[0].hits;
  assert.deepEqual(
    flagged.map((h) => h.lab_flag),
    flagged.map(() => "high")
  );
  assert.ok(
    flagged.some((h) => /apob/i.test(h.name)),
    "the lab-flagged ApoB leads"
  );

  const ldl = allHits(read).find((h) => h.type === "marker" && /^LDL/i.test(h.name));
  assert.ok(ldl, "LDL-C is listed");
  assert.equal(ldl.lab_flag, null, "the lab called it normal");
  assert.equal(ldl.outside_optimal, true, "outside optimal is its own fact");
  assert.equal(ldl.optimal_side, "above");
  assert.ok(!flagged.includes(ldl), "outside-optimal never moves a lab-normal marker into the flagged section");
  assert.equal(read.sections[1].key, "within_lab_range");
  assert.ok(read.sections[1].hits.includes(ldl));
  assert.equal(read.counts.lab_flagged, 1);
  assert.ok(read.counts.outside_optimal >= 1);
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
  assert.ok(sectionKeys.includes("visit_notes") && sectionKeys.includes("documents") && sectionKeys.includes("body"));
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
