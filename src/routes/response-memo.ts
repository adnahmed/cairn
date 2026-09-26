// The HTTP response memo for the heavy Today/Horizon reads: a repeat GET whose inputs
// have not moved is answered from the body the last compute produced — and a client
// that already holds that body (If-None-Match) gets a 304 — WITHOUT running the read
// again. The key is src/repo/response-freshness.ts: the same row-count/odometer/marker
// signatures the in-process memos trust, plus the date, the device zone and a short
// wall-clock slot, so every write the athlete makes (a set, a meal, a weigh-in, an
// Undo, a directive flipped) and every day rollover moves it.
//
// Three rules keep "freshness beats speed" true:
//   1. A body is remembered only when the freshness key read BEFORE the compute equals
//      the key read AFTER it. A read with side effects (the agenda's "seen" stamp, a
//      week-ahead job it kicks, a backlog it drains) therefore never stores its first
//      answer; the next, side-effect-free compute does. An await that let another
//      request write in between is caught the same way.
//   2. An `{ok:false}` body — the agentic endpoints' designed failure — is never kept.
//   3. The ETag is the body's own digest, so a recompute that lands on the same bytes
//      still answers 304, and one that moved can never be mistaken for the old one.
//
// The body is serialized and gzipped once per stored entry, so a memo hit costs a
// freshness-key read and a buffer write. Bounded (least-recently-served drops first)
// and dropped wholesale by resetTrainingDataCache() (the test isolate) with the rest
// of the training memos.
import crypto from "node:crypto";
import zlib from "node:zlib";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { registerTrainingCacheClear } from "../repo/training-cache.js";
import { responseFreshnessKey } from "../repo/response-freshness.js";

/** Bodies below this stay uncompressed: the gzip header costs more than it saves. */
const MIN_COMPRESS_BYTES = 1024;
const MAX_SLOTS = 96;

type MemoEntry = {
  fresh: string;
  value: unknown;
  body: unknown;
  raw: Buffer;
  gz: Buffer | null | undefined; // undefined = not built yet, null = not worth it
  etag: string;
};

const memo = new Map<string, MemoEntry>();
registerTrainingCacheClear(() => memo.clear());

/** Drop every remembered response (tests, and any caller that must not read one). */
export function resetResponseMemo(): void {
  memo.clear();
}

export type MemoizedReadOptions<T> = {
  /** Only these requests use the memo; the rest compute (and still get an ETag). */
  cacheable?: (req: Request) => boolean;
  /** The JSON body for a computed value (default: the value itself). */
  body?: (value: T) => unknown;
  /** Runs on EVERY serve, hit or miss, after the response is decided. */
  onServe?: (req: Request, value: T) => void;
  /**
   * Runs only on a memo HIT: replays the best-effort side effects the compute runs on
   * every open (a self-heal re-warm, a background job kick), which a hit skips.
   */
  onHit?: (req: Request, value: T) => void;
};

// The slot a request is remembered under: its path plus its query in a stable order.
// `token` is the auth query fallback for direct resource URLs — never part of a read.
function slotFor(name: string, req: Request): string {
  const params = new URLSearchParams();
  const query = (req.query ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(query).sort()) {
    if (key === "token") continue;
    const value = query[key];
    for (const one of Array.isArray(value) ? value : [value]) params.append(key, String(one));
  }
  return `${name} ${req.path ?? ""}?${params.toString()}`;
}

function etagFor(raw: Buffer): string {
  const digest = crypto.createHash("sha1").update(raw).digest("base64").slice(0, 27);
  return `W/"${raw.length.toString(16)}-${digest}"`;
}

