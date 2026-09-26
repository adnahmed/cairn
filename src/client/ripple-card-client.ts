// @ts-check
// The what-if ripple card, the view (v2 wave 5, "Ask"; Atelier v2 in wave 6): inline in
// the Ask thread, laid out as the thread itself is. The athlete's question sits as their
// own ink bubble on the right; the team's answer is a wide surface bubble on the left —
// ONE change in plain words, then its ripple as rows, one per stone: the stone's dot in
// its own hue, its name, the why in a sentence and "now → then" in the server's words,
// with the team's confidence as a word. A stone that holds steady is one quiet line. No
// number, no score, no ranking. "Do it" hands the change to the team; "Not now" puts the
// card away. Pure strings; wired by CairnRippleCardController.
{
  type BrainChange = import("../contracts/brain-changes.js").ClientBrainChange;

  const CAPTION = "Talking it through with the team";

  function shell(state: string, inner: string, extra = ""): string {
    return `<section class="ripple-card" data-ripple-state="${escAttr(state)}" aria-label="What if"${extra}>${inner}</section>`;
  }

  /** The question as the athlete's own bubble: "What if" leads it, their words follow. */
  function questionHtml(question: string): string {
    const body = CairnRippleCardModel.questionBody(question);
    return `<div class="ripple-me"><p class="ripple-kicker lbl">What if</p>${
      body ? `<p class="ripple-question">${escHtml(body)}</p>` : ""
    }</div>`;
  }

  /** The team's side of the exchange: who is speaking, then the answer. */
  function teamHtml(inner: string): string {
    return `<div class="ripple-team"><div class="ripple-who lbl"><span class="dot is-team" aria-hidden="true"></span>Team</div>${inner}</div>`;
  }

  /** Step one: the question, in the athlete's words. Nothing is sent until they ask. */
  function askHtml(opts: { draft?: string } = {}): string {
    const draft = typeof opts.draft === "string" ? opts.draft : "";
    return shell(
      "ask",
      `<form class="ripple-ask" data-ripple-ask>
        <label class="ripple-kicker lbl" for="rippleAskInput">What if</label>
        <textarea id="rippleAskInput" class="ripple-input" rows="2" maxlength="1000" placeholder="…I ran four days a week instead of three?" data-ripple-input>${escHtml(draft)}</textarea>
        <p class="ripple-hint">The team shows what it would touch. Nothing changes unless you say so.</p>
        <div class="ripple-actions">
          <button class="pillbtn pill-accent ripple-go" type="submit" data-ripple-go>Ask the team</button>
          <button class="linkbtn-quiet ripple-later" type="button" data-ripple-later>Not now</button>
        </div>
      </form>`
    );
  }

  /** Ghost rows in the ripple's own shape while the team reads it. */
  function ghostStonesHtml(): string {
    const items = Array.from(
      { length: 6 },
      () =>
        `<li class="ripple-stone"><span class="ripple-stone-mark hshimmer" aria-hidden="true"></span><span class="ripple-stone-ghost hshimmer hshimmer-sm" aria-hidden="true"></span></li>`
    ).join("");
    return `<ul class="ripple-stones ripple-stones-skel" aria-hidden="true">${items}</ul>`;
  }

  // The job worker's own status words ("queued", "running") are machine register, not the
  // team talking — the calm caption stands through them (as agent-job-client does).
  const WORKER_PHASE = /^(queued|running|pending|deferred|waiting|retrying)\b/i;

  /** The thinking caption for a job phase: a spoken phase, or the calm default. */
  function captionFor(phase?: unknown): string {
    const raw = typeof phase === "string" ? phase.trim() : "";
    const said = raw && !WORKER_PHASE.test(raw) ? raw : CAPTION;
    return `${said.charAt(0).toUpperCase()}${said.slice(1)}…`;
  }

  function thinkingHtml(question: string, phase?: string | null): string {
    const caption = captionFor(phase);
    return shell(
      "thinking",
      `${questionHtml(question)}${teamHtml(`<p class="ripple-caption" role="status">${escHtml(caption)}</p>${ghostStonesHtml()}`)}`,
      ` aria-busy="true"`
    );
  }

  /**
   * The row's spoken name. The visible head is aria-hidden (it would read out of order),
   * so the why and its confidence ride here too — a screen reader hears the team's reason.
   */
  function stoneLabel(stone: ClientRippleStone): string {
    const where =
      stone.moved && stone.after.word !== stone.before.word
        ? `${stone.label}: ${stone.before.word} now, ${stone.after.word} after`
        : `${stone.label}: ${stone.after.word}`;
    if (!(stone.moved && stone.why)) return where;
    const conf = stone.confidence ? ` (${stone.confidence})` : "";
    return `${where}. ${stone.why}${conf}`;
  }

  /** The stone's key as a class, only for the six the stone palette knows. */
  const STONE_KEYS = new Set(["strength", "endurance", "recovery", "fuel", "body", "heart"]);

  function whyHtml(stone: ClientRippleStone): string {
    return `<span class="ripple-why"><span class="ripple-why-k ripple-stone-label">${escHtml(stone.label)}</span> <span class="ripple-why-t">${escHtml(
      stone.why
    )}</span> <span class="ripple-why-conf" data-conf="${escAttr(stone.confidence)}">${escHtml(stone.confidence)}</span></span>`;
  }

  /**
   * One row: the stone's dot, its name (with the why, when it moves), and where it
   * stands now → where it would likely sit, in the server's words. The tone rides as a
   * class and colours only the word, never the stone.
   */
  function stoneHtml(stone: ClientRippleStone, index: number): string {
    const shifted = stone.moved && stone.after.word !== stone.before.word;
    const shift = shifted
      ? `<span class="ripple-stone-was">${escHtml(stone.before.word)}</span><span class="ripple-stone-to" aria-hidden="true"> → </span>`
      : "";
    const hue = STONE_KEYS.has(stone.key) ? ` stone-${stone.key}` : "";
    const cls = `ripple-stone ripple-${stone.after.tone}${stone.moved ? " is-moved" : ""}${hue}`;
    const head =
      stone.moved && stone.why ? whyHtml(stone) : `<span class="ripple-stone-label">${escHtml(stone.label)}</span>`;
    return `<li class="${cls}" style="--i:${index}" data-ripple-stone="${escAttr(stone.key)}" aria-label="${escAttr(stoneLabel(stone))}">
      <span class="ripple-stone-mark" aria-hidden="true"></span>
      <span class="ripple-stone-head" aria-hidden="true">${head}</span>
      <span class="ripple-stone-word" aria-hidden="true">${shift}<span class="ripple-stone-now">${escHtml(stone.after.word)}</span></span>
    </li>`;
  }

  /** The ripple: one row per stone, in the server's order. */
  function stonesHtml(stones: ClientRippleStone[]): string {
    if (!stones.length) return "";
    return `<ul class="ripple-stones" aria-label="What it would touch">${stones.map(stoneHtml).join("")}</ul>`;
  }

  /** When nothing is expected to move, one calm line says so (the rows stay quiet). */
  function whysHtml(stones: ClientRippleStone[]): string {
    // No stones read is an absence, not a claim that nothing moves: say nothing.
    if (!stones.length) return "";
    const moved = stones.filter((s) => s.moved && s.why);
    return moved.length ? "" : `<p class="ripple-still">The team doesn't expect much to move from this.</p>`;
  }

  function noteHtml(answer: ClientRippleAnswer): string {
    if (answer.clinical) {
      return `<p class="ripple-note">This touches something clinical, so if you hand it over it waits on your yes.</p>`;
    }
    if (answer.doable) return "";
    const line =
      answer.kind === "goal"
        ? "A goal is yours to name. Say it in your own words and the team takes it from there."
        : "This one is better talked through than drafted.";
    return `<p class="ripple-note">${escHtml(line)}</p>`;
  }

  function actionsHtml(answer: ClientRippleAnswer): string {
    const primary = answer.doable
      ? `<button class="pillbtn pill-accent ripple-do" type="button" data-ripple-do>Do it</button>`
      : `<button class="pillbtn ripple-talk" type="button" data-ripple-talk>Talk it through</button>`;
    return `<div class="ripple-actions" data-ripple-actions>${primary}<button class="linkbtn-quiet ripple-later" type="button" data-ripple-later>Not now</button></div>`;
  }

  /** The answer: the change in words, the ripple, the whys and the two choices. */
  function answerHtml(answer: ClientRippleAnswer, opts: { enter?: boolean } = {}): string {
    const enter = opts.enter ? " is-entering" : "";
    return shell(
      "answer",
      `${questionHtml(answer.question)}${teamHtml(`
      <p class="ripple-change">${escHtml(answer.summary)}</p>
      <div class="ripple-wave${enter}">${stonesHtml(answer.stones)}</div>
      ${whysHtml(answer.stones)}
      ${noteHtml(answer)}
      ${actionsHtml(answer)}
      <div class="ripple-handed" data-ripple-handed hidden></div>`)}`
    );
  }

  /** A calm one-sentence failure with a way to ask again; nothing changed. */
  function failedHtml(question: string, message?: string | null): string {
    const said =
      typeof message === "string" && message.trim() ? message.trim() : "the team couldn't read this what-if right now";
    const line = `${said.charAt(0).toUpperCase()}${said.slice(1)}. Nothing changed.`;
    return shell(
      "failed",
      `${questionHtml(question)}${teamHtml(`<p class="ripple-caption" role="status">${escHtml(line)}</p>
      <div class="ripple-actions"><button class="pillbtn ripple-retry" type="button" data-ripple-retry>Ask again</button><button class="linkbtn-quiet ripple-later" type="button" data-ripple-later>Not now</button></div>`)}`
    );
  }

  /**
   * How the team took it. With the Changes feed's own row for the decision, the card
   * prints that row — the same title, status line and server-labelled Undo the feed
   * shows; without one, the framing line and the way to the record of changes.
   */
  function handedHtml(handed: ClientRippleHanded, row: BrainChange | null = null): string {
    const feedRow = row ? CairnChangesFeed.rowHtml(row, { enter: true, settled: true }) : "";
    const body = feedRow
      ? `<ol class="chfeed-rows ripple-feed">${feedRow}</ol>`
      : `<p class="ripple-handed-line" data-ripple-handed-state="${escAttr(handed.state)}">${escHtml(handed.line)}</p>`;
    const link =
      handed.state === "refused"
        ? ""
        : `<button class="linkbtn-quiet ripple-changes" type="button" data-ripple-changes>See Changes ›</button>`;
    return `${body}${link}`;
  }

  const CAIRN_RIPPLE_CARD = {
    askHtml,
    captionFor,
    thinkingHtml,
    answerHtml,
    failedHtml,
    handedHtml,
    stonesHtml,
  };

  Object.assign(globalThis, { CairnRippleCard: CAIRN_RIPPLE_CARD });
}
