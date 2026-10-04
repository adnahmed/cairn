// @ts-check
// The overnight digest (docs/DESIGN.md "Today"): what the team changed lately, kept to
// a glance — at most MAX_ROWS lift rows on Today, each ONE line (an arrow, the lift,
// the prescription before → after in its own units) with the decision's one-tap Undo,
// and the explanation under the FIRST row only; everything past the cap is counted in
// the "All changes" link ("+2 more in Changes"), where every row is told in full. At
// most ONE plain question card for a change that genuinely waits on the athlete (a goal
// or clinical draft), answered inline. A held draft the team set aside is not news for
// the day and is not here (Ask › Changes carries it). Pure string builders over
// GET /api/today-digest (src/domain/today/today-digest.ts) and the agenda's
// `draft-proposals` candidate; every server string is escaped. Lives in the lazy
// today-ahead bundle (CairnTodayAhead mounts it).

type TodayDigestRead = import("../contracts/today-digest.js").TodayDigest;
type TodayDigestChangeRow = import("../contracts/today-digest.js").TodayDigestChange;
type TodayDigestMoveRow = import("../contracts/today-digest.js").TodayDigestMove;
type TodayDigestAsk = import("../contracts/client.js").ClientTodayAgendaCandidate;

(() => {
  const ARROW: Record<string, { glyph: string; cls: string; word: string }> = {
    up: { glyph: "↑", cls: "is-up", word: "up" },
    down: { glyph: "↓", cls: "is-down", word: "down" },
    same: { glyph: "=", cls: "is-same", word: "holds" },
    range: { glyph: "↔", cls: "is-range", word: "new rep range" },
    added: { glyph: "+", cls: "is-added", word: "added" },
  };

  function undoButton(change: TodayDigestChangeRow, short: boolean): string {
    if (!change.undo?.available) return "";
    const held = change.state === "announced";
    const label = short ? (held ? "Hold" : "Undo") : change.undo.label || (held ? "Hold" : "Undo");
    const button = CairnDecisionUndo.buttonHtml({ id: change.id, label, attr: "tdg-undo", className: "tdg-undo" });
    // The server's own words name the concrete effect even when the tap says "Undo".
    return short && change.undo.label
      ? button.replace("<button ", `<button title="${escAttr(change.undo.label)}" `)
      : button;
  }

  // At most this many lift rows on Today; the rest wait in Changes, counted on its link.
  const MAX_ROWS = 3;

  // `explain` is true for the digest's first row only: its reason (and an announced
  // change's timing) under the lift. Every other row is the one line.
  function moveRowHtml(move: TodayDigestMoveRow, change: TodayDigestChangeRow, undo: string, explain: boolean): string {
    const arrow = ARROW[move.direction] || ARROW.same;
    const note = explain
      ? [move.reason || "", change.state === "announced" ? change.status_line : ""].filter(Boolean).join(" · ")
      : "";
    return `<div class="tdg-row" data-tdg-row="${escAttr(change.id)}">
      <span class="tdg-arrow ${arrow.cls}" aria-hidden="true">${arrow.glyph}</span>
      <div class="tdg-what"><span class="tdg-ex">${escHtml(move.exercise)}</span><span class="sr-only"> ${escHtml(arrow.word)}</span>${note ? `<small>${escHtml(note)}</small>` : ""}</div>
      <div class="tdg-val">${move.from_text ? `<span class="tdg-from">${escHtml(move.from_text)}</span> ` : ""}<span class="tdg-to num">${escHtml(move.to_text)}</span>${undo}</div>
    </div>`;
  }

  // A change that is not about lifts (a calorie target, a recovery week): its title.
  function changeRowHtml(change: TodayDigestChangeRow, explain: boolean): string {
    return `<div class="tdg-row" data-tdg-row="${escAttr(change.id)}">
      <span class="tdg-arrow is-same" aria-hidden="true">•</span>
      <div class="tdg-what"><span class="tdg-ex">${escHtml(change.title)}</span>${explain && change.status_line ? `<small>${escHtml(change.status_line)}</small>` : ""}</div>
      <div class="tdg-val">${undoButton(change, true)}</div>
    </div>`;
  }

  /** How many rows a change takes in full: one per lift, or one for a change about no lift. */
  function rowCount(change: TodayDigestChangeRow): number {
    return Array.isArray(change.moves) && change.moves.length ? change.moves.length : 1;
  }

  /**
   * One change's rows. `limit` caps how many of its lifts show (the rest are counted on
   * the "All changes" link); `explain` puts the explanation under its first row.
   */
  function changeHtml(change: TodayDigestChangeRow, opts: { limit?: number; explain?: boolean } = {}): string {
    const moves = Array.isArray(change.moves) ? change.moves : [];
    const explain = opts.explain !== false;
    if (!moves.length) return changeRowHtml(change, explain);
    const shown = moves.slice(0, Math.max(1, opts.limit ?? moves.length));
    // One lift: its Undo rides its row. Several: one Undo for the whole change, named
    // by the server ("Restore previous targets"), so a tap never looks like it touches
    // only one of them — kept even when some of its lifts wait in Changes.
    if (moves.length === 1) return moveRowHtml(moves[0], change, undoButton(change, true), explain);
    const rows = shown.map((move, i) => moveRowHtml(move, change, "", explain && i === 0)).join("");
    const undo = undoButton(change, false);
    return `${rows}${undo ? `<div class="tdg-undo-row">${undo}</div>` : ""}`;
  }

  function askHtml(ask: TodayDigestAsk | null | undefined): string {
    if (!ask) return "";
    const payload = (ask.action?.payload ?? null) as { proposal_id?: unknown; count?: unknown } | null;
    const id = Number(payload?.proposal_id);
    const count = Number(payload?.count) || 1;
    const question = String(ask.body || ask.title || "").trim();
    if (!question) return "";
    const answers =
      id > 0
        ? `<button class="btn btn-solid" type="button" data-tdg-apply="${escAttr(id)}">Yes, make the change</button><button class="btn" type="button" data-tdg-keep="${escAttr(id)}">Keep my plan</button>`
        : `<button class="btn" type="button" data-tdg-review>Review</button>`;
    const more =
      count > 1 && id > 0
        ? `<button class="linkbtn-quiet" type="button" data-tdg-review>${escHtml(`${count - 1} more waiting`)}</button>`
        : "";
    return `<div class="tdg-ask" role="group" aria-label="A question for you">
      <span class="lbl tdg-ask-k">One question</span>
      <p class="tdg-ask-q">${escHtml(question)}</p>
      <div class="tdg-ask-btns">${answers}<button class="linkbtn-quiet" type="button" data-tdg-talk="${escAttr(question)}">Talk it through</button>${more}</div>
    </div>`;
  }

  /** The whole digest; "" when the team changed nothing and asks nothing. */
  function digestHtml(digest: TodayDigestRead | null | undefined, ask?: TodayDigestAsk | null): string {
    const changes = Array.isArray(digest?.changes) ? digest!.changes : [];
    const question = askHtml(ask);
    if (!changes.length && !question) return "";
    const head = digest?.headline ? `${digest.when || "Lately"} · ${digest.headline}` : "From the team";
    let room = MAX_ROWS;
    let carried = 0;
    let shownRows = 0;
    const rows: string[] = [];
    for (const change of changes) {
      const count = rowCount(change);
      carried += count;
      if (room <= 0) continue;
      const shown = Math.min(count, room);
      rows.push(changeHtml(change, { limit: shown, explain: rows.length === 0 }));
      shownRows += shown;
      room -= shown;
    }
    // The payload carries a capped list of changes; the server's own total counts the
    // ones past that cap too, so "+N more" never undercounts what Changes holds.
    const total = Math.max(carried, Number(digest?.total_rows) || 0);
    const hidden = Math.max(0, total - shownRows);
    const all = hidden > 0 ? `+${hidden} more in Changes` : "All changes";
    return `<section class="tdg" aria-label="What the team did">
      <div class="tdg-head"><span class="lbl">${escHtml(head)}</span><button class="linkbtn-quiet tdg-all" type="button" data-tdg-all>${escHtml(all)}</button></div>
      ${question}
      ${rows.length ? `<div class="tdg-moves">${rows.join("")}</div>` : ""}
    </section>`;
  }

  const CAIRN_TODAY_DIGEST = { html: digestHtml, askHtml, changeHtml, ARROW, MAX_ROWS };

  Object.assign(globalThis, { CairnTodayDigest: CAIRN_TODAY_DIGEST });
})();
