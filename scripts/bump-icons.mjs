#!/usr/bin/env node
// Moves the installed app's identity (icon set, and optionally its short name and
// theme color) to the next `.vN` in one step, so an already-installed PWA picks it up.
//
// Browsers and iOS cache install icons by URL, so a new icon only lands under a new
// URL. Every icon URL therefore carries one shared `.vN` suffix, and five places must
// move together: the files in public/icons, public/manifest.json (icons + shortcuts),
// public/index.html (apple-touch-icon and friends), public/sw.js (the precache lists)
// and APP_IDENTITY_VERSION in src/client/app-identity-model.ts (which keys the iOS
// re-add note). This script is the one way to move them; the precache version itself
// stays derived (src/swVersion.ts), and test/pwaInstallIdentity.test.js fails if the
// five ever disagree.
//
// Usage:
//   node scripts/bump-icons.mjs --check                 # report the current identity; exit 1 if the places disagree
//   node scripts/bump-icons.mjs [--dry-run]             # rename icons to the next .vN and rewrite every reference
//     [--theme-color "#rrggbb"]                         # also set manifest theme_color + the index.html meta, together
//     [--short-name "Name"]                             # also set manifest short_name + the iOS/app title metas
// Replace the icon bytes first (keeping the current names), then run the bump.
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const IDENTITY_FILES = {
  manifest: "public/manifest.json",
  index: "public/index.html",
  sw: "public/sw.js",
  model: "src/client/app-identity-model.ts",
  icons: "public/icons",
};

