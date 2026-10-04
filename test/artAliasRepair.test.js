// Misfiled art aliases: the matcher's `Number(null) === 0` bug filed every
// non-matching query onto the NEWEST asset of its kind (hundreds of meals drawn as
// one chicken plate; World's Greatest Stretch, a crunch and a lateral raise as one
// front plank), and a persisted alias then short-circuited every later
// generation. These pin the strict parse, the read-time exercise guard, the
// one-shot repair, the library-guide pose fallback and the food/activity `v=`.
// Offline — global fetch is stubbed. Env is set BEFORE importing dist/art.js.
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { db, repo } from "./_seed.js";

process.env.GEMINI_API_KEY = "test-key-not-a-real-credential";

let art;
let ledger;
let circuit;
const realFetch = globalThis.fetch;
let calls = [];
let responder = () => okImage();

const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);

function okImage() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [
        { content: { parts: [{ inlineData: { mimeType: "image/png", data: PNG_BYTES.toString("base64") } }] } },
      ],
    }),
    text: async () => "",
  };
}

function matcherSays(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 8 },
    }),
    text: async () => "",
  };
}

const artDir = () => path.join(process.env.DATA_DIR, "art");

/** A real file + art_assets row, created at `createdAt` (UTC 'YYYY-MM-DD HH:MM:SS'). */
function seedAsset(kind, text, createdAt, key = null) {
  const assetKey = key ?? (kind === "exercise" ? art.cacheKey("exercise", `seed:${text}`) : art.cacheKey(kind, text));
  fs.mkdirSync(artDir(), { recursive: true });
  fs.writeFileSync(path.join(artDir(), `${assetKey}.png`), PNG_BYTES);
  db.prepare(`INSERT INTO art_assets (key, kind, text, created_at) VALUES (?, ?, ?, ?)`).run(
    assetKey,
    kind,
    text,
    createdAt
  );
  return assetKey;
}

function seedAlias(kind, query, assetKey, at) {
  db.prepare(`INSERT INTO art_aliases (kind, query, asset_key, created_at) VALUES (?, ?, ?, ?)`).run(
    kind,
    query,
    assetKey,
    at
  );
  db.prepare(`INSERT INTO art_usage (created_at, kind, query, asset_key, action) VALUES (?, ?, ?, ?, 'reuse')`).run(
    at,
    kind,
    query,
    assetKey
  );
}

function imagePrompt() {
  const image = calls.find((c) => c.body?.generationConfig?.responseModalities);
  return image?.body?.contents?.[0]?.parts?.[0]?.text ?? "";
}

before(async () => {
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes("generativelanguage.googleapis.com")) return realFetch(url, init);
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
    return responder();
  };
  art = await import("../dist/art.js");
  ledger = await import("../dist/repo/art-ledger.js");
  circuit = await import("../dist/artCircuit.js");
});

after(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  calls = [];
  responder = () => okImage();
  circuit.resetArtCircuit();
  art.resetArtRegenGate();
  if (fs.existsSync(artDir())) fs.rmSync(artDir(), { recursive: true, force: true });
});

test("parseMatchIndex treats null / junk as no match — never index 0", () => {
  assert.equal(art.parseMatchIndex(null, 5), null, "Number(null) is 0; that was the bug");
  assert.equal(art.parseMatchIndex(undefined, 5), null);
  assert.equal(art.parseMatchIndex("", 5), null);
  assert.equal(art.parseMatchIndex("none", 5), null);
  assert.equal(art.parseMatchIndex(false, 5), null);
  assert.equal(art.parseMatchIndex(1.5, 5), null);
  assert.equal(art.parseMatchIndex(-1, 5), null);
  assert.equal(art.parseMatchIndex(5, 5), null, "out of range");
  assert.equal(art.parseMatchIndex(0, 5), 0);
  assert.equal(art.parseMatchIndex(3, 5), 3);
  assert.equal(art.parseMatchIndex(" 2 ", 5), 2);
});

