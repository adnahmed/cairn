// The doctor loop, one line per real follow-up.
//
// The attention schedule files a recheck under several signal families, each with its
// own provenance: the periodic marker cadence (`marker:<slug>`), a recheck the athlete
// Done'd from a directive (`directive-recheck:<slug>`), every follow-up a health review
// named (`review-followup:<slug>:<what>`), and the DEXA re-scan (`dexa:…`). Read raw,
// one lab draw shows up as many rows: a vitamin D recheck once per family and once more
// per review wording, a lipid panel once per lipid marker. Those rows stay as they are —
// each keeps its own cadence and history — and this module folds them at READ time into
// one item per panel: the MARKER_GROUPS group a marker belongs to (one draw covers the
// panel), or the marker itself when it sits in no clinical group, or the follow-up's own
// wording when it names no lab at all.
//
// The item keeps the representative row's attention fields (so `signal_key`/`next_due`
// consumers keep working) and adds the identity, a readable label, the earliest
// still-open due date, the newest evidence behind it, and every source row for
// provenance. Pure: rows in, items out — no DB, no clock.

import type { AttentionScheduleEntry, AttentionTier } from "./attention.js";
import { followupLabel, markerSlugFromSignalKey } from "./attention-labels.js";
import { markerGroup, markerGroupInText, markerGroupRank } from "./propagation-data.js";

export type DoctorLoopItemKind = "lab" | "dexa" | "review";

export interface DoctorLoopSourceRef {
  signal_key: string;
  source: string;
  tier: AttentionTier;
  next_due: string | null;
  last_checked: string;
}

export interface DoctorLoopEvidence {
  date: string;
  signal_key: string;
  source: string;
  reason: string;
}

export interface DoctorLoopItem extends AttentionScheduleEntry {
  key: string; // stable identity: "panel:<group>", "marker:<slug>", "followup:<what>"
  label: string;
  kind: DoctorLoopItemKind;
  group: { key: string; label: string } | null;
  markers: string[]; // display names of the markers this follow-up covers
  due: boolean; // the window is open as of the read
  latest_evidence: DoctorLoopEvidence | null;
  sources: DoctorLoopSourceRef[];
  source_count: number;
}

// The signal families that ARE the doctor loop. Everything else filed in the health /
// body domains (a measurement nudge, a missed-prediction note) is another loop's row.
export const DOCTOR_LOOP_SIGNAL_PREFIXES = ["marker:", "directive-recheck:", "review-followup:", "dexa:"] as const;

export function isDoctorLoopSignal(signalKey: unknown): boolean {
  const key = String(signalKey ?? "");
  return DOCTOR_LOOP_SIGNAL_PREFIXES.some((p) => key.startsWith(p));
}

const DEXA_GROUP = { key: "body", label: "Body Composition" };
const DEXA_LABEL = "Body composition (DEXA)";

