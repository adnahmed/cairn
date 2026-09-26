// The doctor packet's section toggles (v2 wave 3). src/report.ts renders one packet in
// three formats — HTML (print/PDF), text (MyChart paste) and JSON (the live preview) —
// and the invariants are:
//   - a section toggled off is ABSENT from all three (the JSON key is not sent)
//   - default = every section; clinical panel order, lab flags and the stale-results
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
    "brain_decisions"
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

test("section ids come from what the report has, and default to all", () => {
  assert.deepEqual([...REPORT_SECTION_IDS].sort(), Object.keys(PROBES).sort());
  assert.deepEqual(parseReportSections(undefined), [...REPORT_SECTION_IDS]);
  assert.deepEqual(parseReportSections(""), [...REPORT_SECTION_IDS]);
  assert.deepEqual(parseReportSections("none"), []);
  assert.deepEqual(
    parseReportSections("panels,findings,bogus"),
    ["findings", "panels"],
    "catalog order, unknown ids dropped"
  );
  assert.deepEqual(parseReportSections("bogus"), [...REPORT_SECTION_IDS], "only-unknown falls back to all");
  assert.deepEqual(parseReportSections(["findings", "sources"]), ["findings", "sources"]);
});

test("every section is present by default in HTML, text and JSON", () => {
  seedPacket();
  const { html, text, json } = renderAll(undefined);
  for (const [id, probe] of Object.entries(PROBES)) {
    assert.ok(html.includes(probe.html), `${id} in HTML`);
    assert.ok(text.includes(probe.text), `${id} in text`);
    assert.ok(Object.hasOwn(json, probe.json), `${id} in JSON`);
    if (probe.also) assert.ok(html.includes(probe.also) && text.includes(probe.also), `${id} content printed`);
  }
  assert.deepEqual(json.sections, [...REPORT_SECTION_IDS]);
  assert.ok(json.section_catalog.every((s) => s.included && s.label));
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
  assert.match(text, /TSH: 6\.2 uIU\/mL.*\[High\]/);
  assert.match(text, /older out-of-range reading/, "the stale-results note stays with findings");
  const crp = data.groups.flatMap((g) => g.markers).find((m) => /crp/i.test(m.name));
  assert.equal(crp.staleForFinding, true);
  assert.ok(!json.findings.some((m) => /crp/i.test(m.name)), "the stale reading is not a current finding");
  assert.ok(!Object.hasOwn(json, "impact_score") && !JSON.stringify(json).includes("impact_score"));
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
    assert.deepEqual(all.sections, [...REPORT_SECTION_IDS]);
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
