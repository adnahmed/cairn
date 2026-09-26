import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Request, Response, NextFunction } from "express";

// The service worker's cache name, DERIVED from what it precaches.
//
// Cairn's #1 footgun used to be a human forgetting to bump `const CACHE` in
// public/sw.js: the worker is cache-first, so an installed PWA that never sees a
// new cache name serves the old shell forever (a client once fell ~40 versions
// behind). That whole class of bug is a build-output identity problem, and the
// build output can answer it itself.
//
// So public/sw.js ships a PLACEHOLDER literal and this module rewrites it at
// serve time to `cairn-<hash>`, where the hash covers the bytes of every asset
// the worker precaches plus sw.js's own source. Same shell bytes → same name (no
// pointless re-download); one changed byte anywhere in the shell → a new name,
// a fresh precache, and skipWaiting() puts it live on the next open.
//
// The precache list is read from sw.js's own arrays rather than duplicated here,
// so adding an asset to CORE_ASSETS is the single edit that both precaches it
// and folds it into the version.

/**
 * The committed literal in public/sw.js. Substituted by exact match, and
 * asserted present by scripts/check-sw-cache.mjs. Serving the file unmodified
 * (a plain static server, an offline checkout) still yields a working worker.
 */
export const SW_CACHE_PLACEHOLDER = "cairn-shell-dev";

/** Short enough to read in DevTools, long enough that a collision is not a concern. */
const VERSION_HASH_LENGTH = 12;

/** Pull the quoted entries out of a `const NAME = [ … ];` array in sw.js source. */
export function swAssetList(source: string, name: string): string[] {
  const match = new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`).exec(source);
  if (!match) return [];
  const body = match[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  return [...body.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
}

/**
 * The shell files the version covers, in a stable order: every precached asset
 * from sw.js's own arrays, mapped to a path under `publicDir`. "/" and
 * "/index.html" are the same file, so the duplicate is dropped.
 */
export function shellAssetPaths(publicDir: string, source: string): string[] {
  const urls = [...swAssetList(source, "CORE_ASSETS"), ...swAssetList(source, "OPTIONAL_ASSETS")];
  const seen = new Set<string>();
  const files: string[] = [];
  for (const url of urls) {
    if (!url.startsWith("/")) continue;
    const relative = url === "/" ? "/index.html" : url;
    if (seen.has(relative)) continue;
    seen.add(relative);
    files.push(path.join(publicDir, relative));
  }
  return files;
}

/** Cheap "did anything move" signature — recomputes the hash only when it changes. */
function assetSignature(files: string[]): string {
  const parts: string[] = [];
  for (const file of files) {
    try {
      const stat = fs.statSync(file);
      parts.push(`${file}:${stat.size}:${Math.floor(stat.mtimeMs)}`);
    } catch {
      parts.push(`${file}:absent`);
    }
  }
  return parts.join("|");
}

/**
 * Content hash over the shell. A missing asset hashes as absent rather than
 * throwing: a build stage without every optional icon must still serve a worker.
 */
export function shellContentHash(swSource: string, files: string[]): string {
  const hash = crypto.createHash("sha256");
  hash.update("cairn-sw\0");
  hash.update(swSource);
  for (const file of files) {
    hash.update("\0");
    hash.update(path.basename(file));
    hash.update("\0");
    try {
      hash.update(crypto.createHash("sha256").update(fs.readFileSync(file)).digest());
    } catch {
      hash.update("absent");
    }
  }
  return hash.digest("hex").slice(0, VERSION_HASH_LENGTH);
}

export interface ServiceWorkerScript {
  /** The cache name this build serves, e.g. `cairn-6f21a0c93b4e`. */
  version: string;
  /** sw.js with the placeholder substituted. */
  body: string;
}

/** Compute the served worker from a public directory. Pure apart from disk reads. */
export function buildServiceWorkerScript(publicDir: string): ServiceWorkerScript {
  const swPath = path.join(publicDir, "sw.js");
  const source = fs.readFileSync(swPath, "utf8");
  const files = shellAssetPaths(publicDir, source);
  const version = `cairn-${shellContentHash(source, files)}`;
  return { version, body: source.split(SW_CACHE_PLACEHOLDER).join(version) };
}

/**
 * Express handler for GET/HEAD /sw.js.
 *
 * Mounted BEFORE the static layers so the substituted body is the only /sw.js
 * anyone can reach — build-client.mjs deliberately does not precompress sw.js,
 * so there is no `.br`/`.gz` sibling to go stale behind this. `no-cache` (not
 * `no-store`) keeps the browser's own revalidation cheap while guaranteeing it
 * never serves a worker from the HTTP cache without asking.
 *
 * The computation is memoized on a size+mtime signature of the shell, so a
 * `tsx watch` session picks up an edited styles.css without a restart while a
 * production process hashes the shell exactly once.
 */
/** One memo per public directory, shared by the /sw.js handler and /api/health. */
const memoByRoot = new Map<string, { script: ServiceWorkerScript; signature: string }>();

/**
 * The worker this build serves, recomputed only when a size+mtime signature of the
 * shell moves. Throws when there is no sw.js on disk.
 */
export function currentServiceWorkerScript(publicDir: string): ServiceWorkerScript {
  const root = path.resolve(publicDir);
  const swPath = path.join(root, "sw.js");
  const source = fs.readFileSync(swPath, "utf8");
  const signature = assetSignature([swPath, ...shellAssetPaths(root, source)]);
  const memo = memoByRoot.get(root);
  if (memo && memo.signature === signature) return memo.script;
  const script = buildServiceWorkerScript(root);
  memoByRoot.set(root, { script, signature });
  return script;
}

/** The repo's own public/ (dist/ and src/ both sit one level below the root). */
const DEFAULT_PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

/**
 * The shell (derived cache name) the server hands an installed app right now, or
 * null with no worker on disk. /api/health reports it and Settings shows the one the
 * running worker holds, so a deploy can be checked on the device itself: the two
 * agree once the installed app has picked the new shell up.
 */
export function currentShellVersion(publicDir: string = DEFAULT_PUBLIC_DIR): string | null {
  try {
    return currentServiceWorkerScript(publicDir).version;
  } catch {
    return null;
  }
}

export function serviceWorkerScript(publicDir: string) {
  const root = path.resolve(publicDir);
  const current = (): ServiceWorkerScript => currentServiceWorkerScript(root);

  return function serveServiceWorker(req: Request, res: Response, next: NextFunction): void {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    let script: ServiceWorkerScript;
    try {
      script = current();
    } catch {
      // No worker on disk (a stripped build stage) — let the static layers answer.
      next();
      return;
    }
    const body = Buffer.from(script.body, "utf8");
    res.setHeader("Content-Type", "text/javascript; charset=UTF-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Service-Worker-Allowed", "/");
    res.setHeader("ETag", `W/"${script.version}"`);
    // res.end() bypasses Express's freshness check, so answer the conditional
    // GET by hand: a worker revalidating an unchanged script gets 304, not the body.
    if (req.fresh) {
      res.status(304).end();
      return;
    }
    res.setHeader("Content-Length", String(body.length));
    if (req.method === "HEAD") {
      res.status(200).end();
      return;
    }
    res.status(200).end(body);
  };
}
