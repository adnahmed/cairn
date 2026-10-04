// Request-scoped memoization for the pure deterministic reads one request asks for
// over and over with the same arguments. A single Today open used to rebuild the same
// profile row thousands of times, the same day's HR model hundreds of times, and the
// same day's harm evidence hundreds of times, because every engine (the run plan, the
// race ladder, the agenda, the program state) re-derives its inputs on its own.
//
// The memo lives in the brain snapshot scope (src/brain/snapshot.ts) that server.ts
// opens around every /api and /mcp request, so nothing here outlives a request — and
// outside a scope (the scheduler, the tests, a script) every call computes, exactly
// as before.
//
// An entry is served only while it is provably the same answer a recompute would give:
//   • the SQLite connection's total_changes() odometer has not moved since the entry
//     was read. There is one connection in the process and node:sqlite is synchronous,
//     so an unmoved odometer means not one row was inserted, updated or deleted — by
//     this request, a scheduler tick, or anything else — since the value was computed.
//     The odometer is read BEFORE the compute, so a read that itself writes is never
//     served from the memo afterwards;
//   • no ROLLBACK has run on the connection since (sqliteRollbackCount, db.ts). The
//     odometer counts rows a rollback undoes and never goes back down, so a value
//     read after a write inside a savepoint that is then rolled back (an exercise row
//     findOrCreateExercise made for a Garmin import that later threw) would otherwise
//     survive naming rows that no longer exist;
//   • the request's device zone is the one it was read under;
//   • it is younger than MAX_AGE_MS, so work an in-scope background job does long
//     after the request (it inherits the async context) reads its own clock;
//   • a value whose compute consulted a RE-ENTRANCY GUARD (the race ladder's walk, run
//     compliance composing its prescription) — directly, or through a memo it hit — is
//     served only under the same guard state, because those reads deliberately answer
//     differently when asked from inside themselves.
// Every hit hands back a copy (`copy`), so a caller that mutates what it was given can
// never change what the next caller reads.
import type { StatementSync } from "node:sqlite";
import { db, sqliteRollbackCount } from "../db.js";
import { activeSnapshotMemos } from "../brain/snapshot.js";
import { activeTimeZone } from "../tz.js";
import { raceLadderWalkGuard } from "./race-ladder-hook.js";

const MAX_AGE_MS = 60_000;

type MemoEntry = {
  gen: number;
  rollbacks: number;
  tz: string | undefined;
  at: number;
  guard: string | null;
  value: unknown;
};

type ReentrancyGuard = () => { active: boolean; reads: number };
const guards: ReentrancyGuard[] = [raceLadderWalkGuard];
// Guard reads replayed by memo hits on guard-dependent values, so an enclosing compute
// that hit one is itself recorded as guard-dependent.
let replayedGuardReads = 0;

/** A module with a re-entrancy guard registers it here (see the header). */
export function registerMemoGuard(guard: ReentrancyGuard): void {
  guards.push(guard);
}

function guardReads(): number {
  let n = replayedGuardReads;
  for (const guard of guards) n += guard().reads;
  return n;
}

function guardState(): string {
  let state = "";
  for (const guard of guards) state += guard().active ? "1" : "0";
  return state;
}

let changesStatement: StatementSync | null = null;
// Row changes made inside memoNeutralWrite — subtracted from the odometer (see there).
let neutralChanges = 0;

function totalChanges(): number | null {
  try {
    changesStatement ??= db.prepare(`SELECT total_changes() AS n`) as unknown as StatementSync;
    const n = (changesStatement.get() as { n?: unknown } | undefined)?.n;
    return typeof n === "number" ? n : typeof n === "bigint" ? Number(n) : null;
  } catch {
    changesStatement = null;
    return null;
  }
}

function writeOdometer(): number | null {
  const n = totalChanges();
  return n == null ? null : n - neutralChanges;
}

/**
 * Run a bookkeeping write that no request-memoized read can see — today exactly two:
 * the coach context stamping `memory.last_referenced_at` on the rows it surfaced
 * (memory.ts), and the week-ahead card queueing its refresh job's `agent_jobs` row
 * (chat.ts createWeekAheadAgentJob). Every row it changes (its triggers included) is
 * left off the odometer, so such a write, landing midway through a Today open, does
 * not throw away every read memoized before it. A write that ANY requestMemo'd read
 * could consult must never run through here.
 */
export function memoNeutralWrite<T>(write: () => T): T {
  const before = totalChanges();
  try {
    return write();
  } finally {
    const after = totalChanges();
    if (before != null && after != null) neutralChanges += after - before;
  }
}

function entryIsFresh(entry: MemoEntry, gen: number, rollbacks: number, tz: string | undefined, now: number): boolean {
  return entry.gen === gen && entry.rollbacks === rollbacks && entry.tz === tz && now - entry.at < MAX_AGE_MS;
}

/**
 * `compute()` once per request for `key` while nothing has been written, handing every
 * caller its own `copy` of the value. `key` must name every argument the read depends on.
 */
