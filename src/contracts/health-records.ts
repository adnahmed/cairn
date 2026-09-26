// The health-records contract (v2 wave 3, "Health you can navigate, and a packet you can
// hand over").
//
// Four server-owned reads the Records and packet surfaces paint:
//   - RECORDS SEARCH — one search across markers, health documents, visit notes and body
//     readings, grouped three ways: out of range first (keyed on the LAB's range: its own
//     flag or the range it printed, src/repo/lab-range.ts), by
//     panel (MARKER_GROUPS order, src/repo/propagation-data.ts), and newest.
//     `GET /api/records/search?q=&group=` · MCP `search_health_records`.
//   - VISIT QUESTIONS — calm questions proposed for the next visit, one per doctor-loop
//     follow-up plus any clinical ask the team is holding for a doctor.
//     `GET /api/health/visit-questions` · MCP `get_visit_questions`.
//   - EVIDENCE WANTED — at most ONE calm line naming the overdue recheck or rescan the team
//     would find useful. Pull, never push: it waits on the page and nothing notifies.
//     `GET /api/health/evidence-wanted` · MCP `get_evidence_wanted`.
//   - THE DOCTOR PACKET as JSON — `GET /api/health-report.json`, the same data the HTML
//     (`/api/health-report`) and text (`/api/health-report.txt`) formats render, with the
//     same `?sections=` toggles and `?questions=` list.
//
// Two facts are never merged into one word: the lab's own HIGH/LOW flag (`lab_flag`) and
// sitting outside the evidence-anchored optimal band (`outside_optimal`). The internal
// marker-priority number never leaves the server. Informational, never medical advice.
//
// Self-contained on purpose: src/client/** can read these types through
// `import("../contracts/health-records.js")`, and this module imports nothing.

// ---- records search ---------------------------------------------------------------

/** How a search is grouped. */
export type ClientRecordsGroupMode = "out_of_range" | "panel" | "newest";

/** The lab's own out-of-range flag. `normal` and anything unrecognised read as null. */
export type ClientLabFlag = "high" | "low";

/**
 * Where a reading sits against the LAB's range (src/repo/lab-range.ts — the one rule):
 * `out` = the lab flagged it, or its value is outside the range the lab printed;
 * `within` = the lab marked it normal, or it is inside the printed range;
 * `unranged` = no lab ranged it (weigh-ins, home cuff, wearables, a result printed
 * without a range). The optimal band never enters this.
 */
export type ClientLabRange = "out" | "within" | "unranged";

/**
 * How current a reading still is for its OWN kind of marker (src/repo/marker-validity.ts):
 * `current`, `aging` (old enough to name, still the best evidence on file), or `past`
 * (past the window where this kind of marker describes the person now).
 */
export type ClientReadingFreshness = "current" | "aging" | "past";

export interface ClientRecordsStaleness {
  /** genetic | slow | standard | fast — the marker's validity class. */
  validity_class: "genetic" | "slow" | "standard" | "fast";
  /** Whole days since the latest reading, as of the read; null when undated. */
  age_days: number | null;
  /** Null when the reading is undated — an undated reading is never called current. */
  freshness: ClientReadingFreshness | null;
  /** One calm sentence about the reading's age, or null while it is current. */
  note: string | null;
}

export interface ClientRecordsOptimalBand {
  low: number;
  high: number;
  /** The WORSE direction: `high` = lower is better, `low` = higher is better, `band` = either side. */
  dir: string;
}

export interface ClientRecordsMarkerHit {
  type: "marker";
  /** Stable id: `marker:<key>`. */
  id: string;
  name: string;
  /** The MARKER_GROUPS panel the marker files under. */
  group: { key: string; label: string };
  unit: string | null;
  value: unknown;
  date: string | null;
  /** The lab's OWN HIGH/LOW flag on a document reading (never Cairn's home-cuff threshold). */
  lab_flag: ClientLabFlag | null;
  /**
   * The lab itself ranged this reading (printed a reference interval, flagged it, or marked
   * it normal). False for weigh-ins, home blood pressure, wearable series and any result the
   * lab gave no range for — those make no range claim either way. Same as `lab_range !== "unranged"`.
   */
  lab_ranged: boolean;
  lab_range: ClientLabRange;
  /** Out of range per the LAB — the only thing "out of range" keys on. */
  lab_out_of_range: boolean;
  /** Which side of the lab's range, when out and the lab or its printed range says so. */
  lab_out_of_range_side: ClientLabFlag | null;
  /** The evidence-anchored optimal band, when one is trustworthy for this marker. */
  optimal: ClientRecordsOptimalBand | null;
  /** A separate mark from `lab_flag`: true outside the optimal band, null with no trusted band. */
  outside_optimal: boolean | null;
  /** Which side of the optimal band, when outside it. */
  optimal_side: "above" | "below" | null;
  staleness: ClientRecordsStaleness;
  /**
   * The marker row exactly as `/api/markers/priority` hands it to the Records catalog
   * (latest, points, trend, forecast, reference, the `lab_range` fields, …; one projection,
   * src/domain/health/marker-public.ts), with the optimal fields cleared where the band is
   * untrusted so the row and the marks above never disagree.
   */
  marker: Record<string, unknown>;
}

