import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function escAttr(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function loadArtController(options = {}) {
  const listeners = new Map();
  const storage = new Map(options.storage || []);
  const apiCalls = [];
  class FakeImage {
    constructor() {
      this.dataset = {};
      this.src = "/api/art?kind=food&q=stale";
      this.isConnected = true;
      this.removed = false;
      const classes = new Set();
      this.classList = {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        contains: (name) => classes.has(name),
      };
    }
    remove() {
      this.removed = true;
    }
    closest(sel) {
      if (sel === ".artile") return { classList: this.classList };
      return null;
    }
  }
  const context = {
    HTMLImageElement: FakeImage,
    clearTimeout: () => {},
    document: {
      addEventListener: (type, handler) => listeners.set(type, handler),
      body: {
        appendChild() {},
        contains() {
          return false;
        },
      },
      createElement: () => {
        const el = {
          className: "",
          style: {},
          innerHTML: "",
          querySelector: () => ({ addEventListener: () => {} }),
          contains: () => false,
          remove: () => {},
          setAttribute: () => {},
        };
        return el;
      },
    },
    encodeURIComponent,
    escAttr,
    escHtml: (value) =>
      String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;"),
    globalThis: null,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
    ...(options.session
      ? {
          sessionStorage: {
            getItem: (key) => options.session.get(key) ?? null,
            setItem: (key, value) => options.session.set(key, String(value)),
          },
        }
      : {}),
    pollToken: 1,
    setTimeout: (fn) => {
      fn();
      return 1;
    },
    window: {
      CairnArt: {
        food: (query) => `<svg data-food="${escAttr(query)}"></svg>`,
        exercise: (query) => `<svg data-ex="${escAttr(query)}"></svg>`,
      },
    },
    withToken: (path) => `${path}&token=t`,
    api: async (path, opts) => {
      apiCalls.push({ path, opts });
      if (path === "/art/regenerate") return options.regenerate || { ok: true, regenerated: true, version: 2 };
      // The boot read is ONE call now; the two older routes are never asked.
      assert.equal(path, "/art/state");
      return { ...(options.manifest || {}), ...(options.versions || { versions: {} }) };
    },
  };
  context.globalThis = context;
  // art-memory-client.js (versions + misses) loads just before the controller in bundle-01.
  vm.runInNewContext(readFileSync(join(root, "public/js/art-memory-client.js"), "utf8"), context);
  vm.runInNewContext(readFileSync(join(root, "public/js/art-controller.js"), "utf8"), context);
  return { context, listeners, storage, FakeImage, apiCalls };
}

test("art controller renders generated photo tiles with escaped eager-ready state", async () => {
  const env = loadArtController({
    manifest: { enabled: true, ready: ["food|cached <bowl>"] },
  });

  await env.context.primeArtManifest();
  const html = env.context.artImg("food", "cached <bowl>", "artile-test");

  assert.match(html, /class="artimg-photo on instant"/);
  assert.match(html, /loading="eager"/);
  assert.match(html, /alt="cached &lt;bowl&gt;"/);
  assert.match(html, /q=cached%20%3Cbowl%3E/);
  assert.match(html, /data-artkey="food\|cached &lt;bowl&gt;"/);
  assert.equal(env.storage.get("cairn-art-ready"), JSON.stringify(["food|cached <bowl>"]));
});

test("art controller keeps artEnabled as the legacy mutable global", () => {
  const env = loadArtController();

  env.context.artEnabled = false;
  const disabled = env.context.artImg("food", "rice", "artile-test", "<svg></svg>");
  assert.equal(disabled, `<div class="artile artile-test"><svg></svg></div>`);

  env.context.artEnabled = true;
  const enabled = env.context.artImg("food", "rice", "artile-test", "<svg></svg>");
  assert.match(enabled, /data-art-photo="1"/);
});

test("art controller records loaded photos and retries failed ready images once", () => {
  const env = loadArtController();
  const img = new env.FakeImage();
  img.dataset.artPhoto = "1";
  img.dataset.artkey = "food|seen";

  env.listeners.get("load")({ target: img });

  assert.equal(img.classList.contains("on"), true);
  assert.equal(env.storage.get("cairn-art-ready"), JSON.stringify(["food|seen"]));
  assert.match(env.context.artImg("food", "seen", "artile-test", "<svg></svg>"), /loading="eager"/);

  img.classList.add("instant");
  env.listeners.get("error")({ target: img });

  assert.equal(img.classList.contains("on"), false);
  assert.equal(img.classList.contains("instant"), false);
  assert.equal(img.dataset.retried, "1");
  assert.equal(img.src, "/api/art?kind=food&q=stale&r=1");
});

test("art controller treats a cooldown regenerate as a quiet no-op", async () => {
  const env = loadArtController({
    versions: { versions: { "exercise|Farmer's Carry": 1 } },
    regenerate: { ok: true, regenerated: false, reason: "cooldown", version: 1 },
  });
  await env.context.primeArtManifest();
  const img = new env.FakeImage();
  img.dataset.artKind = "exercise";
  img.dataset.artQ = "Farmer's Carry";
  img.dataset.artkey = "exercise|Farmer's Carry";
  img.isConnected = true;
  const srcBefore = img.src;

  await env.context.redrawExerciseArt(img, "Farmer's Carry");
  assert.equal(img.src, srcBefore, "did not swap the tile");
  assert.equal(img.classList.contains("art-redrawing"), false);
});

test("art controller posts regenerate and swaps the tile to the new versioned URL", async () => {
  const env = loadArtController({
    versions: { versions: { "exercise|Farmer's Carry": 1 } },
    regenerate: { ok: true, regenerated: true, version: 2 },
  });
  await env.context.primeArtManifest();
  const html = env.context.artImg("exercise", "Farmer's Carry", "artile-sm", "<svg></svg>");
  assert.match(html, /v=1/);
  assert.match(html, /data-art-kind="exercise"/);

  const img = new env.FakeImage();
  img.dataset.artKind = "exercise";
  img.dataset.artQ = "Farmer's Carry";
  img.dataset.artkey = "exercise|Farmer's Carry";
  img.isConnected = true;

  await env.context.redrawExerciseArt(img, "Farmer's Carry");
  const regen = env.apiCalls.find((c) => c.path === "/art/regenerate");
  assert.ok(regen, "posted /art/regenerate");
  assert.equal(regen.opts.method, "POST");
  assert.match(String(regen.opts.body), /Farmer's Carry/);
  assert.match(img.src, /kind=exercise/);
  assert.match(img.src, /v=2/);
});

test("art controller primes readiness and versions with ONE /art/state read and persists the versions", async () => {
  const env = loadArtController({
    manifest: { enabled: true, ready: ["exercise|Back Squat"] },
    versions: { versions: { "exercise|Back Squat": 3 } },
  });
  await env.context.primeArtManifest();
  assert.deepEqual(env.apiCalls.map((c) => c.path), ["/art/state"]);
  assert.equal(env.storage.get("cairn-art-versions"), JSON.stringify({ "exercise|Back Squat": 3 }));
});

test("a cold start reads the remembered versions synchronously, so the FIRST render already carries v=", () => {
  const env = loadArtController({ storage: [["cairn-art-versions", JSON.stringify({ "exercise|Back Squat": 4 })]] });
  // No primeArtManifest() yet — this is the very first paint.
  const html = env.context.artImg("exercise", "Back Squat", "artile-sm", "<svg></svg>");
  assert.match(html, /v=4/);
  assert.equal(env.apiCalls.length, 0);
});

test("versions merge by max: a capped server list never rolls a remembered redraw back", async () => {
  const env = loadArtController({
    storage: [["cairn-art-versions", JSON.stringify({ "exercise|Row": 5, "exercise|Old Lift": 2 })]],
    versions: { versions: { "exercise|Row": 3, "exercise|Press": 1 } },
  });
  await env.context.primeArtManifest();
  assert.match(env.context.artImg("exercise", "Row", "a", "<svg></svg>"), /v=5/);
  assert.match(env.context.artImg("exercise", "Old Lift", "a", "<svg></svg>"), /v=2/);
  assert.match(env.context.artImg("exercise", "Press", "a", "<svg></svg>"), /v=1/);
});

test("a just-missed (204) image is not asked for again by a re-render", () => {
  const env = loadArtController();
  const first = env.context.artImg("exercise", "Leg Curl", "artile-sm", "<svg></svg>");
  assert.match(first, /data-art-photo="1"/);
  const img = new env.FakeImage();
  img.dataset.artPhoto = "1";
  img.dataset.artkey = "exercise|Leg Curl";
  img.isConnected = false; // the re-render replaced it
  env.listeners.get("error")({ target: img });
  const again = env.context.artImg("exercise", "Leg Curl", "artile-sm", "<svg></svg>");
  assert.doesNotMatch(again, /<img/);
  assert.equal(again, '<div class="artile artile-sm"><svg></svg></div>');
  // A different figure is unaffected.
  assert.match(env.context.artImg("exercise", "Leg Extension", "artile-sm", "<svg></svg>"), /<img/);
});

test("a miss survives the reload that re-renders it (tab-scoped), and a ready manifest clears it", async () => {
  const session = new Map();
  const first = loadArtController({ session });
  const img = new first.FakeImage();
  img.dataset.artPhoto = "1";
  img.dataset.artkey = "exercise|Back Squat";
  first.listeners.get("error")({ target: img });
  assert.ok(session.get("cairn-art-miss").includes("exercise|Back Squat"));

  // The reloaded page's first (warm) render does not re-ask for the miss.
  const reloaded = loadArtController({ session, manifest: { enabled: true, ready: ["exercise|Back Squat"] } });
  assert.doesNotMatch(reloaded.context.artImg("exercise", "Back Squat", "a", "<svg></svg>"), /<img/);
  // Once the boot read says it is drawn, it renders at once.
  await reloaded.context.primeArtManifest();
  assert.match(reloaded.context.artImg("exercise", "Back Squat", "a", "<svg></svg>"), /<img[^>]+instant/);
  assert.ok(!session.get("cairn-art-miss").includes("Back Squat"));
});
