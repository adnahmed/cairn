// @ts-check
// The what-if ripple card, the view (v2 wave 5, "Ask"): inline in the Ask thread. The
// athlete asks a hypothetical in words; the team's answer is ONE change in plain words
// and its ripple across the six stones — a mini pebble row where each stone shows where
// it stands now and where it would likely sit, in the server's words and tones — then a
// line of why for each stone that moves, with the team's confidence as a word. No
// number, no score, no ranking. "Do it" hands the change to the team; "Not now" puts
// the card away. Pure strings; wired by CairnRippleCardController.
{
  type BrainChange = import("../contracts/brain-changes.js").ClientBrainChange;

  const CAPTION = "Talking it through with the team";

  function shell(state: string, inner: string, extra = ""): string {
    return `<section class="ripple-card" data-ripple-state="${escAttr(state)}" aria-label="What if"${extra}>${inner}</section>`;
  }

  function questionHtml(question: string): string {
    const body = CairnRippleCardModel.questionBody(question);
    return body
      ? `<p class="ripple-kicker lbl">What if</p><p class="ripple-question">${escHtml(body)}</p>`
      : `<p class="ripple-kicker lbl">What if</p>`;
  }

  /** Step one: the question, in the athlete's words. Nothing is sent until they ask. */
  function askHtml(opts: { draft?: string } = {}): string {
    const draft = typeof opts.draft === "string" ? opts.draft : "";
    return shell(
      "ask",
      `<form class="ripple-ask" data-ripple-ask>
        <label class="ripple-kicker lbl" for="rippleAskInput">What if</label>
        <textarea id="rippleAskInput" class="ripple-input" rows="2" maxlength="1000" placeholder="…I ran four days a week instead of three?" data-ripple-input>${escHtml(draft)}</textarea>
        <p class="ripple-hint">The team reads it against today and shows what it would touch. Nothing changes unless you say so.</p>
        <div class="ripple-actions">
          <button class="pillbtn pill-accent ripple-go" type="submit" data-ripple-go>Ask the team</button>
          <button class="linkbtn-quiet ripple-later" type="button" data-ripple-later>Not now</button>
        </div>
      </form>`
    );
  }

  /** Six ghost stones in the ripple's own shape while the team reads it. */
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
      `${questionHtml(question)}${ghostStonesHtml()}<p class="ripple-caption" role="status">${escHtml(caption)}</p>`,
      ` aria-busy="true"`
    );
  }

  function stoneLabel(stone: ClientRippleStone): string {
    return stone.moved && stone.after.word !== stone.before.word
      ? `${stone.label}: ${stone.before.word} now, ${stone.after.word} after`
      : `${stone.label}: ${stone.after.word}`;
  }

  function stoneHtml(stone: ClientRippleStone, index: number): string {
    const shift =
      stone.moved && stone.after.word !== stone.before.word
        ? `<span class="ripple-stone-was">${escHtml(stone.before.word)}</span><span class="ripple-stone-to" aria-hidden="true">→</span>`
        : "";
    const cls = `ripple-stone ripple-${stone.after.tone}${stone.moved ? " is-moved" : ""}`;
    return `<li class="${cls}" style="--i:${index}" data-ripple-stone="${escAttr(stone.key)}" aria-label="${escAttr(stoneLabel(stone))}">
      <span class="ripple-stone-mark" aria-hidden="true"></span>
      <span class="ripple-stone-label" aria-hidden="true">${escHtml(stone.label)}</span>
      <span class="ripple-stone-word" aria-hidden="true">${shift}<span class="ripple-stone-now">${escHtml(stone.after.word)}</span></span>
    </li>`;
  }

  /** The mini pebble row: all six stones, in the server's order. */
  function stonesHtml(stones: ClientRippleStone[]): string {
    if (!stones.length) return "";
    return `<ul class="ripple-stones" aria-label="What it would touch">${stones.map(stoneHtml).join("")}</ul>`;
  }

  /** One line of why per stone that moves, with the team's confidence as a word. */
  function whysHtml(stones: ClientRippleStone[]): string {
    // No stones read is an absence, not a claim that nothing moves: say nothing.
    if (!stones.length) return "";
    const moved = stones.filter((s) => s.moved && s.why);
    if (!moved.length) return `<p class="ripple-still">The team doesn't expect much to move from this.</p>`;
    return `<ul class="ripple-whys">${moved
      .map(
        (s) =>
          `<li class="ripple-why"><span class="ripple-why-k">${escHtml(s.label)}</span> <span class="ripple-why-t">${escHtml(
            s.why
          )}</span> <span class="ripple-why-conf" data-conf="${escAttr(s.confidence)}">${escHtml(s.confidence)}</span></li>`
      )
      .join("")}</ul>`;
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
      `${questionHtml(answer.question)}
      <p class="ripple-change">${escHtml(answer.summary)}</p>
      <div class="ripple-wave${enter}">${stonesHtml(answer.stones)}</div>
      ${whysHtml(answer.stones)}
      ${noteHtml(answer)}
      ${actionsHtml(answer)}
      <div class="ripple-handed" data-ripple-handed hidden></div>`
    );
  }

  /** A calm one-sentence failure with a way to ask again; nothing changed. */
  function failedHtml(question: string, message?: string | null): string {
    const said =
      typeof message === "string" && message.trim() ? message.trim() : "the team couldn't read this what-if right now";
    const line = `${said.charAt(0).toUpperCase()}${said.slice(1)}. Nothing changed.`;
    return shell(
      "failed",
      `${questionHtml(question)}<p class="ripple-caption" role="status">${escHtml(line)}</p>
      <div class="ripple-actions"><button class="pillbtn ripple-retry" type="button" data-ripple-retry>Ask again</button><button class="linkbtn-quiet ripple-later" type="button" data-ripple-later>Not now</button></div>`
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
