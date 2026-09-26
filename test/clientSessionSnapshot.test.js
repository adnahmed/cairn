// The Session destination's warm instant paint (session-snapshot-client.ts): the last
// real paint for a date comes back only while the cached reads it was drawn from are
// untouched, so a faster first paint never shows another date or a pre-write surface.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function load() {
  const context = { JSON, Object, String };
  context.globalThis = context;
  vm.runInNewContext(readFileSync(join(root, "public/js/session-snapshot-client.js"), "utf8"), context);
  return context.CairnSessionSnapshot;
}

function memoryStore() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    data,
  };
}

function cache(entries) {
  const map = new Map(Object.entries(entries));
  return { peek: (key) => (map.has(key) ? { data: map.get(key) } : null), map };
}

const DATE = "2026-09-26";

test("a saved session paint comes back for the same date while its reads stand", () => {
  const snap = load();
  const store = memoryStore();
  const { peek } = cache({ [`today:session:${DATE}`]: { id: 1, sets: [] }, plan: [{ day_number: 1 }] });
  snap.save(store, DATE, "<div class='sess-dest'>Pull</div>", peek);
  assert.equal(snap.load(store, DATE, peek), "<div class='sess-dest'>Pull</div>");
});

test("never another date's paint", () => {
  const snap = load();
  const store = memoryStore();
  const { peek } = cache({ [`today:session:${DATE}`]: { id: 1 }, "today:session:2026-09-27": { id: 1 } });
  snap.save(store, DATE, "<p>yesterday</p>", peek);
  assert.equal(snap.load(store, "2026-09-27", peek), null);
});

test("a write that replaces or drops a read retires the paint", () => {
  const snap = load();
  const store = memoryStore();
  const { peek, map } = cache({ [`today:session:${DATE}`]: { id: 1, sets: [] } });
  snap.save(store, DATE, "<p>before the set</p>", peek);
  // A logged set primes a newer session (swrSet) — the old paint must not show.
  map.set(`today:session:${DATE}`, { id: 1, sets: [{ reps: 5 }] });
  assert.equal(snap.load(store, DATE, peek), null);
  // An invalidation drops the key altogether — no read, no paint.
  map.delete(`today:session:${DATE}`);
  assert.equal(snap.load(store, DATE, peek), null);
  // A swap touches the composed session or the plan: same rule.
  map.set(`today:session:${DATE}`, { id: 1, sets: [] });
  snap.save(store, DATE, "<p>fresh</p>", peek);
  map.set(`today:daily-session:${DATE}`, { items: [{ exercise: "Row" }] });
  assert.equal(snap.load(store, DATE, peek), null);
});

test("nothing to stamp against means nothing is kept, and a broken store never throws", () => {
  const snap = load();
  const store = memoryStore();
  store.setItem(snap.KEY, JSON.stringify({ date: DATE, stamp: "x", html: "<p>old</p>" }));
  snap.save(store, DATE, "<p>new</p>", () => null);
  assert.equal(store.getItem(snap.KEY), null, "an unstampable paint clears the old one");
  const broken = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  const { peek } = cache({ [`today:session:${DATE}`]: {} });
  assert.doesNotThrow(() => snap.save(broken, DATE, "<p/>", peek));
  assert.equal(snap.load(broken, DATE, peek), null);
  assert.equal(snap.load(null, DATE, peek), null);
});
