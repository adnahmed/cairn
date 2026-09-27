// DERIVED SERVICE-WORKER CACHE VERSION.
//
// The cache-first worker is only safe if its cache NAME changes whenever the
// shell it precaches does. That used to be a human bumping `const CACHE` by hand
// (and a client once fell ~40 versions behind when someone forgot). Now the name
// is a content hash the server substitutes into public/sw.js at serve time, so
// the properties that matter are: same bytes → same name (no pointless
// re-download), one changed byte → a new name, and the placeholder never reaches
// a browser.
//
// Drives the real handler over loopback against a THROWAWAY copy of public/, so
// "a different styles.css" is a real edit on disk rather than a mock.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import {
  SW_ASSET_HASHES_PLACEHOLDER,
  SW_CACHE_PLACEHOLDER,
  buildServiceWorkerScript,
  serviceWorkerScript,
  shellAssetPaths,
  swAssetList,
} from "../dist/swVersion.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REAL_PUBLIC = path.join(root, "public");

const temps = [];
const servers = [];

after(() => {
  for (const server of servers) {
    try {
      server.close();
    } catch {}
  }
  for (const dir of temps) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

/** A minimal public/ that still exercises the real sw.js arrays. */
function makeShell(styles = "body { color: red }") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cairn-sw-version-"));
  temps.push(dir);
  fs.copyFileSync(path.join(REAL_PUBLIC, "sw.js"), path.join(dir, "sw.js"));
  const source = fs.readFileSync(path.join(dir, "sw.js"), "utf8");
  for (const file of shellAssetPaths(dir, source)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, path.basename(file) === "styles.css" ? styles : `/* ${path.basename(file)} */`);
  }
  return dir;
}

/** One express app per shell, mounted exactly like src/server.ts does. */
async function serve(publicDir) {
  const app = express();
  app.get("/sw.js", serviceWorkerScript(publicDir));
  app.use(express.static(publicDir));
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
    s.on("error", reject);
  });
  servers.push(server);
  return server.address().port;
}

async function get(port, urlPath, method = "GET", headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: urlPath, method, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") })
      );
    });
    req.on("error", reject);
    req.end();
  });
}

function cacheName(body) {
  const match = /const CACHE\s*=\s*["']([^"']+)["']/.exec(body);
  return match ? match[1] : null;
}

test("the committed sw.js carries the placeholder the server substitutes", () => {
  const source = fs.readFileSync(path.join(REAL_PUBLIC, "sw.js"), "utf8");
  assert.equal(cacheName(source), SW_CACHE_PLACEHOLDER);
});

test("the version covers every asset the worker precaches", () => {
  const source = fs.readFileSync(path.join(REAL_PUBLIC, "sw.js"), "utf8");
  const core = swAssetList(source, "CORE_ASSETS");
  assert.ok(core.includes("/styles.css"), "CORE_ASSETS should list styles.css");
  // Every lazily-injected bundle is precached too, so an installed PWA can open
  // Stand offline on its first visit.
  assert.ok(core.includes("/js/bundle-05-me-health.js"), "the lazy bundle must stay precached");
  const files = shellAssetPaths(REAL_PUBLIC, source);
  assert.ok(
    files.some((f) => f.endsWith(path.join("public", "index.html"))),
    '"/" should map to index.html'
  );
  // "/" and "/index.html" are one file; it must be hashed once, not twice.
  const indexHits = files.filter((f) => f.endsWith(`${path.sep}index.html`));
  assert.equal(indexHits.length, 1);
});

test("identical shell bytes hash to the same cache name, a changed byte does not", async () => {
  const a = makeShell("body { color: red }");
  const b = makeShell("body { color: red }");
  const c = makeShell("body { color: blue }");

  const [pa, pb, pc] = await Promise.all([serve(a), serve(b), serve(c)]);
  const [ra, rb, rc] = await Promise.all([get(pa, "/sw.js"), get(pb, "/sw.js"), get(pc, "/sw.js")]);

  assert.equal(ra.status, 200);
  const nameA = cacheName(ra.body);
  const nameB = cacheName(rb.body);
  const nameC = cacheName(rc.body);

  assert.match(nameA, /^cairn-[0-9a-f]{12}$/);
  assert.equal(nameA, nameB, "the same shell bytes must keep the same cache name");
  assert.notEqual(nameA, nameC, "a changed styles.css must ship a new cache name");
});

