import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDocument,
  createFakeTimers,
  createHost,
  fire,
  flush,
  listenerCount,
  loadClientModule,
  renderHtml,
} from "./_dom.mjs";

// The shared DOM harness (test/_dom.mjs) is what client renderer tests stand on, so its
// own behavior is pinned here: a wrong parse or a missed bubble would make those tests
// pass for the wrong reason.

test("innerHTML parses renderer markup into a queryable tree and reads back verbatim", () => {
  const html = `<section class="card is-open" data-card-id="7"><h2 class="lbl">Data &amp; backup</h2>
    <input type="checkbox" id="opt" checked><button id="go" class="ghostbtn" style="width:100%;display:none">Go</button>
    <svg viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg><!-- note --><ul><li>one</li><li>two</li></ul></section>`;
  const host = renderHtml(html);

  assert.equal(host.innerHTML, html);
  assert.equal(renderHtml("<ul><li>one<li>two</ul>").innerHTML, "<ul><li>one</li><li>two</li></ul>");
  const card = host.querySelector("section.card");
  assert.equal(card.dataset.cardId, "7");
  assert.equal(card.classList.contains("is-open"), true);
  assert.equal(host.querySelector("h2").textContent, "Data & backup");
  assert.equal(host.querySelector("#opt").checked, true);
  assert.equal(host.querySelector("#go").style.display, "none");
  assert.equal(host.querySelector("svg path").getAttribute("d"), "M0 0L10 10");
  assert.equal(host.querySelector("path").tagName, "path");
  assert.deepEqual(
    host.querySelectorAll("li").map((li) => li.textContent),
    ["one", "two"]
  );
});

test("selectors cover the combinators, attribute operators and structural pseudo-classes", () => {
  const host = renderHtml(
    `<div class="a"><p class="x" data-k="one two">1</p><p class="x y" data-k="three">2</p><span lang="en-US">3</span></div><p class="x">4</p>`
  );
  const texts = (sel) => host.querySelectorAll(sel).map((el) => el.textContent);

  assert.deepEqual(texts(".a > .x"), ["1", "2"]);
  assert.deepEqual(texts("div .x.y"), ["2"]);
  assert.deepEqual(texts('[data-k~="two"]'), ["1"]);
  assert.deepEqual(texts("[data-k^=th]"), ["2"]);
  assert.deepEqual(texts('[lang|="en"]'), ["3"]);
  assert.deepEqual(texts(".x + .x, span"), ["2", "3"]);
  assert.deepEqual(texts(".x ~ span"), ["3"]);
  assert.deepEqual(texts("p:not(.y)"), ["1", "4"]);
  assert.deepEqual(texts(".a > :first-child, .a > :last-child"), ["1", "3"]);
  assert.deepEqual(texts(":scope > p"), ["4"]);
  assert.equal(host.querySelector("span").closest(".a").className, "a");
  assert.throws(() => host.querySelector("p::before"), /unsupported selector/);
});

test("events capture and bubble to the document and window, and click() awaits async handlers", async () => {
  const win = loadClientModule([], {});
  const host = createHost(win.document, {
    html: `<div data-row><button type="button" data-act="save">Save</button></div>`,
  });
  const seen = [];
  win.addEventListener("click", () => seen.push("window"));
  win.document.addEventListener("click", () => seen.push("document"), { capture: true });
  host.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-act]");
    await Promise.resolve();
    seen.push(`host:${button.dataset.act}`);
  });

  await host.querySelector("button").click();
  assert.deepEqual(seen, ["document", "window", "host:save"]);

  const event = await fire(host.querySelector("[data-row]"), "keydown", { key: "Enter" });
  assert.equal(event.key, "Enter");
  assert.equal(event.defaultPrevented, false);
});

test("listeners registered with an AbortSignal are removed when it aborts", async () => {
  const host = createHost(createDocument());
  const controller = new AbortController();
  let taps = 0;
  host.addEventListener(
    "click",
    () => {
      taps += 1;
    },
    { signal: controller.signal }
  );
  assert.equal(listenerCount(host, "click"), 1);

  await host.click();
  controller.abort();
  await host.click();

  assert.equal(taps, 1);
  assert.equal(listenerCount(host), 0);
});

test("checkbox click toggles and fires change; a submit button submits its form", async () => {
  const host = renderHtml(`<form><input type="checkbox" id="c"><button id="s">Send</button></form>`);
  const changes = [];
  let submits = 0;
  host.addEventListener("change", (event) => changes.push(event.target.checked));
  host.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    submits += 1;
  });

  await host.querySelector("#c").click();
  await host.querySelector("#s").click();

  assert.deepEqual(changes, [true]);
  assert.equal(submits, 1);
});

test("isConnected follows the tree, and focus lands on document.activeElement", () => {
  const doc = createDocument();
  const host = createHost(doc, { html: `<input id="i">` });
  const input = host.querySelector("#i");
  input.focus();
  assert.equal(doc.activeElement, input);

  host.remove();
  assert.equal(host.isConnected, false);
  assert.equal(doc.activeElement, doc.body);
});

test("loadClientModule runs a built module in a sandbox with the harness globals", () => {
  const win = loadClientModule("html-utils");
  assert.equal(win.escAttr(`<b title="x">&</b>`), "&lt;b title=&quot;x&quot;&gt;&amp;&lt;/b&gt;");
  assert.equal(win.window, win);
  assert.equal(win.document.defaultView, win);
});

test("fake timers only run when the test advances them", () => {
  const timers = createFakeTimers();
  const ran = [];
  timers.setTimeout(() => ran.push("t100"), 100);
  timers.requestAnimationFrame(() => ran.push("raf"));
  assert.deepEqual(ran, []);
  timers.tick(50);
  assert.deepEqual(ran, ["raf"]);
  timers.tick(50);
  assert.deepEqual(ran, ["raf", "t100"]);
  assert.equal(timers.pending, 0);
});

test("flush drains chained microtasks", async () => {
  let done = false;
  Promise.resolve()
    .then(() => Promise.resolve())
    .then(() => {
      done = true;
    });
  await flush();
  assert.equal(done, true);
});
