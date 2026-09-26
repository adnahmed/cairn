// The doctor packet's section toggles (v2 wave 3). src/report.ts renders one packet in
// three formats — HTML (print/PDF), text (MyChart paste) and JSON (the live preview) —
// and the invariants are:
//   - a section toggled off is ABSENT from all three (the JSON key is not sent)
//   - default = every section but the opt-in source-document list; clinical panel order, lab flags and the stale-results
//     note survive the toggles
//   - the informational / not-medical-advice line prints whatever is toggled
//   - the athlete's visit-question list is used verbatim and never stored
// Every fixture is synthetic: invented names, dates and values.
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { db, localDaysAgo, marker, repo, resetTables, seedHealthDoc } from "./_seed.js";
import { markerGroupRank } from "../dist/repo/propagation-data.js";
import {
  REPORT_DEFAULT_SECTION_IDS,
  REPORT_SECTION_IDS,
  buildClinicalReportData,
  clinicalReportJson,
  parseReportSections,
  renderClinicalReportHTML,
  renderClinicalReportText,
} from "../dist/report.js";
import { exportsRouter } from "../dist/routes/exports.js";
import { registerConnectedBrainTools } from "../dist/surfaces/mcp/connected-brain.js";

const SUPPLEMENT = "Synthetic Magnesium Glycinate";
const SOURCE_NAME = "synthetic-thyroid-panel.pdf";
const QUESTION = "Could we look at the synthetic thyroid trend together?";

beforeEach(() => {
  resetTables(
    "health_documents",
    "health_directives",
    "health_reviews",
    "attention_schedule",
    "supplements",
    "profile",
    "bodyweight_log",
    "body_measurements",
    "daily_metrics",
    "brain_decisions",
    "blood_pressure_readings"
  );
});

afterEach(() => {
  db.prepare("DELETE FROM supplements").run();
});

function seedPacket() {
  repo.addHealthDocument({
    kind: "bloodwork",
    doc_date: localDaysAgo(20),
    original_name: SOURCE_NAME,
    parsed_json: {
      markers: [
        marker("TSH", 6.2, { unit: "uIU/mL", flag: "high" }),
        marker("Ferritin", 80, { unit: "ng/mL", flag: "normal" }),
        marker("ApoB", 118, { unit: "mg/dL", flag: "high" }),
      ],
    },
    enrichment_status: "done",
  });
  repo.addHealthDocument({
    kind: "dexa",
    doc_date: localDaysAgo(40),
    original_name: "synthetic-dexa.pdf",
    summary: "Synthetic DEXA summary line for the packet.",
    parsed_json: { markers: [marker("Body Fat %", 21, { unit: "%" })] },
    enrichment_status: "done",
  });
  repo.addSupplement({ name: SUPPLEMENT, dose: "200 mg", frequency: "daily" });
}

function renderAll(sections, questions = [QUESTION]) {
  const data = buildClinicalReportData({ sections, questions });
  return {
    data,
    html: renderClinicalReportHTML(data, {}),
    text: renderClinicalReportText(data, {}),
    json: JSON.parse(JSON.stringify(clinicalReportJson(data))),
  };
}

// For each section: what proves it is present in each format, and the JSON key it owns.
const PROBES = {
  findings: { html: 'class="findings', text: "FINDINGS TO DISCUSS", json: "findings" },
  visit_questions: { html: 'class="visitq"', text: "QUESTIONS FOR THE VISIT", json: "visit_questions", also: QUESTION },
  body_composition: { html: 'class="cap bodycomp"', text: "BODY COMPOSITION (", json: "bodyComp" },
  panels: { html: 'class="group"', text: "\nTHYROID\n", json: "groups" },
  supplements: { html: 'class="suppwrap"', text: "SUPPLEMENTS / WHAT I TAKE", json: "supplements", also: SUPPLEMENT },
  sources: { html: 'class="srcs"', text: "SOURCE DOCUMENTS", json: "sources", also: SOURCE_NAME },
};

