// Shared attention-schedule label helpers — used by BOTH the forward timeline
// (Train's "road ahead") and the next-checkup read (Stand's doctor loop) so the two
// surfaces describe the same recheck signal with the same words, and dedupe it the
// same way. Pure/offline; null-safe on any input.

import { matchOptimalZone, OPTIMAL_ZONES } from "./propagation-data.js";

// A review-followup row's signal_key is machinery ("review-followup:hs-crp:…"); the
// human action lives in its reason ("Health review follow-up: Recheck hs-CRP (when
// rested…)"). Return that action as a label — minus the "Health review follow-up:"
// prefix and any trailing timing parenthetical — so two different follow-ups read as
// their two different actions instead of one generic "Lab follow-up" line. Null when
// there's nothing usable left.
export function followupLabel(reason: unknown): string | null {
  const core = String(reason ?? "")
    .replace(/^\s*health review follow-up:\s*/i, "")
    .replace(/\s*\([^)]*\)\s*\.?\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!core) return null;
  return core.length > 90 ? `${core.slice(0, 89).trimEnd()}...` : core;
}

// The sentinel slug a review follow-up is filed under when it matches no real marker
// (doctor-loop's applyReviewFollowups falls back to the label "lab follow-up" →
// signalSlug "lab-follow-up"). It is NOT a marker identity — many unrelated follow-ups
// ("Repeat sleep study", "Repeat colonoscopy") share it — so it must never be a dedupe
// key, or one would silently drop the other.
const FOLLOWUP_SENTINEL_SLUG = "lab-follow-up";

// The marker slug an attention signal_key is about — for MARKER-LEVEL dedupe across
// the periodic cadence recheck (`marker:<slug>`) and any review follow-ups on that
// same marker (`review-followup:<slug>:<what>`), which otherwise render as two entries
// for one marker. Null for non-marker signals (dexa, add-ons) AND for a sentinel
// non-marker follow-up, so callers fall back to the FULL signal_key and distinct
// follow-ups both survive; a real-marker follow-up still dedupes against its cadence row.
export function markerSlugFromSignalKey(key: unknown): string | null {
  const s = String(key ?? "");
  if (s.startsWith("marker:")) return s.slice("marker:".length) || null;
  // A directive-sourced recheck ("directive-recheck:<slug>") is filed under the SAME
  // marker slug as the periodic cadence, so it dedupes into one recheck story.
  if (s.startsWith("directive-recheck:")) return s.slice("directive-recheck:".length) || null;
  if (s.startsWith("review-followup:")) {
    const slug = s.split(":")[1] || null;
    return slug === FOLLOWUP_SENTINEL_SLUG ? null : slug;
  }
  return null;
}

// The same slug rule the doctor loop files marker keys under (doctor-loop.ts
// signalSlug): lower-case, every run of non-alphanumerics one dash.
function slugOf(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Every OPTIMAL_ZONES label and key, by its slug, so a key's slug reads back as the
// marker's canonical display name ("hs-crp" -> "hs-CRP", "lp-a" -> "Lp(a)").
// First writer wins: the zone table's order is its precedence.
const ZONE_LABEL_BY_SLUG: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const zone of OPTIMAL_ZONES) if (!map.has(slugOf(zone.label))) map.set(slugOf(zone.label), zone.label);
  for (const zone of OPTIMAL_ZONES) for (const key of zone.keys) if (!map.has(slugOf(key))) map.set(slugOf(key), zone.label);
  return map;
})();

// A marker attention slug ("hs-crp", "vitamin-d", "ldl-c") as a person reads it, in
// the marker's canonical display casing — never title-cased machinery like "Hs Crp".
// An exact zone label/key slug first, then the zone matcher over the spaced words, and
// only for a marker the zone table does not know, the slug's own words with a capital
// first letter. Null for the non-marker follow-up sentinel and for an empty slug.
export function markerLabelFromSlug(slug: unknown): string | null {
  const raw = slugOf(slug);
  if (!raw || raw === FOLLOWUP_SENTINEL_SLUG) return null;
  const exact = ZONE_LABEL_BY_SLUG.get(raw);
  if (exact) return exact;
  const spaced = raw.replace(/-+/g, " ");
  const zone = matchOptimalZone(spaced);
  if (zone) return zone.label;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// The lab or scan a doctor-loop attention row is about, by its display name: the
// marker's canonical name for a marker cadence / directive recheck / marker-named
// review follow-up, "DEXA scan" for the body-composition re-scan, and null for
// anything that is not a doctor-loop row or names no marker (a sentinel follow-up).
export function labRecheckLabel(signalKey: unknown): string | null {
  const key = String(signalKey ?? "");
  if (key.startsWith("dexa:")) return "DEXA scan";
  return markerLabelFromSlug(markerSlugFromSignalKey(key));
}