test('food: a matcher answering {"match": null} draws its own picture, not the newest asset', async () => {
  seedAsset("food", "lemon herb chicken with roasted brussels", "2026-07-27 19:48:06");
  responder = () => matcherSays({ match: null, canonical: "half a pear" });
  const r = await art.resolveConcept({ kind: "food", text: "half a pear" });
  assert.equal(r.reused, false);
  assert.equal(r.key, art.cacheKey("food", "half a pear"));
  assert.equal(art.cachedArtPath("food", "half a pear"), null, "no alias onto the chicken plate");
});

test("World's Greatest Stretch: a foreign exercise alias is a miss, and the replacement carries the pose at v2", async () => {
  const plank = seedAsset("exercise", "front plank", "2026-07-22 16:40:17");
  seedAlias("exercise", "world's greatest stretch", plank, "2026-08-23 13:22:05");
  repo.findOrCreateExercise("World's Greatest Stretch", "mobility");

  assert.equal(art.cachedArtPath("exercise", "World's Greatest Stretch"), null, "the plank is not served");
  assert.equal(art.artVersion("exercise", "World's Greatest Stretch"), 0);
  assert.equal(
    art.exerciseTargetVersion("World's Greatest Stretch", false),
    2,
    "a phone may hold the plank under v=1; the new figurine must not share that URL"
  );

  const pose =
    "Step into a deep lunge with both hands on the floor inside the front foot. Drop the inside elbow toward the instep, then rotate the chest open and reach that arm to the ceiling";
  assert.equal(await art.warmExerciseArt("World's Greatest Stretch", { muscle_group: "mobility", pose }), true);
  assert.match(imagePrompt(), /^The pose: Step into a deep lunge/);
  const served = art.cachedArtPath("exercise", "World's Greatest Stretch");
  assert.ok(served);
  assert.notEqual(art.assetKeyFromPath(served), plank);
  assert.equal(art.artVersion("exercise", "World's Greatest Stretch"), 2);
});

test("a same-movement exercise alias is still honoured (linked names, or the same name)", () => {
  repo.setExerciseAlias("db bench", "Dumbbell Bench Press");
  const bench = seedAsset("exercise", "dumbbell bench press", "2026-07-01 10:00:00");
  seedAlias("exercise", "db bench", bench, "2026-07-02 10:00:00");
  assert.ok(art.cachedArtPath("exercise", "db bench"));
  assert.equal(art.exerciseAliasTrusted("db bench", bench), true);
});

test("exercise pose falls back to the imported library guide's first steps", async () => {
  const ex = repo.findOrCreateExercise("World's Greatest Stretch", "mobility");
  db.prepare(
    `INSERT INTO exercise_guides (guide_id, name, name_key, category, instructions, image_count, exercise_id, match_confidence, source, license)
     VALUES (?, ?, ?, 'stretching', ?, 2, ?, 'exact', 'free-exercise-db', 'Unlicense')`
  ).run(
    "Worlds_Greatest_Stretch",
    "World's Greatest Stretch",
    "world s greatest stretch",
    JSON.stringify([
      "This is a three-part stretch. Begin by lunging forward, with your front foot flat on the ground.",
      "Now, place the arm on the same side as your front leg on the ground, with the elbow next to the foot.",
      "After 10-20 seconds, place your hands on either side of your front foot.",
    ]),
    Number(ex.id)
  );
  const pose = art.exercisePoseFor("World's Greatest Stretch");
  assert.match(pose, /lunging forward/);
  assert.match(pose, /elbow next to the foot/);
  assert.doesNotMatch(pose, /After 10-20 seconds/, "two steps ride along, not the whole guide");

  assert.equal(art.buildExerciseArtContext("World's Greatest Stretch").pose, pose);
  assert.equal(await art.produceExerciseArt("World's Greatest Stretch"), true);
  assert.match(imagePrompt(), /The pose: This is a three-part stretch\. Begin by lunging forward/);
});