test("the served worker never leaks the placeholder and is never HTTP-cached", async () => {
  const dir = makeShell();
  const port = await serve(dir);
  const res = await get(port, "/sw.js");

  assert.equal(res.status, 200);
  assert.ok(!res.body.includes(SW_CACHE_PLACEHOLDER), "the placeholder must be fully substituted");
  assert.match(String(res.headers["content-type"]), /text\/javascript/);
  assert.equal(res.headers["cache-control"], "no-cache");
  assert.ok(!/max-age=\d+/.test(String(res.headers["cache-control"])), "no long max-age on the worker");
  assert.equal(Number(res.headers["content-length"]), Buffer.byteLength(res.body, "utf8"));

  const head = await get(port, "/sw.js", "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.body, "");
});

test("a worker revalidating an unchanged script gets 304, a changed one gets the body", async () => {
  const dir = makeShell();
  const port = await serve(dir);
  const first = await get(port, "/sw.js");
  const etag = String(first.headers.etag);
  assert.match(etag, /^W\/"cairn-[0-9a-f]{12}"$/);

  const same = await get(port, "/sw.js", "GET", { "if-none-match": etag });
  assert.equal(same.status, 304);
  assert.equal(same.body, "");

  fs.writeFileSync(path.join(dir, "styles.css"), "body{color:red}");
  const changed = await get(port, "/sw.js", "GET", { "if-none-match": etag });
  assert.equal(changed.status, 200);
  assert.notEqual(String(changed.headers.etag), etag);
  assert.ok(changed.body.length > 0);
});

test("a rebuilt asset changes the name without a restart", async () => {
  const dir = makeShell("body { color: red }");
  const port = await serve(dir);
  const before = cacheName((await get(port, "/sw.js")).body);

  // Same handler instance, edited shell — the memo is keyed on size+mtime, so a
  // `tsx watch` session must pick this up rather than serve yesterday's version.
  const styles = path.join(dir, "styles.css");
  fs.writeFileSync(styles, "body { color: rebuilt }");
  fs.utimesSync(styles, new Date(), new Date(Date.now() + 2000));

  const after = cacheName((await get(port, "/sw.js")).body);
  assert.notEqual(before, after);
});

test("buildServiceWorkerScript reports the same version it substitutes", () => {
  const dir = makeShell();
  const built = buildServiceWorkerScript(dir);
  assert.equal(cacheName(built.body), built.version);
  assert.ok(!built.body.includes(SW_CACHE_PLACEHOLDER));
});

// INCREMENTAL PRECACHE. The served worker carries a hash per precached url, so an
// install copies unchanged files out of the previous cache and downloads only what
// moved. The properties: every precached url that exists is hashed, "/" and
// "/index.html" agree, one edited file moves exactly one hash, and the placeholder
// never reaches a browser.
function servedHashes(body) {
  const m = /const ASSET_HASHES = (\{[^\n]*\});/.exec(body);
  assert.ok(m, "served sw.js declares ASSET_HASHES");
  return JSON.parse(m[1]);
}

test("the served worker carries a hash for every precached url", () => {
  const dir = makeShell();
  const built = buildServiceWorkerScript(dir);
  assert.ok(!built.body.includes(SW_ASSET_HASHES_PLACEHOLDER));
  const hashes = servedHashes(built.body);
  assert.deepEqual(hashes, built.assetHashes);
  const source = fs.readFileSync(path.join(dir, "sw.js"), "utf8");
  const urls = [...swAssetList(source, "CORE_ASSETS"), ...swAssetList(source, "OPTIONAL_ASSETS")];
  for (const url of urls) assert.match(hashes[url] || "", /^[0-9a-f]{12}$/, `${url} is hashed`);
  assert.equal(hashes["/"], hashes["/index.html"]);
});

test("one changed file moves exactly its own hash (and the version)", () => {
  const dir = makeShell("body { color: red }");
  const before = buildServiceWorkerScript(dir);
  fs.writeFileSync(path.join(dir, "styles.css"), "body { color: blue }");
  const after = buildServiceWorkerScript(dir);
  assert.notEqual(before.version, after.version);
  const moved = Object.keys(after.assetHashes).filter((url) => after.assetHashes[url] !== before.assetHashes[url]);
  assert.deepEqual(moved, ["/styles.css"]);
});

test("a missing optional asset is left out of the hashes, never a crash", () => {
  const dir = makeShell();
  fs.rmSync(path.join(dir, "vendor", "xterm.js"));
  const built = buildServiceWorkerScript(dir);
  assert.equal(built.assetHashes["/vendor/xterm.js"], undefined);
  assert.ok(built.assetHashes["/styles.css"]);
});

/** The raw bytes of a response (no decoding), for the compressed-transfer contract. */
async function getRaw(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: urlPath, method: "GET", headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("the served worker is compressed (brotli, else gzip) and decodes to the same substituted body", async () => {
  const zlib = await import("node:zlib");
  const dir = makeShell();
  const port = await serve(dir);
  const plain = await getRaw(port, "/sw.js");
  assert.equal(plain.headers["content-encoding"], undefined, "no Accept-Encoding, no encoding");
  assert.equal(plain.headers.vary, "Accept-Encoding");
  const source = plain.body.toString("utf8");
  assert.ok(!source.includes(SW_CACHE_PLACEHOLDER) && !source.includes(SW_ASSET_HASHES_PLACEHOLDER));

  const br = await getRaw(port, "/sw.js", { "accept-encoding": "gzip, deflate, br" });
  assert.equal(br.headers["content-encoding"], "br");
  assert.equal(br.headers["cache-control"], "no-cache", "compression never changes the no-cache contract");
  assert.equal(Number(br.headers["content-length"]), br.body.length);
  assert.ok(br.body.length < plain.body.length / 2, "the worker ships a fraction of its bytes");
  assert.equal(zlib.brotliDecompressSync(br.body).toString("utf8"), source);
  assert.equal(br.headers.etag, plain.headers.etag, "one worker, one validator, whatever the encoding");

  const gz = await getRaw(port, "/sw.js", { "accept-encoding": "gzip" });
  assert.equal(gz.headers["content-encoding"], "gzip");
  assert.equal(zlib.gunzipSync(gz.body).toString("utf8"), source);

  const refused = await getRaw(port, "/sw.js", { "accept-encoding": "br;q=0, gzip;q=0" });
  assert.equal(refused.headers["content-encoding"], undefined);
  assert.equal(refused.body.toString("utf8"), source);

  const revalidated = await getRaw(port, "/sw.js", { "accept-encoding": "br", "if-none-match": String(plain.headers.etag) });
  assert.equal(revalidated.status, 304);

  // A rebuilt shell ships a new, freshly compressed worker.
  fs.writeFileSync(path.join(dir, "styles.css"), "body{color:blue}");
  const rebuilt = await getRaw(port, "/sw.js", { "accept-encoding": "br" });
  const next = zlib.brotliDecompressSync(rebuilt.body).toString("utf8");
  assert.notEqual(cacheName(next), cacheName(source));
});