export function requestMemo<T>(key: string, compute: () => T, copy: (value: T) => T): T {
  const memos = activeSnapshotMemos();
  if (!memos) return compute();
  const gen = writeOdometer();
  if (gen == null) return compute();
  const rollbacks = sqliteRollbackCount();
  const tz = activeTimeZone();
  const now = Date.now();
  // The common case first, before any per-call allocation: a guard-independent value
  // lives under the key itself. (The guards are plain reads of module state, so asking
  // for their state only after this lookup changes nothing.)
  const plain = memos.get(key) as MemoEntry | undefined;
  if (plain !== undefined && plain.guard === null && entryIsFresh(plain, gen, rollbacks, tz, now))
    return copy(plain.value as T);
  // A guard-dependent value lives under the key plus the guard state it was computed
  // in, so the two states never evict each other.
  const state = guardState();
  const guardedKey = `${key}\u0001${state}`;
  const guarded = memos.get(guardedKey) as MemoEntry | undefined;
  if (guarded !== undefined && entryIsFresh(guarded, gen, rollbacks, tz, now) && guarded.guard === state) {
    replayedGuardReads++;
    return copy(guarded.value as T);
  }
  const readsBefore = guardReads();
  const value = compute();
  const guard = guardReads() === readsBefore ? null : state;
  memos.set(guard === null ? key : guardedKey, { gen, rollbacks, tz, at: now, guard, value } satisfies MemoEntry);
  return copy(value);
}

/**
 * Copy for a value that is a flat row (primitives only) or null. A row node:sqlite
 * returns has a null prototype, and its copy keeps it.
 */
export function copyFlat<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  return (
    Object.getPrototypeOf(value) === null ? Object.assign(Object.create(null), value) : { ...(value as object) }
  ) as T;
}

/** Copy for an array of flat rows. */
export function copyRows<T>(value: T): T {
  return Array.isArray(value) ? (value.map((row) => copyFlat(row)) as T) : value;
}

/**
 * Copy for any structured-cloneable value — the same result structuredClone gives
 * (shared and cyclic references preserved, Maps/Sets/Dates rebuilt), walked directly
 * for the plain objects and arrays these reads return, which is several times cheaper
 * than structuredClone's serialize-and-revive on a hot memo hit. Anything else
 * (a typed array, a class instance) is handed to structuredClone itself.
 */
export function copyDeep<T>(value: T): T {
  return value && typeof value === "object" ? (cloneValue(value, new Map()) as T) : value;
}

function cloneValue(value: unknown, seen: Map<object, unknown>): unknown {
  if (value === null || typeof value !== "object") return value;
  const known = seen.get(value);
  if (known !== undefined) return known;
  if (Array.isArray(value)) {
    const out: unknown[] = new Array(value.length);
    seen.set(value, out);
    for (let i = 0; i < value.length; i++) if (i in value) out[i] = cloneValue(value[i], seen);
    return out;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto === Object.prototype || proto === null) {
    const out: Record<string, unknown> = proto === null ? Object.create(null) : {};
    seen.set(value, out);
    for (const key of Object.keys(value)) {
      const copied = cloneValue((value as Record<string, unknown>)[key], seen);
      // An own "__proto__" key (JSON.parse makes them) must stay a key, not a prototype.
      if (key === "__proto__")
        Object.defineProperty(out, key, { value: copied, enumerable: true, writable: true, configurable: true });
      else out[key] = copied;
    }
    return out;
  }
  if (value instanceof Map) {
    const out = new Map();
    seen.set(value, out);
    for (const [k, v] of value) out.set(cloneValue(k, seen), cloneValue(v, seen));
    return out;
  }
  if (value instanceof Set) {
    const out = new Set();
    seen.set(value, out);
    for (const v of value) out.add(cloneValue(v, seen));
    return out;
  }
  if (value instanceof Date) {
    const out = new Date(value.getTime());
    seen.set(value, out);
    return out;
  }
  const out = structuredClone(value);
  seen.set(value, out);
  return out;
}

/**
 * A memo key for structured arguments: plain objects, arrays and primitives only.
 * Every value is tagged by type (a string can never pass for `undefined`, NaN or an
 * infinity, which JSON would otherwise fold into null), and anything else — a Map, a
 * Date, a class instance, a function — returns null: the caller then computes without
 * the memo rather than risk two different inputs sharing a key.
 */
export function memoKey(value: unknown): string | null {
  try {
    return JSON.stringify(value, function (this: Record<string, unknown>, key: string) {
      // The holder's own value, before any toJSON() has rewritten it.
      const raw = this[key];
      if (raw === undefined) return "u";
      if (raw === null) return null;
      switch (typeof raw) {
        case "string":
          return `s${raw}`;
        case "number":
          return Number.isFinite(raw) ? raw : `n${raw}`;
        case "boolean":
          return raw;
        case "object": {
          if (Array.isArray(raw)) return raw;
          const proto = Object.getPrototypeOf(raw);
          if (proto === Object.prototype || proto === null) return raw;
          throw new Error("unkeyable");
        }
        default:
          throw new Error("unkeyable");
      }
    });
  } catch {
    return null;
  }
}
