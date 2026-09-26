// The app shell's one inline script: index.html's early fetch (`<script
// id="cairn-early-fetch">`), which starts Today's paint-critical API reads before the
// bundles have parsed. The Content-Security-Policy allows scripts from 'self' only, so
// that one inline block is admitted by its SHA-256 — computed HERE, at boot, from the
// file actually being served. Editing the script therefore can never ship a page whose
// early fetch the browser silently refuses to run.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const EARLY_FETCH_SCRIPT_ID = "cairn-early-fetch";

const SCRIPT_PATTERN = new RegExp(`<script id="${EARLY_FETCH_SCRIPT_ID}">([\\s\\S]*?)</script>`);

/** The inline script's source as served, or null when the shell carries none. */
export function earlyFetchScript(html: string): string | null {
  const match = SCRIPT_PATTERN.exec(html);
  return match ? match[1] : null;
}

/** The CSP source expression for a script body: `'sha256-<base64>'`. */
export function cspScriptHash(source: string): string {
  return `'sha256-${crypto.createHash("sha256").update(source, "utf8").digest("base64")}'`;
}

let cached: { dir: string; hash: string | null } | null = null;

/** The early-fetch script's CSP hash for the shell in `publicDir` (read once), or null. */
export function earlyFetchCspHash(publicDir: string): string | null {
  if (cached && cached.dir === publicDir) return cached.hash;
  let hash: string | null = null;
  try {
    const script = earlyFetchScript(fs.readFileSync(path.join(publicDir, "index.html"), "utf8"));
    hash = script == null ? null : cspScriptHash(script);
  } catch {
    hash = null; // no shell on disk (an API-only test harness): nothing to admit
  }
  cached = { dir: publicDir, hash };
  return hash;
}