/** RFC 9110 If-None-Match: `*` matches anything, otherwise a weak comparison. */
function ifNoneMatchHits(header: string | string[] | undefined, etag: string): boolean {
  const raw = Array.isArray(header) ? header.join(",") : header;
  if (!raw) return false;
  if (raw.trim() === "*") return true;
  // Also tolerate the "-gzip" tag the JSON compression layer appends to its own
  // ETags, so a client that last saw the uncached path still revalidates.
  const bare = (value: string) => value.trim().replace(/^W\//, "").replace(/-gzip"$/, '"');
  return raw.split(",").some((candidate) => bare(candidate) === bare(etag));
}

function acceptsGzip(req: Request): boolean {
  const header = String(req.headers?.["accept-encoding"] || "");
  return /\bgzip\b/i.test(header) && !/\bgzip\s*;\s*q=0(?:\.0*)?\b/i.test(header);
}

function buildEntry(fresh: string, value: unknown, body: unknown): MemoEntry {
  const raw = Buffer.from(JSON.stringify(body ?? null), "utf8");
  return { fresh, value, body, raw, gz: undefined, etag: etagFor(raw) };
}

function send(req: Request, res: Response, entry: MemoEntry): void {
  // A bare response object (a router driven directly, without Express's response
  // prototype) still gets the body the route always answered.
  if (typeof res.setHeader !== "function" || typeof res.end !== "function") {
    res.json(entry.body);
    return;
  }
  res.setHeader("ETag", entry.etag);
  res.setHeader("Vary", "Accept-Encoding");
  if (ifNoneMatchHits(req.headers?.["if-none-match"], entry.etag)) {
    res.status(304).end();
    return;
  }
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  let payload = entry.raw;
  if (entry.raw.length >= MIN_COMPRESS_BYTES && acceptsGzip(req)) {
    if (entry.gz === undefined) {
      try {
        entry.gz = zlib.gzipSync(entry.raw);
      } catch {
        entry.gz = null; // never lose the response to a compression failure: send it plain
      }
    }
    if (entry.gz) {
      res.setHeader("Content-Encoding", "gzip");
      payload = entry.gz;
    }
  }
  res.setHeader("Content-Length", String(payload.length));
  res.end(req.method === "HEAD" ? undefined : payload);
}

function remember(slot: string, entry: MemoEntry): void {
  memo.delete(slot); // re-insert so Map order is least-recently-served first
  memo.set(slot, entry);
  while (memo.size > MAX_SLOTS) {
    const oldest = memo.keys().next().value;
    if (oldest === undefined) break;
    memo.delete(oldest);
  }
}

function isDesignedFailure(body: unknown): boolean {
  return !!body && typeof body === "object" && (body as { ok?: unknown }).ok === false;
}

/**
 * Wrap a read so it is memoized on the response freshness key and answers
 * If-None-Match before computing. `compute` may be sync or async; it must be a
 * read of the request alone (its query), never of a body.
 */
export function memoizedRead<T>(
  name: string,
  compute: (req: Request) => T | Promise<T>,
  options: MemoizedReadOptions<T> = {},
): RequestHandler {
  const project = options.body ?? ((value: T) => value as unknown);
  // Synchronous whenever the read is: only an async compute yields to the loop.
  return function memoizedHandler(req: Request, res: Response, next: NextFunction): void | Promise<void> {
    try {
      const cacheable = options.cacheable ? options.cacheable(req) : true;
      const slot = slotFor(name, req);
      const before = cacheable ? responseFreshnessKey() : null;
      if (before != null) {
        const hit = memo.get(slot);
        if (hit && hit.fresh === before) {
          remember(slot, hit);
          send(req, res, hit);
          try {
            options.onHit?.(req, hit.value as T);
          } catch {
            /* a best-effort kick never fails a served read */
          }
          options.onServe?.(req, hit.value as T);
          return;
        }
      }
      const finish = (value: T): void => {
        if (res.headersSent) return;
        const body = project(value);
        const after = before != null ? responseFreshnessKey() : null;
        const entry = buildEntry(after ?? "", value, body);
        if (before != null && after === before && !isDesignedFailure(body)) remember(slot, entry);
        send(req, res, entry);
        options.onServe?.(req, value);
      };
      const value = compute(req);
      if (value && typeof (value as { then?: unknown }).then === "function") {
        return (value as Promise<T>).then(finish).catch(next);
      }
      finish(value as T);
    } catch (error) {
      next(error);
    }
  };
}