test("section ids come from what the report has; the default is all but the source list", () => {
  assert.deepEqual([...REPORT_SECTION_IDS].sort(), Object.keys(PROBES).sort());
  assert.deepEqual(
    [...REPORT_DEFAULT_SECTION_IDS],
    REPORT_SECTION_IDS.filter((id) => id !== "sources")
  );
  assert.deepEqual(parseReportSections(undefined), [...REPORT_DEFAULT_SECTION_IDS]);
  assert.deepEqual(parseReportSections(""), [...REPORT_DEFAULT_SECTION_IDS]);
  assert.deepEqual(parseReportSections("all"), [...REPORT_SECTION_IDS]);
  assert.deepEqual(parseReportSections("none"), []);
  assert.deepEqual(
    parseReportSections("panels,findings,bogus"),
    ["findings", "panels"],
    "catalog order, unknown ids dropped"
  );
  assert.deepEqual(
    parseReportSections("bogus"),
    [...REPORT_DEFAULT_SECTION_IDS],
    "only-unknown falls back to the default"
  );
  assert.deepEqual(parseReportSections(["findings", "sources"]), ["findings", "sources"]);
});

test("every section but the source list is present by default in HTML, text and JSON", () => {
  seedPacket();
  const { html, text, json } = renderAll(undefined);
  for (const [id, probe] of Object.entries(PROBES)) {
    if (id === "sources") continue;
    assert.ok(html.includes(probe.html), `${id} in HTML`);
    assert.ok(text.includes(probe.text), `${id} in text`);
    assert.ok(Object.hasOwn(json, probe.json), `${id} in JSON`);
    if (probe.also) assert.ok(html.includes(probe.also) && text.includes(probe.also), `${id} content printed`);
  }
  assert.deepEqual(json.sections, [...REPORT_DEFAULT_SECTION_IDS]);
  // The uploaded file names reach a clinician only when asked for.
  assert.ok(!html.includes(SOURCE_NAME) && !text.includes(SOURCE_NAME), "no file names by default");
  assert.ok(!Object.hasOwn(json, "sources"));
  assert.ok(json.section_catalog.every((s) => s.label && s.included === (s.id !== "sources")));

  const all = renderAll([...REPORT_SECTION_IDS]);
  for (const [id, probe] of Object.entries(PROBES)) {
    assert.ok(all.html.includes(probe.html) && all.text.includes(probe.text), `${id} with every section on`);
    assert.ok(Object.hasOwn(all.json, probe.json), `${id} in JSON with every section on`);
  }
});

test("findings without panels never point at panels that are not in the packet", () => {
  seedPacket();
  // An old flagged fast-moving reading (the stale-results note) and enough current
  // findings to pass the HTML summary cap.
  seedHealthDoc(localDaysAgo(400), [marker("hs-CRP", 4.2, { unit: "mg/L", flag: "high" })]);
  seedHealthDoc(
    localDaysAgo(10),
    Array.from({ length: 30 }, (_, i) => marker(`Synthetic Analyte ${i + 1}`, 99 + i, { unit: "U/L", flag: "high" }))
  );
  const off = renderAll(["findings", "visit_questions"]);
  assert.ok(off.json.findings.length > 24, "more findings than the HTML cap");
  for (const [format, body] of [
    ["html", off.html],
    ["text", off.text],
  ]) {
    assert.doesNotMatch(body, /panels below|see panels/i, `${format}: no pointer to absent panels`);
    assert.match(body, /older out-of-range reading/, `${format}: the stale note still prints`);
    assert.match(body, /not included in this packet/, `${format}: the stale note says where it is`);
  }
  assert.doesNotMatch(off.html, /more outside range/, "no overflow line — every finding prints");
  for (const m of off.json.findings) assert.ok(off.html.includes(m.name), `${m.name} printed without the panels`);

  const on = renderAll(["findings", "panels"]);
  assert.match(on.html, /dated panels below/, "with the panels in, the note points at them");
  assert.match(on.html, /more outside range — see panels below/, "the cap applies when panels follow");
});

