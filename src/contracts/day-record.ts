// The day record contract (v2 wave 7, "Today is Home").
//
// Today only ever shows today. Any OTHER day is a read-only destination reached from a
// day in a week (Train's plan strip, the Train calendar, Horizon's week): a PAST day
// is its record — what was logged, and the read that stood that day — and a FUTURE day
// is its preview — the planned lift, the planned run, and anything already known to
// shape it. Nothing here is editable and nothing asks for a tap.
//
// Served by `GET /api/day-record?date=` (`get_day_record`), composed in
// src/domain/today/day-record.ts from reads that already exist (the session log, the
// activity feed, the day's intake, the cached day read, the plan week, the strength
// line, the life-context events). No score, no grade: words, logged numbers and
// kilometres (the client prints them in the athlete's run units).
//
// Self-contained: src/client/** reads these types through
// `import("../contracts/day-record.js")`.

/** Where the day sits against the server's local today. */
export type DayRecordRelation = "past" | "today" | "future";

/** One logged movement: its name, how many sets, and the top set in the log's own words ("185 × 5", "BW × 12", "1:30"). */
export interface DayRecordMovement {
  name: string;
  sets: number;
  best: string;
}

/** The day's strength session, off the log. */
export interface DayRecordSession {
  id: number;
  /** Content-true title (what was trained, not a stale plan-day label). */
  title: string;
  finished: boolean;
  sets: number;
  movements: DayRecordMovement[];
  /** Movements consciously skipped that day. */
  skipped: string[];
  notes: string | null;
}

/** A logged cardio effort (a run, a ride, a walk). */
export interface DayRecordActivity {
  id: number;
  title: string;
  /** Whether this effort is a run (the client prints its distance in run units). */
  run: boolean;
  distance_km: number | null;
  duration_min: number | null;
  pace: string | null;
  /** A calm deterministic line ("easy run"), or null. */
  note: string | null;
  source: string | null;
}

/** The day's logged food, summarized. Absent is absent, never "low". */
export interface DayRecordIntake {
  /** none | partial | complete — `classifyIntakeDay`'s own words. */
  coverage: "none" | "partial" | "complete";
  entries: number;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  /** The entries' own summaries, in eaten order ("Oats with berries"); `logged_at` only when a time was stated. */
  meals: { meal: string | null; summary: string; logged_at: string | null }[];
}

/** The day read that stood for the day (the Brief), when one was written. */
export interface DayRecordRead {
  kind: string;
  headline: string;
  why: string | null;
}

/** A future day's planned lift. */
export interface DayRecordPlannedLift {
  title: string;
  focus: string | null;
  purpose: string | null;
}

/** A future (or open) day's planned run. `km` is the engine's prescribed distance. */
export interface DayRecordPlannedRun {
  kind: string;
  label: string;
  km: number | null;
}

export interface DayRecord {
  date: string;
  relation: DayRecordRelation;
  /** The server's local today, so the client never decides the relation itself. */
  today: string;
  /** The athlete's run units; every distance travels in km. */
  run_units: "km" | "mi";

  // ---- past (and today): what the log holds ----
  session: DayRecordSession | null;
  activities: DayRecordActivity[];
  intake: DayRecordIntake | null;
  read: DayRecordRead | null;
  /** A weigh-in logged that day, in lb. */
  weight_lb: number | null;

  // ---- future (and today): what the calendar holds ----
  /** The planned lift, or null on a run/rest day. */
  lift: DayRecordPlannedLift | null;
  /** The planned run, or null. */
  run: DayRecordPlannedRun | null;
  /** Neither a lift nor a run is planned. */
  rest: boolean;
  /** Life-context events active that day, by title (a trip, an illness logged as context). */
  caveats: string[];

  /** One athlete-facing line that names the day ("A Pull day and an easy run."). */
  line: string;
}
