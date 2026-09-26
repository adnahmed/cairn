// INCREMENTAL PRECACHE, driven through the real public/sw.js install/activate
// handlers in a vm with an in-memory CacheStorage and a counting fetch.
//
// A deploy that changes one bundle used to re-download the whole shell (every
// bundle, the fonts, xterm, every icon — ~1.3 MB over the wire) because install
// fetched everything with cache:"reload". Now: an unchanged file is copied out of
// the previous shell cache, the stable assets (fonts / vendor / icons) stay put
// in their own cache, and only the changed file crosses the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SOURCE = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

function assetList(name) {
  const body = new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`).exec(SOURCE)[1]
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  return [...body.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
}
const ALL = [...new Set([...assetList("CORE_ASSETS"), ...assetList("OPTIONAL_ASSETS")])];

class FakeResponse {
  constructor(body, init = {}) {
    this.body = String(body);
    this.status = init.status ?? 200;
    this.ok = this.status >= 200 && this.status < 300;
  }
  async json() {
    return JSON.parse(this.body);
  }
  clone() {
    return new FakeResponse(this.body, { status: this.status });
  }
}
class FakeRequest {
  constructor(url, init = {}) {
    this.url = new URL(url, "http://cairn.local").href;
    this.cache = init.cache;
  }
}
const keyOf = (req) => new URL(typeof req === "string" ? req : req.url, "http://cairn.local").pathname;

function makeCacheStorage() {
  const stores = new Map();
  const open = async (name) => {
    if (!stores.has(name)) {
      const entries = new Map();
      stores.set(name, {
        entries,
        async match(req) {
          const hit = entries.get(keyOf(req));
          return hit ? hit.clone() : undefined;
        },
        async put(req, res) {
          entries.set(keyOf(req), res.clone());
        },
        async delete(req) {
          return entries.delete(keyOf(req));
        },
        async keys() {
          return [...entries.keys()].map((p) => new FakeRequest(p));
        },
      });
    }
    return stores.get(name);
  };
  return {
    stores,
    open,
    async keys() {
      return [...stores.keys()];
    },
    async delete(name) {
      return stores.delete(name);
    },
    async match(req) {
      for (const store of stores.values()) {
        const hit = await store.match(req);
        if (hit) return hit;
      }
      return undefined;
    },
  };
}

/** One deploy: the served worker for `version` with `hashes`, over the shared caches. */
async function deploy(caches, { version, hashes, content, fail = () => false }) {
  const fetched = [];
  const listeners = {};
  const body = SOURCE.split("cairn-shell-dev").join(version).split("/*cairn-asset-hashes*/ {}").join(JSON.stringify(hashes));
  const context = {
    URL,
    JSON,
    Promise,
    Set,
    Map,
    Error,
    Request: FakeRequest,
    Response: FakeResponse,
    caches,
    fetch: async (req) => {
      const path = keyOf(req);
      fetched.push({ path, cache: req.cache });
      return new FakeResponse(content(path), { status: fail(path) ? 500 : 200 });
    },
    setTimeout,
    self: {
      addEventListener: (type, fn) => {
        listeners[type] = fn;
      },
      skipWaiting() {},
      clients: { claim: async () => {} },
    },
  };
  vm.runInNewContext(body, context, { filename: "sw.js" });
  const run = async (type) => {
    let waited;
    listeners[type]({ waitUntil: (p) => (waited = p) });
    await waited;
  };
  await run("install");
  await run("activate");
  return fetched;
}


test("a first install downloads the whole shell; a one-file deploy downloads that file only", async () => {
  const caches = makeCacheStorage();
  const v1 = Object.fromEntries(ALL.map((url, i) => [url, String(i).padStart(12, "a")]));
  const first = await deploy(caches, { version: "cairn-000000000001", hashes: v1, content: (p) => `v1 ${p}` });
  assert.deepEqual(new Set(first.map((f) => f.path)), new Set(ALL));

  const v2 = { ...v1, "/js/bundle-03-capture.js": "bbbbbbbbbbbb" };
  const second = await deploy(caches, { version: "cairn-000000000002", hashes: v2, content: (p) => `v2 ${p}` });
  assert.deepEqual(second.map((f) => f.path), ["/js/bundle-03-capture.js"]);

  // The new shell cache holds every mutable asset: the changed one fresh, the rest copied.
  assert.deepEqual([...caches.stores.keys()].sort(), ["cairn-000000000002", "cairn-static-v1"]);
  const shell = caches.stores.get("cairn-000000000002");
  assert.equal((await shell.match("/js/bundle-03-capture.js")).body, "v2 /js/bundle-03-capture.js");
  assert.equal((await shell.match("/js/bundle-01-core.js")).body, "v1 /js/bundle-01-core.js");
  // Stable assets never moved.
  const stable = caches.stores.get("cairn-static-v1");
  assert.equal((await stable.match("/fonts/young-serif-latin-400.woff2")).body, "v1 /fonts/young-serif-latin-400.woff2");
  assert.equal(await shell.match("/fonts/young-serif-latin-400.woff2"), undefined);
});

test("a changed stable asset is re-downloaded; versioned icons may use the HTTP cache, the rest revalidate", async () => {
  const caches = makeCacheStorage();
  const v1 = Object.fromEntries(ALL.map((url, i) => [url, String(i).padStart(12, "c")]));
  const first = await deploy(caches, { version: "cairn-00000000000a", hashes: v1, content: (p) => `v1 ${p}` });
  const icon = first.find((f) => /\.v\d+\.png$/.test(f.path));
  assert.equal(icon.cache, "default");
  assert.equal(first.find((f) => f.path === "/styles.css").cache, "no-cache");

  const v2 = { ...v1, "/vendor/xterm.js": "dddddddddddd" };
  const second = await deploy(caches, { version: "cairn-00000000000b", hashes: v2, content: (p) => `v2 ${p}` });
  assert.deepEqual(second.map((f) => f.path), ["/vendor/xterm.js"]);
  assert.equal((await caches.stores.get("cairn-static-v1").match("/vendor/xterm.js")).body, "v2 /vendor/xterm.js");
});

test("a worker served without hashes (plain static server) still precaches everything", async () => {
  const caches = makeCacheStorage();
  await deploy(caches, { version: "cairn-0000000000f1", hashes: {}, content: (p) => `a ${p}` });
  const again = await deploy(caches, { version: "cairn-0000000000f2", hashes: {}, content: (p) => `b ${p}` });
  assert.deepEqual(new Set(again.map((f) => f.path)), new Set(ALL));
});

test("activate keeps the art and stable caches and prunes stable entries no longer listed", async () => {
  const caches = makeCacheStorage();
  const art = await caches.open("cairn-art-v1");
  await art.put("/api/art?kind=exercise&q=Squat", new FakeResponse("img"));
  const stable = await caches.open("cairn-static-v1");
  await stable.put("/icons/icon-192.v2.png", new FakeResponse("old icon"));
  const hashes = Object.fromEntries(ALL.map((url, i) => [url, String(i).padStart(12, "e")]));
  await deploy(caches, { version: "cairn-0000000000e1", hashes, content: (p) => `x ${p}` });
  assert.ok(caches.stores.has("cairn-art-v1"));
  assert.equal(await caches.stores.get("cairn-static-v1").match("/icons/icon-192.v2.png"), undefined);
});

test("an install that fails after replacing a stable file never pins its bytes under the old hash", async () => {
  const caches = makeCacheStorage();
  const v1 = Object.fromEntries(ALL.map((url, i) => [url, String(i).padStart(12, "f")]));
  await deploy(caches, { version: "cairn-0000000000c1", hashes: v1, content: (p) => `v1 ${p}` });

  // v2 changes xterm.js, but a required core file fails: the install never commits,
  // yet the SHARED stable cache already took v2's xterm.js bytes.
  const v2 = { ...v1, "/vendor/xterm.js": "999999999999", "/js/bundle-01-core.js": "888888888888" };
  await assert.rejects(
    deploy(caches, { version: "cairn-0000000000c2", hashes: v2, content: (p) => `v2 ${p}`, fail: (p) => p === "/js/bundle-01-core.js" })
  );

  // v3 reverts xterm.js to v1's bytes: it must be fetched again, not "already held".
  const third = await deploy(caches, { version: "cairn-0000000000c3", hashes: v1, content: (p) => `v1 ${p}` });
  assert.ok(third.some((f) => f.path === "/vendor/xterm.js"), "the struck entry is fetched again");
  assert.equal((await caches.stores.get("cairn-static-v1").match("/vendor/xterm.js")).body, "v1 /vendor/xterm.js");
});
