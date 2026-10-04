// Derived markers count as checked.
//
// Some markers are arithmetic over others a lab always prints together: non-HDL
// cholesterol IS total cholesterol minus HDL. A lab that prints the two components
// without the difference has still measured it — so a draw with TC and HDL on it is a
// non-HDL-C check, and the doctor loop must not keep the non-HDL-C recheck "open since"
// an older draw that happened to print the line.
//
// ONE place answers that, for every surface that says when a marker was last checked:
// the doctor-loop refresh files the attention row from this reading (so the attention
// schedule, the doctor loop and the next-checkup read all carry the same date), and the
// spoken "why" reads the same value. Deliberately narrow:
//   - only a marker that already has a REPORTED series is extended — a derivable marker
//     the athlete's labs have never printed never grows a new recheck row of its own;
//   - the derived reading supersedes the reported one only when its draw is strictly
//     NEWER (a same-day printed value always wins);
//   - every component must be numeric on the SAME draw date, in one compatible unit.
// The derived reading carries no lab flag, no printed reference range and no document
// id: the lab never stated it, so it is read against the optimal band only.
// Pure over the marker list it is handed (names resolve through marker-canon); idempotent —
// a second pass finds nothing newer to add.

import { isoDate } from "../lib/dates.js";
import { canonicalMarker } from "./marker-canon.js";
import { seriesUnitsCompatible } from "./lab-units.js";

interface DerivableMarker {
  label: string; // canonical display name of the derived marker
  components: readonly string[]; // canonical names of the markers it is computed from
  derive: (values: number[]) => number | null;
}

export const DERIVABLE_MARKERS: readonly DerivableMarker[] = [
  {
    label: "Non-HDL-C",
    components: ["Total Cholesterol", "HDL Cholesterol"],
    derive: ([tc, hdl]) => (tc > 0 && hdl > 0 && tc > hdl ? tc - hdl : null),
  },
];

interface MarkerSeriesLike {
  key?: string | null;
  name?: string | null;
  unit?: string | null;
  latest?: { date?: unknown } | null;
  points?: Array<{ date?: unknown; value?: unknown; unit_mismatch?: unknown }>;
}

function canonKey(m: MarkerSeriesLike): string {
  const name = String(m?.name ?? m?.key ?? "").trim();
  return name ? canonicalMarker(name).key : "";
}

/** A reading's day, from a date or a timestamp. */
function readingDay(v: unknown): string | null {
  return isoDate(String(v ?? "").slice(0, 10));
}

function findSeries(markers: MarkerSeriesLike[], name: string): MarkerSeriesLike | null {
  const key = canonicalMarker(name).key;
  return markers.find((m) => String(m?.key ?? "").toLowerCase() === key || canonKey(m) === key) ?? null;
}

function numericByDate(m: MarkerSeriesLike): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of Array.isArray(m.points) ? m.points : []) {
    const date = readingDay(p?.date);
    const value = Number(p?.value);
    if (date && Number.isFinite(value) && !p?.unit_mismatch) out.set(date, value);
  }
  return out;
}

export interface DerivedReading {
  label: string;
  date: string;
  value: number;
  unit: string | null;
  derived_from: string[];
}

// The newest draw on which every component of `spec` was measured, with the computed
// value — or null when no single draw carries them all in one compatible unit.
function newestDerivedReading(spec: DerivableMarker, markers: MarkerSeriesLike[]): DerivedReading | null {
  const series = spec.components.map((c) => findSeries(markers, c));
  if (series.some((s) => !s)) return null;
  const unit = series[0]?.unit ?? null;
  if (!series.every((s) => seriesUnitsCompatible(s?.unit ?? null, unit))) return null;
  const maps = series.map((s) => numericByDate(s as MarkerSeriesLike));
  const dates = [...maps[0].keys()].filter((d) => maps.every((m) => m.has(d))).sort();
  for (let i = dates.length - 1; i >= 0; i--) {
    const date = dates[i];
    const value = spec.derive(maps.map((m) => m.get(date) as number));
    if (value == null || !Number.isFinite(value)) continue;
    return {
      label: spec.label,
      date,
      value: Math.round(value * 10) / 10,
      unit,
      derived_from: series.map((s) => String(s?.name ?? "")),
    };
  }
  return null;
}

/**
 * The date a marker was last checked, counting a draw that measured all of its
 * components as a check of the derived marker itself. Null when nothing on file dates it.
 */
export function effectiveMarkerCheckDate(name: string, markers: MarkerSeriesLike[]): string | null {
  const own = findSeries(markers, name);
  const ownDate = own ? readingDay(own.latest?.date ?? own.points?.at(-1)?.date) : null;
  const key = canonicalMarker(name).key;
  const spec = DERIVABLE_MARKERS.find((d) => canonicalMarker(d.label).key === key);
  const derived = spec ? newestDerivedReading(spec, markers) : null;
  if (derived && (!ownDate || derived.date > ownDate)) return derived.date;
  return ownDate;
}

/**
 * The marker history with each derivable marker's series extended by the newest draw
 * that measured all of its components, when that draw is newer than the series' own
 * latest reading. Returns a new array; untouched markers are passed through as-is.
 */
export function withDerivedReadings<T extends MarkerSeriesLike>(markers: T[]): T[] {
  const list = Array.isArray(markers) ? markers : [];
  if (!list.length) return list;
  let out: T[] | null = null;
  for (const spec of DERIVABLE_MARKERS) {
    const idx = list.findIndex((m) => canonKey(m) === canonicalMarker(spec.label).key);
    if (idx < 0) continue; // never reported → no recheck row is invented for it
    const target = list[idx];
    const reading = newestDerivedReading(spec, list);
    if (!reading) continue;
    if (target.unit && reading.unit && !seriesUnitsCompatible(target.unit, reading.unit)) continue;
    const ownDate = readingDay(target.latest?.date ?? target.points?.at(-1)?.date);
    if (ownDate && reading.date <= ownDate) continue;
    const latest = {
      value: reading.value,
      date: reading.date,
      flag: null,
      doc_id: null,
      kind: "derived",
      derived_from: reading.derived_from,
    };
    const points = [
      ...(Array.isArray(target.points) ? target.points : []),
      { date: reading.date, value: reading.value, flag: null, doc_id: null, derived: true },
    ];
    const extended = {
      ...target,
      latest,
      prev: target.latest ?? null,
      points,
      // The lab's printed range belonged to the older printed reading, not this one.
      reference: null,
      reference_source: null,
      reference_source_url: null,
    } as T;
    out ??= [...list];
    out[idx] = extended;
  }
  return out ?? list;
}
