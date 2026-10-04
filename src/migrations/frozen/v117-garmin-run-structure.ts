// Frozen snapshot of src/repo/run-structure.ts's `normalizeSplitSummaries` and the
// sync's list-payload reads as of 2026-10-02; migrations must not track live code.
//
// WHY A COPY AND NOT AN IMPORT. A migration is a statement about what the ladder did on
// the day it shipped. Importing the live module means a fresh install replays that
// migration against TODAY's semantics. Do not "fix" a bug here: fix it in the live
// module and, if old rows need it, append a NEW migration.
//
// WHAT v117 BACKFILLS. Every synced activity's `raw_json` already carried the run's
// shape (`splitSummaries`: warm-up, work bouts, recoveries, walking), its
// grade-adjusted speed, its Body Battery change and its running dynamics — the sync
// stored them and nothing read them, and the running-dynamics columns were only ever
// written from a detail call that answered null. This fills the new columns, and the
// empty dynamics, from the payload already on disk. Only NULL columns are written, so a
// re-run touches nothing.

import type { DatabaseSync } from "node:sqlite";

const SPLIT_TYPE_KIND: Record<string, string> = {
  INTERVAL_WARMUP: "warmup",
  INTERVAL_ACTIVE: "work",
  INTERVAL_RECOVERY: "recovery",
  INTERVAL_REST: "rest",
  INTERVAL_COOLDOWN: "cooldown",
  RWD_RUN: "run",
  RWD_WALK: "walk",
  RWD_STAND: "stand",
};

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const r1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);
const r3 = (v: number | null) => (v == null ? null : Math.round(v * 1000) / 1000);

function segments(list: unknown): unknown[] | null {
  if (!Array.isArray(list)) return null;
  const out: unknown[] = [];
  for (const s of list as any[]) {
    const kind = SPLIT_TYPE_KIND[String(s?.splitType ?? "").toUpperCase()];
    if (!kind) continue;
    const secs = num(s?.duration);
    const bouts = Math.max(0, Math.trunc(num(s?.noOfSplits) ?? 0));
    if (!bouts || !secs || secs <= 0) continue;
    out.push({
      kind,
      bouts,
      secs: r1(secs),
      meters: r1(num(s?.distance)),
      ascent_m: r1(num(s?.totalAscent)),
      descent_m: r1(num(s?.elevationLoss)),
      avg_speed: r3(num(s?.averageSpeed)),
    });
  }
  return out.length ? out : null;
}

// Each target column paired with the list-payload field it reads. Only the columns the
// table actually has are written: a database old enough to predate v46's running
// dynamics simply has nothing there to fill.
const TARGETS: Array<[string, (a: any) => unknown]> = [
  ["structure_json", (a) => {
    const structure = segments(a.splitSummaries);
    return structure ? JSON.stringify(structure) : null;
  }],
  ["gap_speed", (a) => num(a.avgGradeAdjustedSpeed)],
  ["body_battery_delta", (a) => num(a.differenceBodyBattery)],
  ["avg_ground_contact_ms", (a) => num(a.avgGroundContactTime)],
  ["avg_vertical_osc_cm", (a) => num(a.avgVerticalOscillation)],
  ["avg_vertical_ratio", (a) => num(a.avgVerticalRatio)],
];

export function backfillGarminRunStructure(db: DatabaseSync): number {
  const present = new Set(
    (db.prepare(`PRAGMA table_info(garmin_activities)`).all() as Array<{ name: string }>).map((c) => c.name)
  );
  const targets = TARGETS.filter(([col]) => present.has(col));
  if (!present.has("raw_json") || !targets.length) return 0;
  const rows = db
    .prepare(
      `SELECT id, raw_json FROM garmin_activities
        WHERE raw_json IS NOT NULL AND (${targets.map(([col]) => `${col} IS NULL`).join(" OR ")})`
    )
    .all() as Array<{ id: number; raw_json: string }>;
  const update = db.prepare(
    `UPDATE garmin_activities SET ${targets.map(([col]) => `${col} = COALESCE(${col}, ?)`).join(", ")} WHERE id = ?`
  );
  let touched = 0;
  for (const row of rows) {
    let a: any;
    try {
      a = JSON.parse(row.raw_json);
    } catch {
      continue;
    }
    if (!a || typeof a !== "object") continue;
    const values = targets.map(([, read]) => read(a) as any);
    if (values.every((v) => v == null)) continue;
    update.run(...values, row.id);
    touched++;
  }
  return touched;
}
