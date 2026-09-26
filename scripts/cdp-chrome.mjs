// Headless Chrome over the DevTools protocol, dependency-free: find a Chrome, launch
// it on a free loopback debug port with a throwaway profile, and speak CDP over
// Node's built-in WebSocket. Shared by the browser smoke (scripts/smoke-browser.mjs)
// and the screenshot harness (scripts/capture-screens.mjs); neither is part of
// `npm test`.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { root, sleep } from "./smoke-server.mjs";

const DEBUG_PORT_MIN = 25000;
const DEBUG_PORT_SPAN = 5000;
const CDP_WAIT_TIMEOUT_MS = 20000;

export const chromeCandidates = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
].filter(Boolean);

export function chromeBinary() {
  for (const candidate of chromeCandidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Chrome not found. Set CHROME_BIN to a Chrome/Chromium binary. Checked: ${chromeCandidates.join(", ")}`);
}

export function debugPort() {
  const explicit = process.env.SMOKE_CHROME_PORT ? Number(process.env.SMOKE_CHROME_PORT) : 0;
  if (explicit) return explicit;
  return DEBUG_PORT_MIN + Math.floor(Math.random() * DEBUG_PORT_SPAN);
}

export async function freeDebugPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", (error) => {
      // Some locked-down sandboxes reject a throwaway listen() probe even though
      // Chrome itself can still bind a remote-debugging port. In that case keep
      // the historical randomized-port fallback instead of failing before Chrome.
      if (error?.code === "EPERM" || error?.code === "EACCES") resolve(debugPort());
      else reject(error);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => {
        if (port) resolve(port);
        else reject(new Error("could not allocate a Chrome debug port"));
      });
    });
  });
}

export function tail(log) {
  return String(log || "").split("\n").slice(-20).join("\n");
}

export async function waitForJson(port, child, logRef, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    if (child.exitCode != null || child.signalCode != null) {
      throw new Error(`Chrome exited before CDP was ready\n${tail(logRef())}`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return await res.json();
    } catch (error) {
      lastError = error?.cause?.code || error?.cause?.message || error?.message || String(error);
    }
    await sleep(100);
  }
  throw new Error(`Chrome CDP did not become ready on ${port}${lastError ? ` (${lastError})` : ""}\n${tail(logRef())}`);
}

export async function launchChrome({ windowSize = "390,844", profilePrefix = "cairn-browser-smoke-" } = {}) {
  const bin = chromeBinary();
  let lastError = null;
  const explicitPort = process.env.SMOKE_CHROME_PORT ? debugPort() : 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = explicitPort ? explicitPort + attempt : await freeDebugPort();
    const profileDir = mkdtempSync(path.join(tmpdir(), profilePrefix));
    const args = [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-extensions",
      "--disable-sync",
      "--disable-dev-shm-usage",
      `--window-size=${windowSize}`,
      "about:blank",
    ];
    if (process.env.CAIRN_CHROME_NO_SANDBOX === "1") args.unshift("--no-sandbox");
    const child = spawn(bin, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    child.stdout.on("data", (d) => { log += d.toString(); });
    child.stderr.on("data", (d) => { log += d.toString(); });
    try {
      await waitForJson(port, child, () => log);
      return { bin, child, port, profileDir, log: () => log };
    } catch (error) {
      lastError = error;
      try { child.kill("SIGKILL"); } catch {}
      try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
      if (process.env.SMOKE_CHROME_PORT) break;
    }
  }
  throw lastError || new Error("Chrome launch failed");
}

export async function stopChrome(ctx) {
  try {
    if (ctx?.child && ctx.child.exitCode == null && ctx.child.signalCode == null) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 1500);
        ctx.child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        ctx.child.kill("SIGKILL");
      });
    }
  } finally {
    if (ctx?.profileDir) {
      try { rmSync(ctx.profileDir, { recursive: true, force: true }); } catch {}
    }
  }
}

export class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.waiters = [];
    this.opened = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP socket did not open within 10s")), 10000);
      this.ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.ws.addEventListener("error", (event) => {
        clearTimeout(timer);
        const message = event && typeof event === "object" && "message" in event ? String(event.message) : "CDP socket error";
        reject(new Error(message));
      }, { once: true });
    });
    this.ws.addEventListener("message", (event) => this.onMessage(event.data));
    this.ws.addEventListener("close", () => {
      for (const pending of this.pending.values()) pending.reject(new Error("CDP socket closed"));
      this.pending.clear();
      for (const waiter of this.waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("CDP socket closed"));
      }
      this.waiters = [];
    });
  }

  onMessage(data) {
    const msg = JSON.parse(typeof data === "string" ? data : Buffer.from(data).toString("utf8"));
    if (msg.id && this.pending.has(msg.id)) {
      const pending = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) pending.reject(new Error(`${pending.method} failed: ${msg.error.message || JSON.stringify(msg.error)}`));
      else pending.resolve(msg.result || {});
      return;
    }
    for (const waiter of [...this.waiters]) {
      if (waiter.method === msg.method && waiter.predicate(msg.params || {})) {
        clearTimeout(waiter.timer);
        this.waiters = this.waiters.filter((item) => item !== waiter);
        waiter.resolve(msg.params || {});
      }
    }
    for (const listener of this.listeners || []) listener(msg);
  }

  async command(method, params = {}) {
    await this.opened;
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      this.ws.send(payload);
    });
  }

  on(listener) {
    this.listeners ||= [];
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((item) => item !== listener);
    };
  }

  waitFor(method, predicate = () => true, timeoutMs = CDP_WAIT_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const waiter = {
        method,
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter((item) => item !== waiter);
          reject(new Error(`timed out waiting for ${method}`));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  close() {
    try { this.ws.close(); } catch {}
  }
}
