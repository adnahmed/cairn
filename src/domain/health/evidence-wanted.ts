// Evidence wanted — the ONE piece of evidence the team would find most useful right now,
// as a single calm line, or nothing.
//
// Pull, never push: the read waits on the page that asks for it; nothing here notifies,
// schedules or counts. At most one item, so an athlete with three overdue rechecks reads
// one sentence, never a list of debts. Absence is neutral — no item is the common answer.
//
// It reads the signals Cairn already keeps, in this order, and takes the first that fires:
//   1. an overdue doctor-loop follow-up (`doctorLoopRead`, one item per panel already,
//      soonest-due first) — the recheck cadence the attention engine keeps;
//   2. a body-composition directive whose scan has aged while the weight moved
//      (`rescan_reason`, annotateDirectiveFreshness in src/repo/propagation.ts);
//   3. a lab-flagged or off-optimal reading past the window where its own kind of marker
//      still describes the person (`readingPastValidity`, src/repo/marker-validity.ts) —
//      never a genetic marker, which never ages out.
//
// Informational, never medical advice: a fresh reading would sharpen the picture, and
// nothing waits on it.

import type { ClientEvidenceWanted, ClientEvidenceWantedRead } from "../../contracts/health-records.js";
import { formatReportDate } from "../../reportDates.js";
import { listDirectives } from "../../repo/directives.js";
import { doctorLoopRead } from "../../repo/doctor-loop.js";
import type { DoctorLoopItem } from "../../repo/doctor-loop-items.js";
import { markerValidityClass, readingAgeDays, readingPastValidity } from "../../repo/marker-validity.js";
import { markerGroupRank } from "../../repo/propagation-data.js";
import { annotateDirectiveFreshness, prioritizeMarkers } from "../../repo/propagation.js";
import { localDateISO } from "../../repo/shared.js";
import { isoDate } from "../../lib/dates.js";

export type EvidenceWanted = ClientEvidenceWanted;
export type EvidenceWantedRead = ClientEvidenceWantedRead;

export const EVIDENCE_WANTED_FRAME =
  "One piece of evidence the team would find useful, whenever it suits you. Nothing waits on it. Informational, not medical advice.";

// The calendar day a stored date or timestamp names, validated.
const dayOf = (value: unknown): string | null => isoDate(String(value ?? "").slice(0, 10));

function lastOne(date: string | null): string {
  return date ? ` — the last one is from ${formatReportDate(date)}` : "";
}

function fromLoop(item: DoctorLoopItem): EvidenceWanted {
  const since = dayOf(item.latest_evidence?.date);
  if (item.kind === "dexa") {
    return {
      key: item.key,
      kind: "rescan",
      label: "Body composition scan",
      line: `When it suits you, a repeat body-composition scan would help the team${lastOne(since)}.`,
      since,
    };
  }
  if (item.kind === "review") {
    return {
      key: item.key,
      kind: "recheck",
      label: item.label,
      line: `When it suits you, the follow-up your last review named (${item.label}) would help the team.`,
      since,
    };
  }
  return {
    key: item.key,
    kind: "recheck",
    label: item.label,
    line: `When it suits you, a fresh ${item.label} reading would help the team${lastOne(since)}.`,
    since,
  };
}

function overdueLoopItem(asOf: string): DoctorLoopItem | null {
  try {
    // Already one item per real follow-up, soonest-due first.
    return doctorLoopRead({ asOf }).attention.find((item) => item.due) ?? null;
  } catch {
    return null;
  }
}

function staleScan(): EvidenceWanted | null {
  try {
    const d = (annotateDirectiveFreshness(listDirectives() as any[]) as any[]).find(
      (x) => x?.stale_measurement && x?.rescan_reason
    );
    if (!d) return null;
    const since = dayOf(d.trigger_date);
    return {
      key: `rescan:${String(d.marker ?? "body-composition")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")}`,
      kind: "rescan",
      label: "Body composition scan",
      line: "When it suits you, a fresh body-composition scan would help the team — your weight has moved since the last one.",
      since,
    };
  } catch {
    return null;
  }
}

function agedFinding(asOf: string): EvidenceWanted | null {
  try {
    const markers = ((prioritizeMarkers() as any)?.markers ?? []) as any[];
    const aged = markers
      .filter((m) => {
        const name = String(m?.name ?? "");
        const flagged = m?.latest?.flag === "high" || m?.latest?.flag === "low";
        if (!name || !(flagged || m?.in_optimal === false)) return false;
        if (markerValidityClass(name) === "genetic") return false;
        return readingPastValidity(name, readingAgeDays(dayOf(m?.latest?.date), asOf));
      })
      .sort(
        (a, b) =>
          markerGroupRank(String(a?.group ?? "other")) - markerGroupRank(String(b?.group ?? "other")) ||
          String(a?.name).localeCompare(String(b?.name))
      );
    const m = aged[0];
    if (!m) return null;
    const name = String(m.name);
    const since = dayOf(m?.latest?.date);
    return {
      key: `aging:${String(m.key ?? name).toLowerCase()}`,
      kind: "recheck",
      label: name,
      line: `When it suits you, a fresh ${name} reading would help the team${lastOne(since)}.`,
      since,
    };
  } catch {
    return null;
  }
}

/** At most one calm line; null when nothing is overdue. Read-only. */
export function evidenceWantedRead(opts: { asOf?: string } = {}): EvidenceWantedRead {
  const asOf = dayOf(opts.asOf) ?? localDateISO();
  const loop = overdueLoopItem(asOf);
  const item = loop ? fromLoop(loop) : (staleScan() ?? agedFinding(asOf));
  return { as_of: asOf, item, frame: EVIDENCE_WANTED_FRAME };
}