test("a section toggled off is absent from HTML, text and JSON — one at a time", () => {
  seedPacket();
  for (const off of REPORT_SECTION_IDS) {
    const on = REPORT_SECTION_IDS.filter((id) => id !== off);
    const { html, text, json } = renderAll(on);
    const probe = PROBES[off];
    assert.ok(!html.includes(probe.html), `${off} off → absent from HTML`);
    assert.ok(!text.includes(probe.text), `${off} off → absent from text`);
    assert.ok(!Object.hasOwn(json, probe.json), `${off} off → its JSON key is absent`);
    if (probe.also) {
      assert.ok(!html.includes(probe.also), `${off} off → its content is not in the HTML (nor the copy textarea)`);
      assert.ok(!text.includes(probe.also), `${off} off → its content is not in the text`);
    }
    assert.equal(json.section_catalog.find((s) => s.id === off).included, false);
    // Every other section still prints.
    for (const id of on) assert.ok(Object.hasOwn(json, PROBES[id].json), `${id} stays while ${off} is off`);
  }
});

test("the informational line prints whatever is toggled — even with every section off", () => {
  seedPacket();
  for (const sections of [[], ["supplements"], [...REPORT_SECTION_IDS]]) {
    const { html, text, json } = renderAll(sections);
    assert.match(html, /not medical advice/i);
    assert.match(text, /not medical advice/i);
    assert.match(json.disclaimer, /not medical advice/i);
  }
  const bare = renderAll([]);
  assert.deepEqual(bare.json.sections, []);
  for (const key of ["findings", "groups", "bodyComp", "supplements", "visit_questions", "sources"]) {
    assert.ok(!Object.hasOwn(bare.json, key), `${key} absent with every section off`);
  }
  assert.ok(bare.json.subject && bare.json.generated, "the header always prints");
  assert.ok(!bare.html.includes('id="toggleBtn"'), "no findings-only toggle without findings and panels");
});

test("clinical order, lab flags and the stale-results note survive the toggles", () => {
  seedPacket();
  // An old flagged fast-moving reading: kept in its dated panel, not highlighted as current.
  seedHealthDoc(localDaysAgo(400), [marker("hs-CRP", 4.2, { unit: "mg/L", flag: "high" })]);
  const { data, text, json } = renderAll(["findings", "panels"]);
  const keys = json.groups.map((g) => g.key);
  assert.deepEqual(
    keys,
    [...keys].sort((a, b) => markerGroupRank(a) - markerGroupRank(b)),
    "panels in MARKER_GROUPS order"
  );
  const tsh = json.groups.flatMap((g) => g.markers).find((m) => m.name === "TSH");
  assert.equal(tsh.flag, "high", "the lab flag is carried");
  assert.match(text, /TSH: 6\.2 uIU\/mL.*\[Lab: High\]/, "the lab's own flag, worded as the lab's");
  assert.match(text, /older out-of-range reading/, "the stale-results note stays with findings");
  const crp = data.groups.flatMap((g) => g.markers).find((m) => /crp/i.test(m.name));
  assert.equal(crp.staleForFinding, true);
  assert.ok(!json.findings.some((m) => /crp/i.test(m.name)), "the stale reading is not a current finding");
  assert.ok(!Object.hasOwn(json, "impact_score") && !JSON.stringify(json).includes("impact_score"));
});

test("the JSON packet names the lab flag and the optimal miss as two fields; `abnormal` stays for back-compat", () => {
  seedPacket();
  seedHealthDoc(localDaysAgo(20), [marker("LDL-C", 150, { unit: "mg/dL", flag: "normal" })]); // lab-normal, above optimal
  const { json } = renderAll(["findings", "panels"]);
  const all = [...json.findings, ...json.groups.flatMap((g) => g.markers)];
  for (const m of all) {
    assert.equal(typeof m.lab_flagged, "boolean", `${m.name} names the lab's flag`);
    assert.equal(typeof m.outside_optimal, "boolean", `${m.name} names the optimal miss`);
    assert.equal(m.lab_flagged, m.labRange === "out", "lab_flagged is the one lab-range rule");
    assert.equal(m.outside_optimal, m.inOptimal === false);
    assert.equal(m.abnormal, m.lab_flagged || m.outside_optimal, "abnormal is exactly the two merged — read the two fields");
  }
  const ldl = all.find((m) => /^ldl/i.test(m.name));
  assert.deepEqual([ldl.lab_flagged, ldl.outside_optimal, ldl.abnormal], [false, true, true], "optimal only: never lab-flagged");
  const tsh = all.find((m) => m.name === "TSH");
  assert.equal(tsh.lab_flagged, true);
});

