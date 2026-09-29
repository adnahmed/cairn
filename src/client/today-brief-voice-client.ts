// @ts-check
// The Brief's Atelier v2 voice pieces (docs/DESIGN.md "Stones"): the stone tokens in
// the why, the folded "Around today" disclosure, and the live-session card that
// stands in for the start button while a session is under way. Pure string
// builders; today-brief-client.ts reaches for them through a guarded global, so a
// partial boot (or a unit test that loads the Brief alone) simply renders plain.

type TodayBriefLive = {
  /** The session's name ("Pull", "Lower B"). */
  name: string;
  /** Lifts with at least one set logged, and all of them. */
  done: number;
  total: number;
  /** The last logged set, already in words ("Deadlift 225 × 6"). */
  last?: string;
  /** The next lift still open ("Split squat 60 × 8–10"). */
  next?: string;
};

type TodayBriefLiveItem = {
  exercise?: unknown;
  sets?: unknown;
  rep_low?: unknown;
  rep_high?: unknown;
  target_weight?: unknown;
  target_seconds?: unknown;
};
type TodayBriefLiveSet = { id?: unknown; weight?: unknown; reps?: unknown; duration_sec?: unknown };

type TodayBriefVoiceApi = {
  liveFacts(input: {
    name: string;
    done: number;
    total: number;
    items: TodayBriefLiveItem[];
    logged: Record<string, TodayBriefLiveSet[] | undefined>;
  }): TodayBriefLive;
  whyHtml(escaped: string): string;
  aroundHtml(parts: { forward: string; periodization: string; arc: string; provenance: string; isToday?: boolean }): string;
  liveHtml(live: TodayBriefLive | null | undefined): string;
  nowHtml(parts: TodayBriefNowParts): string;
};

// The NOW card's pieces, each already built (and escaped) by the Brief.
type TodayBriefNowParts = {
  /** The server lift line, rendered without its kicker ("" when there is none). */
  line: string;
  /** The day's focus, ESCAPED. */
  focus: string;
  /** The plan day's name, raw ("Pull"), to take off the front of the focus. */
  title?: unknown;
  live: string;
  fold: string;
  /** Lifts in a session not yet started: one idle bar each (0 → none). */
  idle: number;
  launch: string;
};