function titleFromSlug(slug: string): string {
  return String(slug || "")
    .replace(/[-:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface Identity {
  key: string;
  group: { key: string; label: string } | null;
  marker: string | null;
  kind: DoctorLoopItemKind;
}

// Which real follow-up one schedule row belongs to.
function identityOf(entry: AttentionScheduleEntry, labelForSlug: (slug: string) => string | null): Identity {
  const signalKey = entry.signal_key;
  if (signalKey.startsWith("dexa:")) return { key: "panel:body", group: DEXA_GROUP, marker: null, kind: "dexa" };
  const slug = markerSlugFromSignalKey(signalKey);
  if (slug) {
    const label = labelForSlug(slug) ?? titleFromSlug(slug);
    const group = markerGroup(label);
    if (group.key === "body") return { key: "panel:body", group, marker: label, kind: "dexa" };
    // A review's own follow-up reads as its action until a cadence row joins the panel.
    const kind: DoctorLoopItemKind = signalKey.startsWith("review-followup:") ? "review" : "lab";
    if (group.key !== "other") return { key: `panel:${group.key}`, group, marker: label, kind };
    // markerGroup is a substring match over marker NAMES, so a directive or review filed
    // on the panel itself ("Lipid panel") reads as no group. The prose matcher knows the
    // panel words, so the row joins the panel its cadence rows fold into — as the panel,
    // not as one more marker name in the label.
    const panel = markerGroupInText(label);
    if (panel) return { key: `panel:${panel.key}`, group: panel, marker: null, kind };
    return { key: `marker:${slug}`, group: null, marker: label, kind };
  }
  if (signalKey.startsWith("review-followup:")) {
    // A follow-up that named no known marker. When its words name exactly one lab panel
    // ("Retest lipid panel") it is that panel's recheck; otherwise it stands on its own,
    // keyed by its wording so two different follow-ups never swallow each other.
    const what = signalKey.split(":").slice(2).join(":") || signalKey;
    const group = markerGroupInText(`${followupLabel(entry.reason) ?? ""} ${what.replace(/-/g, " ")}`);
    if (group) return { key: `panel:${group.key}`, group, marker: null, kind: "review" };
    return { key: `followup:${what}`, group: null, marker: null, kind: "review" };
  }
  return { key: signalKey, group: null, marker: null, kind: "lab" };
}

// "ApoB" · "ApoB and LDL-C" · "ApoB, LDL-C and HDL-C" · "ApoB, LDL-C, HDL-C and 2 more"
function joinMarkers(markers: string[]): string {
  if (markers.length <= 1) return markers[0] ?? "";
  if (markers.length <= 3) return `${markers.slice(0, -1).join(", ")} and ${markers[markers.length - 1]}`;
  return `${markers.slice(0, 3).join(", ")} and ${markers.length - 3} more`;
}

// Distinct review wordings: "Retest ferritin" · "Retest ferritin; Check B12 after
// metformin" · "Retest ferritin; Check B12 after metformin and 1 more".
function joinWordings(wordings: string[]): string {
  if (wordings.length <= 2) return wordings.join("; ");
  return `${wordings.slice(0, 2).join("; ")} and ${wordings.length - 2} more`;
}

function pushDistinct(list: string[], value: string | null | undefined): void {
  if (value && !list.some((x) => x.toLowerCase() === value.toLowerCase())) list.push(value);
}

// Earliest open due first; an undated row after every dated one.
function byDue(a: AttentionScheduleEntry, b: AttentionScheduleEntry): number {
  if (a.next_due && !b.next_due) return -1;
  if (!a.next_due && b.next_due) return 1;
  return String(a.next_due ?? "").localeCompare(String(b.next_due ?? ""));
}

// The row that speaks for a follow-up: the soonest due, the fresher evidence on a tie.
function bySoonest(a: AttentionScheduleEntry, b: AttentionScheduleEntry): number {
  return (
    byDue(a, b) ||
    String(b.last_checked ?? "").localeCompare(String(a.last_checked ?? "")) ||
    a.signal_key.localeCompare(b.signal_key)
  );
}

export interface CollapseDoctorLoopOptions {
  asOf: string;
  // Display name for a marker slug ("vitamin-d" → "Vitamin D"); null falls back to a
  // title built from the slug.
  labelForSlug?: (slug: string) => string | null;
}

export function collapseDoctorLoop(
  entries: readonly AttentionScheduleEntry[],
  opts: CollapseDoctorLoopOptions
): DoctorLoopItem[] {
  const labelForSlug = opts.labelForSlug ?? (() => null);
  const groups = new Map<string, { identity: Identity; rows: AttentionScheduleEntry[]; markers: string[] }>();
  const seenSignals = new Set<string>();
  for (const entry of entries) {
    // Released rows have run their course; they never bring a follow-up back.
    if (!entry || entry.tier === "released" || !isDoctorLoopSignal(entry.signal_key)) continue;
    if (seenSignals.has(entry.signal_key)) continue;
    seenSignals.add(entry.signal_key);
    const identity = identityOf(entry, labelForSlug);
    const acc = groups.get(identity.key) ?? { identity, rows: [], markers: [] };
    acc.rows.push(entry);
    // A kind learned from a cadence row outranks a review-only read of the same panel.
    if (acc.identity.kind === "review" && identity.kind !== "review")
      acc.identity = { ...acc.identity, kind: identity.kind };
    if (!acc.identity.group && identity.group) acc.identity = { ...acc.identity, group: identity.group };
    groups.set(identity.key, acc);
  }

  const items: DoctorLoopItem[] = [];
  for (const [key, { identity, rows }] of groups) {
    rows.sort(bySoonest);
    const rep = rows[0];
    // The label names only what is actually open at the item's date: everything due by
    // the read when the window is open, else what falls due with the soonest row. The
    // full list stays on `markers` / `sources`, so a surveillance row a year out never
    // reads as "due" just because a sibling in its panel is.
    const dueBy = rep.next_due && rep.next_due > opts.asOf ? rep.next_due : opts.asOf;
    const openNow = (row: AttentionScheduleEntry) => !rep.next_due || (!!row.next_due && row.next_due <= dueBy);
    const markers: string[] = [];
    const labelMarkers: string[] = [];
    const wordings: string[] = [];
    for (const row of rows) {
      const m = identityOf(row, labelForSlug).marker;
      pushDistinct(markers, m);
      if (!openNow(row)) continue;
      pushDistinct(labelMarkers, m);
      if (row.signal_key.startsWith("review-followup:")) pushDistinct(wordings, followupLabel(row.reason));
    }
    const newest = rows.reduce((best, row) =>
      String(row.last_checked ?? "") > String(best.last_checked ?? "") ? row : best
    );
    const kind: DoctorLoopItemKind = identity.kind;
    const label =
      kind === "dexa"
        ? DEXA_LABEL
        : kind === "review"
          ? joinWordings(wordings) || (followupLabel(rep.reason) ?? "Lab follow-up from your last review")
          : joinMarkers(labelMarkers.length ? labelMarkers : markers) || identity.group?.label || titleFromSlug(key);
    items.push({
      ...rep,
      key,
      label,
      kind,
      group: identity.group,
      markers,
      due: !!rep.next_due && rep.next_due <= opts.asOf,
      latest_evidence: newest.last_checked
        ? {
            date: String(newest.last_checked).slice(0, 10),
            signal_key: newest.signal_key,
            source: newest.source,
            reason: newest.reason,
          }
        : null,
      sources: rows.map((row) => ({
        signal_key: row.signal_key,
        source: row.source,
        tier: row.tier,
        next_due: row.next_due,
        last_checked: row.last_checked,
      })),
      source_count: rows.length,
    });
  }
  // Soonest first; within a date, the clinical panel order the doctor export uses.
  return items.sort(
    (a, b) =>
      byDue(a, b) ||
      markerGroupRank(a.group?.key ?? "other") - markerGroupRank(b.group?.key ?? "other") ||
      a.label.localeCompare(b.label)
  );
}
