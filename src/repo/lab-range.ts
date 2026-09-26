// "Out of range" per the LAB — the one rule every surface keys on.
//
// A reading is out of range per the lab when the lab FLAGGED it (its own HIGH/LOW, or an
// abnormal/critical mark) or when its value falls outside the reference interval the lab
// PRINTED beside it (`reference_source === "source_lab"`). A curated fallback interval is
// not the lab's, and the evidence-anchored optimal band is a different fact altogether
// (`in_optimal`, "outside optimal") — neither ever makes a reading out of range here.
//
// Only a reading that came from a document has a lab behind it. A weigh-in, a home cuff
// reading (whose high/low is Cairn's own threshold, not a lab's) and a wearable series
// carry no `doc_id`, so they are `unranged`: they make no range claim either way.
//
// Three states, so no label ever claims more than the lab said:
//   - `out`      — flagged by the lab, or outside the lab's printed range;
//   - `within`   — the lab marked it normal, or it sits inside the printed range;
//   - `unranged` — no lab ranged it (the Records "Other readings").
//
// Pure: a marker row in (the getMarkerHistory / prioritizeMarkers shape), a read out.
// The Records page reads it off the marker DTO (`lab_out_of_range`, `lab_range`), the
// records search keys its sections on it, and nothing re-derives it on the client.

import { finite } from "../lib/numbers.js";

export type LabRangeState = "out" | "within" | "unranged";
export type LabRangeSide = "high" | "low";

export interface LabRangeRead {
  state: LabRangeState;
  /** Which side of the lab's range, when out and the lab or its printed range says so. */
  side: LabRangeSide | null;
  /** Why it is out: the lab's own flag, or the value against the lab's printed range. */
  basis: "lab_flag" | "printed_range" | null;
  /** The lab's own HIGH/LOW flag on the latest reading (a document reading only). */
  flag: LabRangeSide | null;
}

const FLAG_OUT = new Set(["high", "low", "abnormal", "critical"]);

// A reading with a document behind it. Weigh-ins, home blood pressure and wearable
// series are assembled without one (src/repo/health.ts getMarkerHistory,
// src/repo/propagation.ts wearableFitnessMarkers).
function fromDocument(latest: any): boolean {
  const id = latest?.doc_id;
  return id != null && id !== "";
}

// The value against the lab's printed interval: a side when outside it, "within" when
// inside it, null when there is no printed interval to compare with.
function printedRangeSide(marker: any): LabRangeSide | "within" | null {
  if (marker?.reference_source !== "source_lab") return null;
  const value = finite(marker?.latest?.value);
  if (value == null) return null;
  const high = finite(marker?.reference?.high);
  const low = finite(marker?.reference?.low);
  if (high == null && low == null) return null;
  if (high != null && value > high) return "high";
  if (low != null && value < low) return "low";
  return "within";
}

export function labRangeRead(marker: unknown): LabRangeRead {
  const m = marker as any;
  const latest = m?.latest;
  if (!latest || !fromDocument(latest)) return { state: "unranged", side: null, basis: null, flag: null };
  const rawFlag = String(latest.flag ?? "")
    .trim()
    .toLowerCase();
  const flag: LabRangeSide | null = rawFlag === "high" || rawFlag === "low" ? rawFlag : null;
  const printed = printedRangeSide(m);
  if (FLAG_OUT.has(rawFlag)) {
    const side = flag ?? (printed === "high" || printed === "low" ? printed : null);
    return { state: "out", side, basis: "lab_flag", flag };
  }
  if (printed === "high" || printed === "low") return { state: "out", side: printed, basis: "printed_range", flag };
  if (printed === "within" || rawFlag === "normal") return { state: "within", side: null, basis: null, flag };
  return { state: "unranged", side: null, basis: null, flag };
}

/** The fields a marker DTO carries so no client re-derives the rule. */
export function labRangeFields(marker: unknown): {
  lab_range: LabRangeState;
  lab_out_of_range: boolean;
  lab_out_of_range_side: LabRangeSide | null;
} {
  const read = labRangeRead(marker);
  return { lab_range: read.state, lab_out_of_range: read.state === "out", lab_out_of_range_side: read.side };
}
