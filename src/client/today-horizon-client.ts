// @ts-check
// The forward foot of Today (docs/DESIGN.md "Today"):
//   - Coming up — a dated rail of what is ahead (the next long run, peak week, the
//     strength checkpoint, the race, the goal date, the checkup week), each with one
//     sentence and an action when there is one, under the season's focus;
//   - one new-connection sentence, only when a new insight exists.
// The progress board ("Where you're heading") left Today: it echoed the Brief's Path
// card. Every thread now lives on Horizon's goal line (CairnHorizon.goalsBoardHtml),
// one tap away through the Path card's "All goals" link.
// Pure string builders over GET /api/today-path's `milestones` and `focus`
// (src/repo/today-path.ts). Measures, never grades: no score, no percent printed.
// Lives in the lazy today-ahead bundle.

type TodayAheadPath = import("../contracts/today-path.js").TodayPath;
type TodayAheadMilestone = import("../contracts/today-path.js").TodayPathMilestone;

(() => {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MAX_ROWS = 6;
  const DOT: Record<string, string> = {
    long_run: "stone-endurance",
    peak_week: "stone-endurance",
    checkpoint: "stone-strength",
    race: "is-dawn",
    goal: "stone-body",
    checkup: "stone-heart",
  };

  function parts(iso: string): { m: number; d: number; dow: number } | null {
    const ms = Date.parse(`${String(iso).slice(0, 10)}T12:00:00Z`);
    if (!Number.isFinite(ms)) return null;
    const date = new Date(ms);
    return { m: date.getUTCMonth(), d: date.getUTCDate(), dow: date.getUTCDay() };
  }

  // The rail's mono date: "Sun / Oct 4" inside the coming week, "Oct / 12–18" for a
  // window, "Nov 30– / Dec 4" across a month, else "Oct / 16".
  function whenHtml(mark: TodayAheadMilestone, today: string): string {
    const a = parts(mark.date);
    if (!a) return "";
    const b = mark.end_date ? parts(mark.end_date) : null;
    if (b) {
      return a.m === b.m ? `${MONTHS[a.m]}<br>${a.d}–${b.d}` : `${MONTHS[a.m]} ${a.d}–<br>${MONTHS[b.m]} ${b.d}`;
    }
    const days = Math.round((Date.parse(`${mark.date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 864e5);
    if (days === 0) return `Today`;
    return days > 0 && days < 7 ? `${DOW_SHORT[a.dow]}<br>${MONTHS[a.m]} ${a.d}` : `${MONTHS[a.m]}<br>${a.d}`;
  }

  /** Coming up; "" when the road ahead holds nothing dated. */
  function horizonHtml(path: TodayAheadPath | null | undefined): string {
    const marks = (Array.isArray(path?.milestones) ? path!.milestones : []).slice(0, MAX_ROWS);
    if (!marks.length) return "";
    const today = String(path!.as_of);
    const rows = marks
      .map((mark) => {
        const action =
          mark.kind === "checkup"
            ? `<button class="thz-act linkbtn linkbtn-plain" type="button" data-thz-checkup>See what to ask for →</button>`
            : mark.kind === "race"
              ? `<button class="thz-act linkbtn linkbtn-plain" type="button" data-thz-race>The race build →</button>`
              : "";
        return `<li class="thz-row">
          <span class="thz-when lbl">${whenHtml(mark, today)}</span>
          <span class="thz-rail" aria-hidden="true"><i class="thz-dot ${DOT[mark.kind] || ""}"></i></span>
          <div class="thz-body"><div class="thz-t">${escHtml(mark.label)}</div>${mark.detail ? `<div class="thz-d">${escHtml(mark.detail)}</div>` : ""}${action}</div>
        </li>`;
      })
      .join("");
    const focus = path?.focus ? ` · focus: ${path.focus}` : "";
    return `<section class="thz" aria-label="Coming up">
      <div class="thz-mast"><span class="lbl">${escHtml(`Coming up${focus}`)}</span></div>
      <ol class="thz-list">${rows}</ol>
    </section>`;
  }

  type TodayAheadInsight = { id?: unknown; text?: unknown; kind?: unknown; status?: unknown } | null | undefined;

  // One new connection, as one sentence: its first sentence, clipped.
  function insightSentence(insight: TodayAheadInsight): string {
    if (!insight || insight.kind === "weekly_read" || insight.status !== "new") return "";
    const text = String(insight.text ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return "";
    const first = /^(.+?[.!?])(\s|$)/.exec(text)?.[1] ?? text;
    return first.length > 200 ? `${first.slice(0, 197).replace(/\s+\S*$/, "")}…` : first;
  }

  /** The one new connection, a sentence and a way to ask; "" without a new insight. */
  function connectionHtml(insight?: TodayAheadInsight): string {
    const line = insightSentence(insight);
    if (!line) return "";
    return `<section class="thd thd-connection" aria-label="New connection">
      <p class="thd-insight"><span class="lbl">New connection</span> ${escHtml(line)} <button class="linkbtn linkbtn-plain" type="button" data-thd-insight="${escAttr(line)}">Ask about it →</button></p>
    </section>`;
  }

  const CAIRN_TODAY_HORIZON = { horizonHtml, connectionHtml, insightSentence };

  Object.assign(globalThis, { CairnTodayHorizon: CAIRN_TODAY_HORIZON });
})();