test("repairMisfiledArtAliases drops index-0 food/activity aliases and foreign exercise aliases, once", () => {
  const older = seedAsset("food", "oat and berry bowl", "2026-07-01 08:00:00");
  const newest = seedAsset("food", "lemon herb chicken", "2026-07-27 19:48:06");
  // Bug signature: reused onto the newest asset while it WAS the newest.
  seedAlias("food", "half a pear", newest, "2026-08-10 12:00:00");
  seedAlias("food", "small apple", newest, "2026-09-01 12:00:00");
  // A genuine reuse onto an older asset stays.
  seedAlias("food", "oats with berries", older, "2026-08-11 12:00:00");
  // Once something newer exists, a reuse onto `newest` is no longer index 0.
  const later = seedAsset("food", "salmon and rice", "2026-09-05 12:00:00");
  seedAlias("food", "chicken with brussels", newest, "2026-09-06 12:00:00");
  // Exercise: a foreign alias goes, a linked one stays.
  const plank = seedAsset("exercise", "front plank", "2026-07-22 16:40:17");
  seedAlias("exercise", "abdominal crunch", plank, "2026-08-23 13:21:48");
  seedAlias("exercise", "front plank", plank, "2026-08-23 13:21:50");

  const dry = art.repairMisfiledArtAliases();
  assert.deepEqual(dry, { food: 2, exercise: 1, activity: 0 });
  assert.ok(art.cachedArtPath("food", "half a pear"), "dry run changes nothing");

  const applied = art.repairMisfiledArtAliasesOnce();
  assert.deepEqual(applied, { food: 2, exercise: 1, activity: 0 });
  assert.equal(art.cachedArtPath("food", "half a pear"), null);
  assert.equal(art.cachedArtPath("food", "small apple"), null);
  assert.ok(art.cachedArtPath("food", "oats with berries"));
  assert.ok(art.cachedArtPath("food", "chicken with brussels"));
  assert.equal(
    db.prepare(`SELECT count(*) n FROM art_aliases WHERE kind = 'exercise' AND query = 'abdominal crunch'`).get().n,
    0
  );
  assert.ok(later);
  assert.equal(art.repairMisfiledArtAliasesOnce(), null, "runs once per database");
});

test("food/activity art URLs carry v = the served asset's creation time", () => {
  const key = seedAsset("activity", "running", "2026-09-01 07:30:00");
  db.prepare(`INSERT INTO activities (date, type) VALUES (date('now'), 'run')`).run();
  assert.equal(art.assetVersion("activity", "running"), Math.floor(Date.parse("2026-09-01T07:30:00Z") / 1000));
  const { versions } = art.artVersions();
  assert.equal(versions["activity|running"], Math.floor(Date.parse("2026-09-01T07:30:00Z") / 1000));
  assert.ok(key);
  assert.equal(art.assetVersion("food", "nothing drawn yet"), 0);
});

test("a forced food regenerate re-stamps the asset, and the route's version is the URL's own v scale", async () => {
  const old = seedAsset("food", "half a pear", "2026-07-01 08:00:00");
  const oldV = art.assetVersion("food", "half a pear");
  assert.equal(oldV, Math.floor(Date.parse("2026-07-01T08:00:00Z") / 1000));
  const result = await art.regenerateArt("food", "half a pear");
  assert.equal(result.ok, true);
  assert.equal(result.regenerated, true);
  assert.equal(art.assetKeyFromPath(art.cachedArtPath("food", "half a pear")), old, "same key, new bytes");
  const newV = art.assetVersion("food", "half a pear");
  assert.ok(newV > oldV, "a new picture under the same key still gets a new v");
  assert.equal(result.version, newV, "the regenerate answer speaks the client URL's v (creation time), not artVersion");
});

test("addArtAsset's re-stamp is strictly later even within the same second", () => {
  const { addArtAsset, getArtAsset } = ledger;
  const stamp = (key) => Date.parse(`${getArtAsset(key).created_at.replace(" ", "T")}Z`);
  addArtAsset("restamp-key", "food", "a plate");
  const first = stamp("restamp-key");
  addArtAsset("restamp-key", "food", "a plate");
  assert.ok(stamp("restamp-key") > first);
});

