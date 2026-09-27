import assert from "node:assert/strict";
import test from "node:test";
import { saveDayRead, invalidateDayRead } from "../dist/repo/day-read-cache.js";
import { planForwardAllowed } from "../dist/repo/today-agenda.js";
import { localDateISO } from "../dist/repo/shared.js";

const read = (kind) => ({ kind, headline: "A steady day.", why: "Synthetic agent wording.", source: "agent", signals: {} });

test("a stale training read keeps plan-forward cards while its recompute is pending", () => {
  const today = localDateISO();
  saveDayRead(today, read("train"));
  assert.equal(planForwardAllowed(today), true);
  invalidateDayRead(today);
  assert.equal(planForwardAllowed(today), true, "an Undo's stale mark must not hide the week ahead");
});

test("a stale rest read still holds plan-forward cards back", () => {
  const today = localDateISO();
  saveDayRead(today, read("rest"));
  invalidateDayRead(today);
  assert.equal(planForwardAllowed(today), false);
});