export interface ClientRecordsDocumentHit {
  /** `visit_note` covers visit notes and after-visit summaries; every other kind is `document`. */
  type: "document" | "visit_note";
  /** Stable id: `doc:<id>`. */
  id: string;
  doc_id: number;
  kind: string;
  kind_label: string;
  title: string;
  date: string | null;
  summary: string | null;
  /** A short excerpt around the match, or null when the match was the title/kind alone. */
  snippet: string | null;
  /** Readings the document carried. */
  marker_count: number;
}

export interface ClientRecordsBodyHit {
  type: "body";
  /**
   * Stable id: `body:<site>` (waist, hip, …) — a tape site. Weigh-ins and home blood
   * pressure are already marker series (Body Weight, Systolic BP, …) and arrive as markers.
   */
  id: string;
  label: string;
  unit: string;
  /** The latest reading. */
  value: number;
  date: string;
  /** How many readings the series holds. */
  count: number;
}

export type ClientRecordsHit = ClientRecordsMarkerHit | ClientRecordsDocumentHit | ClientRecordsBodyHit;

export interface ClientRecordsSection {
  /**
   * `out_of_range`: `lab_out_of_range` ("Outside the lab's range"), `outside_optimal`
   * ("Outside optimal": inside or without a lab range, outside a trusted optimal band),
   * `lab_within_range` ("Within the lab's range": a lab ranged it), `no_lab_range` ("Other
   * readings": nothing a lab ranged), then `visit_notes`, `documents`, `body_readings` —
   * the same keys and labels the Records page files its catalog under. `panel`: one per
   * MARKER_GROUPS key present, then the same three.
   * `newest`: a single `newest` section, every kind interleaved by date.
   */
  key: string;
  label: string;
  hits: ClientRecordsHit[];
}

export interface ClientRecordsSearchRead {
  q: string;
  group: ClientRecordsGroupMode;
  as_of: string;
  sections: ClientRecordsSection[];
  counts: {
    markers: number;
    documents: number;
    visit_notes: number;
    body: number;
    /** Markers outside the lab's range (flagged, or outside the range the lab printed). */
    lab_out_of_range: number;
    /** Markers outside a trusted optimal band — counted separately, never folded into `lab_out_of_range`. */
    outside_optimal: number;
  };
  frame: string;
}

// ---- visit questions --------------------------------------------------------------

export type ClientVisitQuestionSource = "clinical_ask" | "doctor_loop" | "missing_workup" | "athlete";

export interface ClientVisitQuestion {
  /** Stable id: `ask:<decision id>`, `loop:<follow-up key>`, `workup:<key>`, or `custom:<n>`. */
  id: string;
  text: string;
  source: ClientVisitQuestionSource;
  /** Plain context behind a proposed question, or null. Never printed in the packet. */
  basis: string | null;
}

export interface ClientVisitQuestionsRead {
  as_of: string;
  questions: ClientVisitQuestion[];
  frame: string;
}

// ---- evidence wanted --------------------------------------------------------------

export interface ClientEvidenceWanted {
  /** Stable identity of the evidence (a doctor-loop key, `rescan:<marker>` or `aging:<marker>`). */
  key: string;
  kind: "recheck" | "rescan";
  label: string;
  /** The one calm line to print, finished. */
  line: string;
  /** The date of the last reading this would refresh, or null. */
  since: string | null;
}

export interface ClientEvidenceWantedRead {
  as_of: string;
  /** At most one — or null when nothing is overdue. */
  item: ClientEvidenceWanted | null;
  frame: string;
}

// ---- the doctor packet (health report) --------------------------------------------