(() => {
  // The first word in the read's own prose that names one of the six stones is
  // set in ink with that stone's hue as its underline, so the sentence shows which
  // parts of the picture it leans on. Words only (the tone never colours it), at
  // most one per stone and three in all. Runs over ESCAPED text, so nothing the
  // model wrote can open markup; the vocabulary is plain letters no entity holds.
  const TOKENS: Array<[string, RegExp]> = [
    ["recovery", /\b(slept|sleep|HRV|recovered|recovery|readiness|resting heart rate)\b/i],
    ["strength", /\b(deadlifts?|squats?|bench(?: press)?|lifts?|lifting|strength|back work|top sets?)\b/i],
    ["endurance", /\b(long run|easy run|runs?|running|aerobic|ride|km)\b/i],
    ["fuel", /\b(fuel|protein|calories|eating|meals?|carbs)\b/i],
    ["body", /\b(bodyweight|body weight|body mass|waist|lean mass|weigh-ins?)\b/i],
    ["heart", /\b(lipids?|ApoB|cholesterol|blood pressure|cardiovascular)\b/i],
  ];

  function whyHtml(escaped: string): string {
    if (!escaped) return "";
    const hits: Array<{ start: number; end: number; key: string }> = [];
    for (const [key, pattern] of TOKENS) {
      const match = pattern.exec(escaped);
      if (!match) continue;
      const start = match.index;
      const end = start + match[0].length;
      if (hits.some((hit) => start < hit.end && end > hit.start)) continue;
      hits.push({ start, end, key });
    }
    let out = "";
    let at = 0;
    for (const hit of hits.sort((a, b) => a.start - b.start).slice(0, 3)) {
      out += `${escaped.slice(at, hit.start)}<span class="brief-tok stone-${hit.key}">${escaped.slice(hit.start, hit.end)}</span>`;
      at = hit.end;
    }
    return out + escaped.slice(at);
  }

  // The week around the read — the forward look, the block clock and the plan's arc —
  // folded behind one quiet tap, so the first view is the read and its one action.
  // The provenance slot (the finding the day honours — the connected brain) is
  // never folded: it stays in view under the fold, and fills only when a finding
  // shapes the day.
  function aroundHtml(parts: { forward: string; periodization: string; arc: string; provenance: string; isToday?: boolean }): string {
    const label = parts.isToday === false ? "Around this day" : "Around today";
    // With nothing to fold, the group still opens under the same mast (no chevron), so
    // the rows below it always read as one section (today/pebbles.css "ONE vertical rhythm").
    if (!parts.forward && !parts.periodization && !parts.arc) {
      return `<div class="brief-around brief-around-plain"><div class="brief-around-sum"><span class="lbl">${label}</span></div></div>${parts.provenance}`;
    }
    return `<details class="brief-around"><summary class="brief-around-sum"><span class="lbl">${label}</span><span class="brief-around-chev" aria-hidden="true">▾</span></summary><div class="brief-around-body">${parts.forward}${parts.periodization}${parts.arc}</div></details>${parts.provenance}`;
  }

  // The live card: while a session holds logged work, the Brief shows where it
  // stands — a ping, the last set and the next lift in the serif voice, and one
  // slim bar per lift — above the Continue button. Nothing to say, nothing drawn.
  function liveHtml(live: TodayBriefLive | null | undefined): string {
    if (!live || !(live.total > 0)) return "";
    // The words carry the true count; only the bar strip is capped so a long card
    // never draws a comb.
    const total = Math.max(0, Math.round(live.total));
    const done = Math.min(Math.max(0, Math.round(live.done)), total);
    const barCount = Math.min(total, 12);
    const barsOn = Math.round((done / total) * barCount);
    const bars = Array.from({ length: barCount }, (_v, i) => `<i${i < barsOn ? ` class="on"` : ""}></i>`).join("");
    const line = [live.last ? `${live.last}.` : "", live.next ? `Next: ${live.next}.` : ""].filter(Boolean).join(" ");
    return `<div class="brief-live" data-brief-live>
      <div class="brief-live-top lbl"><span class="ping" aria-hidden="true"></span>Now · ${escHtml(live.name)} · ${escHtml(`${done} of ${total}`)}</div>
      ${line ? `<div class="brief-live-line">${escHtml(line)}</div>` : ""}
      <div class="brief-live-bars" aria-hidden="true">${bars}</div>
    </div>`;
  }

  // Under a lift line that already names the day, the focus says only what it adds:
  // "Pull — back, rear delts, biceps" → "back, rear delts, biceps". Runs over ESCAPED text.
  function nowFocus(escapedFocus: string, title: unknown): string {
    const name = escHtml(String(title ?? "").trim());
    if (!name || escapedFocus.slice(0, name.length).toLowerCase() !== name.toLowerCase()) return escapedFocus;
    const tail = escapedFocus.slice(name.length);
    const rest = tail.replace(/^\s*(?:—|–|-|:|·)\s*/, "");
    return rest && rest !== tail ? rest : escapedFocus;
  }

  // NOW — today's session as ONE card (the reference phone's "Now" card): a mono key
  // with a still dawn dot (the live card's ping stands in while work is logged), the
  // server's lift line in the serif voice, the focus, the session facts, one slim
  // bar per lift, then the one start.
  function nowHtml(parts: TodayBriefNowParts): string {
    const focus = parts.focus ? nowFocus(parts.focus, parts.title) : "";
    const top = !parts.live && parts.line
      ? `<div class="brief-now-top lbl"><span class="brief-now-dot" aria-hidden="true"></span>Today's lift</div>`
      : "";
    const idle = Math.max(0, Math.min(12, Math.round(Number(parts.idle) || 0)));
    const bars = idle ? `<div class="brief-live-bars brief-now-bars" aria-hidden="true">${"<i></i>".repeat(idle)}</div>` : "";
    return `<div class="brief-now brief-now-card${parts.live ? " brief-now-live" : ""}">${top}${parts.line}${
      focus ? `<div class="brief-focus brief-now-focus">${focus}</div>` : ""
    }${parts.live}${parts.fold}${bars}${parts.launch}</div>`;
  }

  function weightWord(weight: unknown): string {
    if (weight == null || weight === "") return "";
    const n = Number(weight);
    if (!Number.isFinite(n) || n === 0) return "";
    return n < 0 ? `${Math.abs(n)} assist` : String(n);
  }

  function seconds(total: unknown): string {
    const n = Math.round(Number(total));
    if (!Number.isFinite(n) || n <= 0) return "";
    return n < 60 ? `${n} s` : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
  }

  // Where a started session stands, in words: the newest logged set and the first
  // lift still open, each "<lift> <load> × <reps>". Every number comes off the log
  // or the card's own prescription; nothing is invented when a field is missing.
  function liveFacts(input: Parameters<TodayBriefVoiceApi["liveFacts"]>[0]): TodayBriefLive {
    let newest: { exercise: string; set: TodayBriefLiveSet; id: number } | null = null;
    for (const [exercise, sets] of Object.entries(input.logged || {})) {
      for (const set of sets || []) {
        const id = Number(set?.id);
        if (!newest || (Number.isFinite(id) && id > newest.id)) newest = { exercise, set, id: Number.isFinite(id) ? id : -1 };
      }
    }
    let last = "";
    if (newest) {
      const load = weightWord(newest.set.weight);
      const dose = newest.set.duration_sec != null ? seconds(newest.set.duration_sec) : String(newest.set.reps ?? "");
      last = [newest.exercise, [load, dose].filter(Boolean).join(" × ")].filter(Boolean).join(" ");
    }
    const open = (input.items || []).find((item) => {
      const name = String(item?.exercise ?? "");
      const goal = Number(item?.sets) || 0;
      return !!name && (input.logged?.[name]?.length ?? 0) < Math.max(goal, 1);
    });
    let next = "";
    const openName = open ? String(open.exercise) : "";
    const openGoal = open ? Number(open.sets) || 0 : 0;
    if (open && newest && openName === newest.exercise && openGoal > 0) {
      // Still on the same lift: the next thing is its next set, not its name again.
      next = `set ${Math.min((input.logged?.[openName]?.length ?? 0) + 1, openGoal)} of ${openGoal}`;
    } else if (open) {
      const low = Number(open.rep_low);
      const high = Number(open.rep_high);
      const reps = Number.isFinite(low) && low > 0 ? (Number.isFinite(high) && high > low ? `${low}–${high}` : String(low)) : "";
      const dose = open.target_seconds != null ? seconds(open.target_seconds) : reps;
      next = [String(open.exercise), [weightWord(open.target_weight), dose].filter(Boolean).join(" × ")].filter(Boolean).join(" ");
    }
    return { name: input.name, done: input.done, total: input.total, last, next };
  }

  const CAIRN_TODAY_BRIEF_VOICE: TodayBriefVoiceApi = { whyHtml, aroundHtml, liveHtml, liveFacts, nowHtml };

  Object.assign(globalThis, { CairnTodayBriefVoice: CAIRN_TODAY_BRIEF_VOICE });
  if (typeof window !== "undefined") {
    Object.assign(window, { CairnTodayBriefVoice: CAIRN_TODAY_BRIEF_VOICE });
  }
})();
