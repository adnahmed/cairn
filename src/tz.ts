// Request/turn-scoped timezone — the "one local clock that follows the device".
//
// The home server has its own configured TZ (process.env.TZ), but when the owner
// travels their phone moves to another zone. The PWA sends its live IANA zone as
// the X-Cairn-TZ header; a tiny middleware runs each request inside this store so
// everything downstream that frames "local" (localDateISO / nowContext / the
// chat + log timestamps) follows the device — WITHOUT touching the server's own
// TZ. Logs are still stored as UTC instants; only the framing moves.
//
// AsyncLocalStorage carries the zone across awaits with no param-threading. Code
// reached OUTSIDE a request (the scheduler, the enrichment queue, tests) simply
// finds no active zone and falls back to system-local — i.e. exactly today's
// behavior. The chat worker is the one async-after-the-request path, so it
// re-establishes the captured zone explicitly (see chatTurns.ts).
import { AsyncLocalStorage } from "node:async_hooks";

const als = new AsyncLocalStorage<{ tz?: string }>();

// Run fn with a device timezone in scope. An absent/invalid zone → no override
// (system-local), so callers can pass an untrusted header straight through.
export function runWithTimeZone<T>(tz: string | null | undefined, fn: () => T): T {
  const valid = isValidTimeZone(tz) ? tz : undefined;
  return als.run({ tz: valid }, fn);
}

// The active device zone, or undefined when none is in scope (→ system-local).
export function activeTimeZone(): string | undefined {
  return als.getStore()?.tz;
}

// Validate an IANA zone WITHOUT trusting client input — Intl throws RangeError on
// an unknown zone. Length-capped so a junk header can't be abused. Never used in
// SQL or a shell, so validity is the only concern.
// The answer for a given string never changes within a process (the zone data is
// fixed), and the same zone is checked many times a request, so it is remembered.
const ZONE_VALIDITY_CACHE_MAX = 64;
const zoneValidity = new Map<string, boolean>();

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) return false;
  const known = zoneValidity.get(tz);
  if (known !== undefined) return known;
  let valid: boolean;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    valid = true;
  } catch {
    valid = false;
  }
  if (zoneValidity.size >= ZONE_VALIDITY_CACHE_MAX) zoneValidity.clear();
  zoneValidity.set(tz, valid);
  return valid;
}
