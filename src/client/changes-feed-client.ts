// @ts-check
// The Changes feed renderer (docs/V2-PLAN.md wave 1, docs/DESIGN.md "Component
// architecture"). Pure: it frames the finished server read from GET /api/brain/changes
// — what changed, why in the spoken voice, one of the four fixed outcome phrases, a
// confidence word and the server-labelled Undo — grouped by day. It never works a word
// out again (contract rule 6), fetches nothing and wires nothing; the controller
// (changes-feed-controller.ts) owns loading, the seen marker and Undo.
{
  type BrainChanges = import("../contracts/brain-changes.js").ClientBrainChanges;
  type BrainChange = import("../contracts/brain-changes.js").ClientBrainChange;
  type BrainChangeDay = import("../contracts/brain-changes.js").ClientBrainChangeDay;

  type ChangesFeedRowOptions = {
    /** Stagger index for the first-paint `.reveal` entrance; omitted means no entrance. */
    index?: number | null;
    /** A row that just arrived into a painted feed eases in with `settle-in`. */
    enter?: boolean;
    /** The row the athlete just changed: its accent washes once (`is-settled`). */
    settled?: boolean;
  };

  type ChangesFeedOptions = {
    /** First paint gets the row stagger; an in-place upgrade does not re-flash it. */
    reveal?: boolean;
    /** Rows arriving into a surface that was showing something else ease in with `settle-in`. */
    enter?: boolean;
  };

  // The outcome key picks the tone word the reading layer already uses — never a new
  // vocabulary, and never the only signal (the phrase itself is printed).
  const OUTCOME_TONE: Record<string, string> = {
    as_expected: "ok",
    not_as_expected: "watch",
    too_early: "quiet",
    stopped: "quiet",
  };

  const STATES = new Set(["announced", "applied", "reverted", "held"]);

  // The stone a change belongs to, by its decision domain: its dot leads the row in that
  // stone's own hue. A domain the palette has no stone for keeps the team's ink dot.
  const DOMAIN_STONE: Record<string, string> = {
    training: "strength",
    train: "strength",
    strength: "strength",
    running: "endurance",
    endurance: "endurance",
    nutrition: "fuel",
    fuel: "fuel",
    recovery: "recovery",
    recover: "recovery",
    sleep: "recovery",
    body: "body",
    health: "heart",
    labs: "heart",
    recheck: "heart",
  };

  function dotHtml(change: BrainChange): string {
    const stone = DOMAIN_STONE[text(change.domain).toLowerCase()];
    return `<span class="dot chfeed-dot${stone ? ` stone-${stone}` : " is-team"}" aria-hidden="true"></span>`;
  }

  function text(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }

  /** The Undo action attribute for a row: an announced change is held, a landed one is put back. */
  function undoAttr(change: BrainChange): string {
    return change.state === "announced" ? "chfeed-hold" : "chfeed-undo";
  }

  function undoHtml(change: BrainChange): string {
    const undo = change.undo;
    if (!undo || undo.available !== true) return "";
    return CairnDecisionUndo.buttonHtml({
      id: change.id,
      label: undo.label,
      attr: undoAttr(change),
      className: "linkbtn-quiet chfeed-undo",
    });
  }

  function metaHtml(change: BrainChange): string {
    const status = text(change.status_line);
    const confidence = text(change.confidence);
    const parts: string[] = [];
    if (status) parts.push(`<span class="chfeed-status">${escHtml(status)}</span>`);
    if (confidence) {
      parts.push(
        `<span class="chfeed-conf" data-conf="${escAttr(confidence)}"><span class="chfeed-conf-k">confidence</span> ${escHtml(confidence)}</span>`
      );
    }
    return parts.length
      ? `<p class="chfeed-meta">${parts.join('<span class="chfeed-sep" aria-hidden="true"> · </span>')}</p>`
      : "";
  }

  function outcomeHtml(change: BrainChange): string {
    const phrase = text(change.outcome?.phrase);
    if (!phrase) return "";
    const tone = OUTCOME_TONE[String(change.outcome?.key)] || "quiet";
    return `<p class="chfeed-outcome chfeed-outcome-${tone}">${escHtml(phrase)}</p>`;
  }

  /** One change. `data-chfeed-id` is the key the controller patches a single row by. */
  function rowHtml(change: BrainChange, options: ChangesFeedRowOptions = {}): string {
    const title = text(change.title);
    if (!title) return "";
    const state = STATES.has(change.state) ? change.state : "applied";
    const classes = ["chfeed-row", `is-${state}`];
    if (change.new === true) classes.push("is-new");
    if (options.enter) classes.push("settle-in");
    else if (options.index != null) classes.push("reveal");
    if (options.settled) classes.push("is-settled");
    const stagger =
      !options.enter && options.index != null ? ` style="--i:${Math.max(0, Math.trunc(options.index))}"` : "";
    const why = text(change.why);
    const fresh = change.new === true ? `<span class="chfeed-new">New</span>` : "";
    return `<li class="${classes.join(" ")}" data-chfeed-id="${escAttr(change.id)}"${stagger}>
      <div class="chfeed-head">${dotHtml(change)}<p class="chfeed-title">${escHtml(title)}</p>${fresh}</div>
      ${why ? `<p class="chfeed-why">${escHtml(why)}</p>` : ""}
      ${outcomeHtml(change)}
      ${metaHtml(change)}
      ${undoHtml(change)}
    </li>`;
  }

  /** A day's printed label: the server's word ("Today"), else its date. */
  function dayLabel(day: BrainChangeDay): string {
    return text(day.label) || text(day.day);
  }

  /** One day group around already-rendered rows; with none, the empty shell the controller fills. */
  function dayShellHtml(day: BrainChangeDay, rows = ""): string {
    return `<section class="chfeed-day" data-chfeed-day="${escAttr(day.day)}">
      <h2 class="lbl chfeed-day-label">${escHtml(dayLabel(day))}</h2>
      <ol class="chfeed-rows">${rows}</ol>
    </section>`;
  }

  function dayHtml(day: BrainChangeDay, start: number, options: ChangesFeedOptions): string {
    const rows = (Array.isArray(day.changes) ? day.changes : [])
      .map((change, i) => rowHtml(change, { index: options.reveal ? start + i : null, enter: options.enter }))
      .filter(Boolean);
    return rows.length ? dayShellHtml(day, rows.join("")) : "";
  }

  function emptyHtml(): string {
    return CairnUi.emptyStateHtml({
      title: "Nothing has changed lately",
      body: "When the team adjusts your training or meals, what changed, why, and an Undo arrive here.",
      className: "empty-state chfeed-empty",
    });
  }

  /** The whole feed: day groups, newest first, or the calm empty state. */
  function feedHtml(data: BrainChanges | null | undefined, options: ChangesFeedOptions = {}): string {
    const days = data && Array.isArray(data.days) ? data.days : [];
    let start = 0;
    const html = days
      .map((day) => {
        const out = dayHtml(day, start, options);
        start += Array.isArray(day.changes) ? day.changes.length : 0;
        return out;
      })
      .join("");
    return html ? `<div class="chfeed">${html}</div>` : emptyHtml();
  }

  /** A calm one-sentence failure with a way to try again; the surface is otherwise untouched. */
  function errorHtml(): string {
    return `<div class="chfeed-error" role="status" aria-live="polite">
      <p class="chfeed-error-line">Couldn't reach the record of changes just now.</p>
      <button class="linkbtn-quiet chfeed-retry" type="button" data-chfeed-retry="1">Try again</button>
    </div>`;
  }

  const CAIRN_CHANGES_FEED = {
    feedHtml,
    rowHtml,
    dayShellHtml,
    dayLabel,
    errorHtml,
    undoAttr,
  };

  Object.assign(globalThis, { CairnChangesFeed: CAIRN_CHANGES_FEED });
}