// The packet row for one marker in each format: the HTML panel row, the HTML findings
// item, the text panel line and the text findings bullet.
function rowsFor(out, name) {
  const htmlName = name.replace(/&/g, "&amp;");
  const at = (hay, start, end) => {
    const i = hay.indexOf(start);
    return i < 0 ? null : hay.slice(i, hay.indexOf(end, i));
  };
  return {
    htmlPanel: at(out.html, `<td class="m-name">${htmlName}`, "</tr>"),
    htmlFinding: at(out.html, `<span class="f-name">${htmlName}</span>`, "</li>"),
    textPanel: out.text.split("\n").find((l) => l.startsWith(`  ${name}: `)) ?? null,
    textFinding: out.text.split("\n").find((l) => l.startsWith(`    • ${name} — `)) ?? null,
    json: [...out.json.findings, ...out.json.groups.flatMap((g) => g.markers)].filter((m) => m.name === name),
  };
}

test("the packet's lab mark is the one lab-range rule: the lab's flag, the lab's printed range, never a home threshold", () => {
  seedHealthDoc(localDaysAgo(15), [
    marker("ApoB", 131, { unit: "mg/dL", flag: "high" }), // the lab flagged it
    { ...marker("Sodium", 129, { unit: "mmol/L" }), ref_low: 135, ref_high: 145 }, // printed range only, no flag
  ]);
  // A home cuff reading over Cairn's own 130/80 threshold: no lab ranged it.
  repo.addBloodPressureReading({ measured_at: localDaysAgo(3), systolic: 142, diastolic: 91 });
  const out = renderAll(["findings", "panels"]);
  const all = [...out.json.findings, ...out.json.groups.flatMap((g) => g.markers)];

  // Lab-flagged: "Lab: High" in every format, and the JSON names it.
  const apobName = all.find((m) => /apob/i.test(m.name)).name;
  const apob = rowsFor(out, apobName);
  assert.match(apob.htmlPanel, /<span class="flag flag-h">Lab: High<\/span>/);
  assert.match(apob.htmlFinding, /<span class="f-flag high">Lab: High<\/span>/);
  assert.match(apob.textPanel, /\[Lab: High\]/);
  assert.match(apob.textFinding, /\(Lab: High\)/);
  for (const m of apob.json) {
    assert.deepEqual([m.flag, m.labRange, m.labRangeSide, m.labRangeBasis], ["high", "out", "high", "lab_flag"]);
    assert.equal(m.lab_flagged, true);
  }

  // Printed range only: outside the range the lab printed, which the lab did not flag —
  // never worded as the lab's own flag.
  const sodium = rowsFor(out, "Sodium");
  assert.match(sodium.htmlPanel, /<span class="flag flag-r">Below the lab's range<\/span>/);
  assert.doesNotMatch(sodium.htmlPanel, /Lab: /);
  assert.match(sodium.htmlFinding, /<span class="f-flag low">Below the lab's range<\/span>/);
  assert.match(sodium.textPanel, /\[Below the lab's range\]/);
  assert.match(sodium.textFinding, /\(Below the lab's range\)/);
  assert.doesNotMatch(`${sodium.textPanel}${sodium.textFinding}`, /Lab: |\[Low\]|\(Low\)/);
  assert.ok(sodium.json.length >= 2, "a finding and a panel row");
  for (const m of sodium.json) {
    assert.deepEqual([m.flag, m.labRange, m.labRangeSide, m.labRangeBasis], [null, "out", "low", "printed_range"]);
    assert.equal(m.lab_flagged, true, "out of the lab's range: the same rule as the Records page");
    assert.equal(m.abnormal, true);
  }

  // Home BP: Cairn's threshold is not a lab flag — no lab mark in any format.
  const sys = rowsFor(out, "Systolic BP");
  assert.ok(sys.htmlPanel && sys.textPanel, "the home reading is still in its panel");
  assert.doesNotMatch(sys.htmlPanel, /class="flag /, "no lab chip on a home reading");
  assert.doesNotMatch(sys.textPanel, /\[(?:Lab: )?(?:High|Low)\]|lab's range/);
  if (sys.htmlFinding) assert.doesNotMatch(sys.htmlFinding, /Lab: |>High<|lab's range/);
  if (sys.textFinding) assert.doesNotMatch(sys.textFinding, /\((?:Lab: )?High\)|lab's range/);
  assert.ok(sys.json.length >= 1);
  for (const m of sys.json) {
    assert.deepEqual([m.flag, m.labRange, m.labRangeSide, m.labRangeBasis], [null, "unranged", null, null]);
    assert.equal(m.lab_flagged, false, "a home reading is never lab-flagged");
    assert.ok(
      m.history.every((h) => h.flag == null),
      "Cairn's home threshold never travels as a history flag"
    );
  }

  // The legend says what the two marks mean.
  assert.match(out.html, /Above \/ Below the lab's range<\/b> means the value sits outside the range the lab printed/);
  assert.match(out.text, /Above\/Below the lab's range = outside the range the lab printed, not flagged by the lab/);
});

test("the athlete's question list is used verbatim; an empty list prints none; nothing is stored", () => {
  seedPacket();
  const custom = renderAll(undefined, ["First synthetic question?", "  ", "Second synthetic question?"]);
  assert.deepEqual(
    custom.json.visit_questions.map((q) => q.text),
    ["First synthetic question?", "Second synthetic question?"]
  );
  assert.ok(custom.json.visit_questions.every((q) => q.source === "athlete"));
  assert.match(custom.text, /• First synthetic question\?\n {2}• Second synthetic question\?/);

  const empty = renderAll(undefined, []);
  assert.deepEqual(empty.json.visit_questions, [], "an empty sent list replaces the proposals");
  assert.ok(!empty.text.includes("QUESTIONS FOR THE VISIT"));

  const proposed = buildClinicalReportData({});
  assert.ok(!proposed.visitQuestions.some((q) => /synthetic question/i.test(q.text)), "a sent list was never stored");
});

test("REST ?sections= and ?questions= reach every format; MCP mirrors them", async () => {
  seedPacket();
  const app = express();
  app.use("/api", exportsRouter);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const qs = `sections=findings,visit_questions&questions=${encodeURIComponent(QUESTION)}&questions=${encodeURIComponent("Another synthetic one?")}`;
    const json = await (await fetch(`${base}/health-report.json?${qs}`)).json();
    assert.deepEqual(json.sections, ["findings", "visit_questions"]);
    assert.deepEqual(
      json.visit_questions.map((q) => q.text),
      [QUESTION, "Another synthetic one?"]
    );
    assert.ok(!Object.hasOwn(json, "groups") && !Object.hasOwn(json, "supplements"));
    const text = await (await fetch(`${base}/health-report.txt?${qs}`)).text();
    assert.ok(text.includes(QUESTION) && !text.includes(SUPPLEMENT));
    const html = await (await fetch(`${base}/health-report?${qs}`)).text();
    assert.ok(html.includes(QUESTION) && !html.includes(SUPPLEMENT));
    const all = await (await fetch(`${base}/health-report.json`)).json();
    assert.deepEqual(all.sections, [...REPORT_DEFAULT_SECTION_IDS]);
    const every = await (await fetch(`${base}/health-report.json?sections=all`)).json();
    assert.deepEqual(every.sections, [...REPORT_SECTION_IDS]);
  } finally {
    server.close();
  }

  const tools = new Map();
  registerConnectedBrainTools({ tool: (name, _d, _s, handler) => tools.set(name, handler) });
  const out = await tools.get("get_health_report")({ sections: ["supplements"], format: "json" });
  const mcpJson = JSON.parse(out.content[0].text);
  assert.deepEqual(mcpJson.sections, ["supplements"]);
  assert.ok(!Object.hasOwn(mcpJson, "findings"));
  const bare = await tools.get("get_health_report")({ sections: [] });
  assert.match(bare.content[0].text, /not medical advice/i);
  assert.ok(!bare.content[0].text.includes("FINDINGS TO DISCUSS"));
});