/**
 * The packet's toggleable sections. The header (who, when, reading span) and the
 * informational / not-medical-advice line are always present. With no `?sections=`, every
 * section prints except `sources` (the uploaded file names), which is opt-in; `all` includes it.
 */
export type ClientReportSectionId =
  | "findings"
  | "panels"
  | "body_composition"
  | "supplements"
  | "visit_questions"
  | "sources";

export interface ClientReportSectionOption {
  id: ClientReportSectionId;
  label: string;
  included: boolean;
}

export type ClientReportTargetKind = "optimal" | "reference" | "source_flag" | "expected" | "context";

export interface ClientReportMarker {
  name: string;
  unit: string | null;
  value: unknown;
  /**
   * The lab's own HIGH/LOW flag on a document reading (normal stripped to null). A home
   * cuff reading's high/low is Cairn's own threshold, not a lab's, so it is never here.
   */
  flag: "high" | "low" | null;
  /**
   * "Out of range" per the LAB (src/repo/lab-range.ts): `out` when the lab flagged it
   * or the value sits outside the range the lab printed; `within`; or `unranged` when
   * no lab ranged it (a home reading, a weigh-in, an estimate).
   */
  labRange: "out" | "within" | "unranged";
  /** Which side of the lab's range, when out and the lab or its printed range says so. */
  labRangeSide: "high" | "low" | null;
  /** Why it is out: the lab's own flag, or the value against the lab's printed range. */
  labRangeBasis: "lab_flag" | "printed_range" | null;
  /**
   * The report's highlight: out of the lab's range OR outside the optimal target. Kept
   * for back-compat; it BLURS two facts, so a data consumer reads `lab_flagged` and
   * `outside_optimal` (on the JSON packet) to tell them apart.
   */
  abnormal: boolean;
  optimal: { low: number; high: number; dir: string } | null;
  optimalText: string | null;
  reference: { low: number | null; high: number | null } | null;
  referenceSource: string | null;
  referenceSourceUrl: string | null;
  referenceText: string | null;
  targetText: string;
  targetKind: ClientReportTargetKind;
  inOptimal: boolean | null;
  latestDate: string | null;
  trendDir: string | null;
  trendText: string | null;
  methodNote: string | null;
  sourceNames: string[];
  estimated: boolean;
  dateLabel: string | null;
  staleForFinding: boolean;
  freshnessNote: string | null;
  findingSuppressed: boolean;
  findingSuppressionNote: string | null;
  history: Array<{ value: unknown; date: string; flag: string | null }>;
  source: string | null;
}

/**
 * A packet marker as the JSON format hands it out: the report marker plus the two facts
 * `abnormal` merges, each named on its own — never read one off the other.
 */
export interface ClientReportMarkerJson extends ClientReportMarker {
  /**
   * Out of the lab's range (`labRange === "out"`): the lab flagged it, or the value sits
   * outside the range the lab printed. `labRangeBasis` says which; a home reading's
   * Cairn threshold never sets it.
   */
  lab_flagged: boolean;
  /** Outside the trusted optimal target (`inOptimal === false`); false with no trusted band. */
  outside_optimal: boolean;
}

export interface ClientReportGroup {
  key: string;
  label: string;
  markers: ClientReportMarker[];
}

export interface ClientReportGroupJson {
  key: string;
  label: string;
  markers: ClientReportMarkerJson[];
}

export interface ClientReportBodyComp {
  label: string;
  summary: string;
  asOf: string | null;
}

export interface ClientReportSupplement {
  name: string;
  dose: string | null;
  frequency: string | null;
}

export interface ClientReportSource {
  date: string | null;
  kind: string;
  name: string;
}

/**
 * `GET /api/health-report.json`. A section toggled off is ABSENT (its key is not sent);
 * a section toggled on with nothing in it is present and empty (`bodyComp: null`, `[]`).
 */
export interface ClientHealthReportJson {
  subject: { name: string | null; sex: string | null; age: number | null; heightText: string; weightLb: number | null };
  generated: string;
  dateRange: { from: string; to: string } | null;
  sections: ClientReportSectionId[];
  section_catalog: ClientReportSectionOption[];
  findings?: ClientReportMarkerJson[];
  groups?: ClientReportGroupJson[];
  bodyComp?: ClientReportBodyComp | null;
  supplements?: ClientReportSupplement[];
  visit_questions?: ClientVisitQuestion[];
  sources?: ClientReportSource[];
  /** Always present, whatever is toggled. */
  disclaimer: string;
}