test("the repair remembers what it un-aliased: those exercise names start at v2, food queries never fall back to no v", () => {
  const plank = seedAsset("exercise", "front plank", "2026-07-22 16:40:17");
  seedAlias("exercise", "abdominal crunch", plank, "2026-08-23 13:21:48");
  const newest = seedAsset("food", "lemon herb chicken", "2026-07-27 19:48:06");
  seedAlias("food", "half a pear", newest, "2026-08-10 12:00:00");

  // Before the repair, the alias itself carries the fact.
  assert.equal(art.exerciseTargetVersion("Abdominal Crunch", false), 2);
  art.repairMisfiledArtAliasesOnce();
  assert.equal(
    db.prepare(`SELECT count(*) n FROM art_aliases WHERE kind = 'exercise' AND query = 'abdominal crunch'`).get().n,
    0,
    "the alias is gone"
  );
  // ...and after it, the repair's own record does: the warm-up runs AFTER the repair.
  assert.equal(art.exerciseTargetVersion("Abdominal Crunch", false), 2);
  assert.equal(art.artVersion("exercise", "Abdominal Crunch"), 2, "the URL is already a new one");
  assert.equal(art.exerciseTargetVersion("Deadlift", false), 1, "a name the repair never touched starts at v1");
  assert.equal(art.artVersion("exercise", "Deadlift"), 0);

  const record = JSON.parse(
    db.prepare(`SELECT value FROM app_state WHERE key = 'art_alias_repair_v1'`).get().value
  );
  const repairV = Math.floor(Date.parse(record.at) / 1000);
  assert.deepEqual(record.queries.exercise, ["abdominal crunch"]);
  assert.deepEqual(record.queries.food, ["half a pear"]);
  assert.equal(art.cachedArtPath("food", "half a pear"), null);
  assert.equal(art.assetVersion("food", "half a pear"), repairV, "nothing drawn yet, but never the old v-less URL");
  assert.equal(art.artVersions().versions["food|half a pear"], undefined, "not a PWA query in this DB");
  // Its eventual picture — even an OLDER genuine match the matcher reuses — is strictly later.
  const genuine = seedAsset("food", "pear slices", "2026-06-01 10:00:00");
  db.prepare(`INSERT INTO art_aliases (kind, query, asset_key) VALUES ('food', 'half a pear', ?)`).run(genuine);
  assert.equal(art.assetVersion("food", "half a pear"), repairV + 1);
  assert.equal(art.assetVersion("food", "pear slices"), Math.floor(Date.parse("2026-06-01T10:00:00Z") / 1000));
});

test("the boot warm-up queues only a few un-aliased food queries; the rest wait to be viewed", async () => {
  const newest = seedAsset("food", "lemon herb chicken", "2026-07-27 19:48:06");
  const meals = ["warm cap apple", "warm cap pear", "warm cap plum", "warm cap kiwi", "warm cap fig"];
  for (const [i, meal] of meals.entries()) {
    seedAlias("food", meal, newest, `2026-08-1${i} 12:00:00`);
    db.prepare(`INSERT INTO food_notes (date, meal, raw_output) VALUES (date('now'), 'snack', ?)`).run(meal);
  }
  art.repairMisfiledArtAliasesOnce();
  assert.ok(meals.every((meal) => art.cachedArtPath("food", meal) == null));

  const { queued } = art.warmArt({ repairedCap: 2 });
  assert.equal(queued, 2, "two un-aliased queries queued this boot");
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  for (let i = 0; i < 400 && meals.filter((m) => art.cachedArtPath("food", m)).length < 2; i++) await sleep(5);
  await sleep(30);
  assert.equal(meals.filter((meal) => art.cachedArtPath("food", meal)).length, 2, "and no more than that drew");
  // A view still resolves one lazily.
  const rest = meals.filter((meal) => !art.cachedArtPath("food", meal));
  assert.equal(art.requestArt("food", rest[0]), true);
  for (let i = 0; i < 400 && !art.cachedArtPath("food", rest[0]); i++) await sleep(5);
  assert.ok(art.cachedArtPath("food", rest[0]));
});