const ICON_URL_RE = /\/icons\/[\w.-]+/g;
const VERSIONED_RE = /\.v(\d+)\.[a-z0-9]+$/i;
const MODEL_CONST_RE = /const APP_IDENTITY_VERSION = (\d+);/;
// index.html carries a theme-color per scheme; the LIGHT one is the manifest's colour
// (a manifest holds only one), and the dark one is the dark palette's ground.
const LIGHT_THEME_META_RE = /(<meta\s+name="theme-color"\s+media="\(prefers-color-scheme: light\)"\s+content=")([^"]+)(")/;

function read(root, rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

function swArray(source, name) {
  const match = new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`).exec(source);
  if (!match) return [];
  const body = match[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  return [...body.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
}

/** Every icon URL each place references, the theme colors, and the model constant. */
export function readIdentity(root = REPO_ROOT) {
  const manifest = JSON.parse(read(root, IDENTITY_FILES.manifest));
  const index = read(root, IDENTITY_FILES.index);
  const sw = read(root, IDENTITY_FILES.sw);
  const modelSource = read(root, IDENTITY_FILES.model);
  const manifestIcons = [
    ...(manifest.icons || []).map((icon) => icon.src),
    ...(manifest.shortcuts || []).flatMap((shortcut) => (shortcut.icons || []).map((icon) => icon.src)),
  ];
  const indexIcons = [...new Set(index.match(ICON_URL_RE) || [])];
  const swIcons = [...swArray(sw, "CORE_ASSETS"), ...swArray(sw, "OPTIONAL_ASSETS")].filter((u) => u.startsWith("/icons/"));
  const appleTouch = /<link\s+rel="apple-touch-icon"\s+href="([^"]+)"/.exec(index)?.[1] || null;
  const metaTheme = LIGHT_THEME_META_RE.exec(index)?.[2] || null;
  const modelVersion = Number(MODEL_CONST_RE.exec(modelSource)?.[1] || 0);
  return {
    manifest,
    manifestIcons,
    indexIcons,
    swIcons,
    appleTouch,
    themeColor: manifest.theme_color || null,
    metaTheme,
    modelVersion,
  };
}

/** The shared `.vN`, or the list of ways the five places disagree. */
export function checkIdentity(root = REPO_ROOT) {
  const id = readIdentity(root);
  const errors = [];
  const urls = [...new Set([...id.manifestIcons, ...id.indexIcons, ...id.swIcons])];
  const versions = new Set();
  for (const url of urls) {
    const m = VERSIONED_RE.exec(url);
    if (!m) errors.push(`${url} carries no .vN suffix`);
    else versions.add(Number(m[1]));
    if (!existsSync(path.join(root, "public", url))) errors.push(`${url} does not exist under public/`);
  }
  if (versions.size > 1) errors.push(`icon urls disagree on the suffix: .v${[...versions].sort().join(", .v")}`);
  const version = versions.size === 1 ? [...versions][0] : 0;
  const cached = new Set(id.swIcons);
  for (const url of new Set([...id.manifestIcons, ...(id.appleTouch ? [id.appleTouch] : [])])) {
    if (!cached.has(url)) errors.push(`${url} is not precached in public/sw.js`);
  }
  if (!id.appleTouch) errors.push("public/index.html has no apple-touch-icon");
  if (id.themeColor !== id.metaTheme) {
    errors.push(`manifest theme_color ${id.themeColor} differs from index.html theme-color ${id.metaTheme}`);
  }
  if (version && id.modelVersion !== version) {
    errors.push(`APP_IDENTITY_VERSION is ${id.modelVersion}, the icon urls are .v${version}`);
  }
  return { version, errors, identity: id };
}

function replaceVersion(text, from, to) {
  return text.replace(new RegExp(`(/icons/[\\w-]+)\\.v${from}\\.`, "g"), `$1.v${to}.`);
}

/**
 * Move every place to `.v(N+1)`. Returns what it did (or would do, with dryRun).
 * Refuses to start from a disagreeing state, so a half-bump never compounds.
 */
export function bumpIdentity(root = REPO_ROOT, { dryRun = false, themeColor = null, shortName = null } = {}) {
  const { version, errors } = checkIdentity(root);
  if (errors.length) throw new Error(`identity places disagree; fix them first:\n  ${errors.join("\n  ")}`);
  if (themeColor != null && !/^#[0-9a-f]{6}$/i.test(themeColor)) throw new Error(`--theme-color must be #rrggbb (got ${themeColor})`);
  const next = version + 1;
  const iconDir = path.join(root, IDENTITY_FILES.icons);
  const renames = readdirSync(iconDir)
    .filter((name) => new RegExp(`\\.v${version}\\.[a-z0-9]+$`, "i").test(name))
    .map((name) => [name, name.replace(new RegExp(`\\.v${version}\\.`), `.v${next}.`)]);

  let manifestText = replaceVersion(read(root, IDENTITY_FILES.manifest), version, next);
  let index = replaceVersion(read(root, IDENTITY_FILES.index), version, next);
  const sw = replaceVersion(read(root, IDENTITY_FILES.sw), version, next);
  const model = read(root, IDENTITY_FILES.model).replace(MODEL_CONST_RE, `const APP_IDENTITY_VERSION = ${next};`);

  // Edited as text (first occurrence = the top-level key; shortcuts carry their own
  // short_name further down) so the hand-kept manifest layout survives, then re-parsed.
  if (themeColor != null) {
    manifestText = manifestText.replace(/("theme_color":\s*")[^"]*(")/, `$1${themeColor}$2`);
    index = index.replace(LIGHT_THEME_META_RE, `$1${themeColor}$3`);
  }
  if (shortName != null) {
    manifestText = manifestText.replace(/("short_name":\s*")[^"]*(")/, `$1${JSON.stringify(shortName).slice(1, -1)}$2`);
    const attr = shortName.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    index = index
      .replace(/(<meta\s+name="apple-mobile-web-app-title"\s+content=")[^"]*(")/, `$1${attr}$2`)
      .replace(/(<meta\s+name="application-name"\s+content=")[^"]*(")/, `$1${attr}$2`);
  }
  const parsed = JSON.parse(manifestText);
  if (themeColor != null && parsed.theme_color !== themeColor) throw new Error("could not set manifest theme_color");
  if (shortName != null && parsed.short_name !== shortName) throw new Error("could not set manifest short_name");

  if (!dryRun) {
    for (const [from, to] of renames) renameSync(path.join(iconDir, from), path.join(iconDir, to));
    writeFileSync(path.join(root, IDENTITY_FILES.manifest), manifestText);
    writeFileSync(path.join(root, IDENTITY_FILES.index), index);
    writeFileSync(path.join(root, IDENTITY_FILES.sw), sw);
    writeFileSync(path.join(root, IDENTITY_FILES.model), model);
  }
  return { from: version, to: next, renames };
}

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

function main(argv) {
  if (argv.includes("--check")) {
    const { version, errors } = checkIdentity();
    if (errors.length) {
      console.error("✗ installed-app identity places disagree:");
      for (const error of errors) console.error(`    ${error}`);
      process.exit(1);
    }
    console.log(`✓ installed-app identity is .v${version} everywhere (icons, manifest, index.html, sw.js, APP_IDENTITY_VERSION)`);
    return;
  }
  const dryRun = argv.includes("--dry-run");
  const result = bumpIdentity(REPO_ROOT, {
    dryRun,
    themeColor: argValue(argv, "--theme-color"),
    shortName: argValue(argv, "--short-name"),
  });
  const verb = dryRun ? "would move" : "moved";
  console.log(`${verb} the installed-app identity .v${result.from} -> .v${result.to}`);
  for (const [from, to] of result.renames) console.log(`  public/icons/${from} -> ${to}`);
  if (!dryRun) console.log("Next: npm run build, then commit the renamed icons with the four rewritten files.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
