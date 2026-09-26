// The server-owned clinical mark on a proposal: the detector that reads the athlete's
// words and an action's own text for clinical signals, and the reader that accepts
// only a mark the server itself wrote. Lives here (not in chatTurns) so every surface
// that drafts a change — chat, the what-if "do it" — shares ONE detector.

// Every source a server-owned detector may stamp. A model can never write one of these
// and have it believed: serverClinicalProvenance requires `server_owned: true` AND one
// of these exact sources, and only server code builds that object.
export type ClinicalProvenanceSource =
  | "chat_clinical_detection"
  | "chat_clinical_lineage"
  | "what_if_clinical_detection";

const SERVER_CLINICAL_SOURCES: ReadonlySet<string> = new Set<ClinicalProvenanceSource>([
  "chat_clinical_detection",
  "chat_clinical_lineage",
  "what_if_clinical_detection",
]);

// The server-owned clinical mark the chat detector (or its lineage onto a follow-up
// draft, or the what-if hand-off) put on a proposal; null for anything else. Shared by
// the autonomy routing and the thaw's re-reads.
export function serverClinicalProvenance(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const provenance = value as Record<string, unknown>;
  return provenance.server_owned === true && SERVER_CLINICAL_SOURCES.has(String(provenance.source)) ? provenance : null;
}

type ClinicalPlanSignal = {
  label: string;
  pattern: RegExp;
};

const CLINICAL_PLAN_SIGNALS: readonly ClinicalPlanSignal[] = [
  { label: "imaging", pattern: /\b(?:mri|magnetic resonance|imaging|radiolog(?:y|ist|ical))\b/i },
  { label: "ct", pattern: /\b(?:ct (?:scan|study|report)|computed tomography)\b/i },
  { label: "xray", pattern: /\b(?:x[- ]?ray|radiograph)\b/i },
  { label: "ultrasound", pattern: /\b(?:ultrasound|sonogram)\b/i },
  { label: "scoliosis", pattern: /\bscoliosis\b/i },
  { label: "injury", pattern: /\b(?:injur(?:y|ies|ed)|return[- ]to[- ]play)\b/i },
  {
    label: "rehab",
    pattern: /\b(?:rehab(?:ilitation)?|physical therap(?:y|ist)|physiotherap(?:y|ist)|post[- ]?op(?:erative)?)\b/i,
  },
  {
    label: "clinician",
    pattern:
      /\b(?:clinician|physician|doctor|orthop(?:edic|aedist|edist)|medical (?:finding|advice)|diagnos(?:is|ed)|prescribed)\b/i,
  },
  {
    label: "clinical_finding",
    pattern:
      /\b(?:fracture|torn? (?:muscle|tendon|ligament)|herniated disc|disc (?:bulge|protrusion)|stenosis|lesion|impingement)\b/i,
  },
];

const CLINICAL_STUDY_REFERENCE_KEY_RE =
  /(?:^|_)(?:imaging|radiology|study|scan|xray|x_ray|mri|ct|ultrasound|health_document|source_document|clinical_finding|diagnosis)(?:_|$)/i;

export type ClinicalPlanProvenance = {
  server_owned: true;
  source: ClinicalProvenanceSource;
  detected_from: Array<
    | "user_message"
    | "action_rationale_or_constraints"
    | "study_reference"
    | "attached_chat_image"
    | "conversation_lineage"
  >;
  signals: string[];
  study_reference_paths: string[];
  attached_image: boolean;
  lineage?: { turn_id: number; proposal_id: number | null; decision_id: number | null };
};

function clinicalTextSignals(text: string): string[] {
  return CLINICAL_PLAN_SIGNALS.filter((signal) => signal.pattern.test(text)).map((signal) => signal.label);
}

function actionClinicalEvidence(action: unknown): { text: string; referencePaths: string[] } {
  const strings: string[] = [];
  const referencePaths: string[] = [];
  const visit = (value: unknown, pathParts: string[], depth: number): void => {
    if (depth > 6 || strings.length >= 200) return;
    if (typeof value === "string") {
      strings.push(value.slice(0, 2_000));
      return;
    }
    if (Array.isArray(value)) {
      value.slice(0, 100).forEach((entry, index) => visit(entry, [...pathParts, String(index)], depth + 1));
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
      const nextPath = [...pathParts, key];
      if (CLINICAL_STUDY_REFERENCE_KEY_RE.test(key) && entry != null && entry !== "") {
        referencePaths.push(nextPath.join(".").slice(0, 160));
      }
      visit(entry, nextPath, depth + 1);
    }
  };
  visit(action, [], 0);
  return { text: strings.join("\n"), referencePaths: [...new Set(referencePaths)].slice(0, 20) };
}

// Server-owned clinical classification for chat plan actions (and the what-if "do it"
// hand-off, which names its own `source`). The model cannot
// opt out with a boolean: we inspect the athlete's words, action rationale and
// constraints, and any study/document reference fields. Plan-action callers treat
// an attached ad-hoc image as sufficient provenance so an unverified picture cannot
// quietly rewrite training; prose-only turn persistence disables that image-only rule.
export function clinicalPlanProvenance(input: {
  message?: string | null;
  action: unknown;
  imagePath?: string | null;
  imageAloneIsClinical?: boolean;
  /** Which server-owned surface detected it; chat unless named. */
  source?: "chat_clinical_detection" | "what_if_clinical_detection";
}): ClinicalPlanProvenance | null {
  const messageSignals = clinicalTextSignals(String(input.message ?? ""));
  const actionEvidence = actionClinicalEvidence(input.action);
  const actionSignals = clinicalTextSignals(actionEvidence.text);
  const signals = [...new Set([...messageSignals, ...actionSignals])];
  const imageAloneIsClinical = input.imageAloneIsClinical !== false;
  if (!signals.length && !actionEvidence.referencePaths.length && !(input.imagePath && imageAloneIsClinical))
    return null;

  const detectedFrom: ClinicalPlanProvenance["detected_from"] = [];
  if (messageSignals.length) detectedFrom.push("user_message");
  if (actionSignals.length) detectedFrom.push("action_rationale_or_constraints");
  if (actionEvidence.referencePaths.length) detectedFrom.push("study_reference");
  if (input.imagePath) detectedFrom.push("attached_chat_image");
  return {
    server_owned: true,
    source: input.source ?? "chat_clinical_detection",
    detected_from: detectedFrom,
    signals,
    study_reference_paths: actionEvidence.referencePaths,
    attached_image: Boolean(input.imagePath),
  };
}
