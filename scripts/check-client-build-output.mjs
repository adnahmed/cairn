#!/usr/bin/env node
// Guard browser-client buildability from TypeScript sources. Generated public/js output is ignored by git;
// this check proves a checkout can recreate every served bundle without requiring committed transpiled JS churn.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLES, CLIENT_OUTPUTS } from "./build-client.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Guard both the per-file outputs AND the concatenated bundles index.html loads.
const outputs = [...CLIENT_OUTPUTS.map((item) => item.output), ...BUNDLES.map((bundle) => bundle.output)];
const handwrittenPublicJs = new Set(["public/js/10-boot.js"]);

const trackedPublicJs = execFileSync("git", ["ls-files", "--", "public/js/*.js"], { cwd: root, encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean);
const trackedGenerated = trackedPublicJs.filter((file) => !handwrittenPublicJs.has(file));
if (trackedGenerated.length) {
  console.error("✗ generated client output is tracked by git; keep src/client as the source of truth:");
  for (const file of trackedGenerated) console.error(`    ${file}`);
  process.exit(1);
}

// The build rewrites index.html's generated lazy-route preload table
// (scripts/lazy-route-preload.mjs). The image ships the COMMITTED shell next to
// precompressed siblings built from the rewritten one, so a stale commit would serve
// two different shells: the build must find it already current.
const shellPath = path.join(root, "public/index.html");
const shellBefore = existsSync(shellPath) ? readFileSync(shellPath, "utf8") : null;
execFileSync(process.execPath, ["scripts/build-client.mjs"], { cwd: root, stdio: "inherit" });
if (shellBefore != null && readFileSync(shellPath, "utf8") !== shellBefore) {
  console.error("✗ public/index.html's lazy-route preload table was stale; the build rewrote it — commit the result");
  process.exit(1);
}

const missing = outputs.filter((file) => !existsSync(path.join(root, file)));
if (missing.length) {
  console.error("✗ client build did not generate every expected output:");
  for (const file of missing) console.error(`    ${file}`);
  process.exit(1);
}

console.log(`✓ client build output generated from TypeScript (${outputs.length} file${outputs.length === 1 ? "" : "s"})`);
