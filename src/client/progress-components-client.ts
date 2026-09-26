// @ts-check
// Shared Progress view presentation helpers.

type ProgressHeroStat =
  | readonly [unknown, unknown]
  | readonly [unknown, unknown, { text?: boolean; unit?: string }];

// A day as the chart module labels it ("Jun 20").
function progressShortDate(iso: unknown): string {
  return CairnUiChart.dateLabel(iso);
}

type ProgressHeroVoice = { line?: unknown; fact?: unknown };

// A Progress header. Given a `voice`, it is ONE serif voice line with at most one
// supporting mono fact — never a wall of numbers (the numbers live one tap deeper,
// in the view itself). Without one, it is the title over a short row of stats
// (Energy's balance, where the three numbers ARE the read); a stat's `unit` rides
// inside its value ("2,417 kcal") so the mono label stays one short word.
function progressHeroHtml(title: unknown, stats: Array<ProgressHeroStat | null | undefined | false>, voice?: ProgressHeroVoice | null): string {
  if (voice) {
    const line = String(voice.line ?? "").trim() || String(title ?? "");
    const fact = String(voice.fact ?? "").trim();
    return `<div class="phero phero-voice reveal" style="${stagger(0)}">
      <h2 class="phero-line">${escHtml(line)}</h2>
      ${fact ? `<div class="phero-fact lbl">${escHtml(fact)}</div>` : ""}
    </div>`;
  }
  const cells = (stats || [])
    .filter((stat): stat is ProgressHeroStat => !!stat)
    .map(([label, value, opts = {}]) => {
      const unit = opts.unit ? `<span class="phero-u">${escHtml(opts.unit)}</span>` : "";
      const fig = opts.text
        ? `<span class="phero-n numeral${String(value).length > 6 ? " phero-n-sm" : ""}">${escHtml(String(value))}${unit}</span>`
        : unit
          ? `<span class="phero-n numeral"><span data-cu="${Number(value) || 0}">0</span>${unit}</span>`
          : `<span class="phero-n numeral" data-cu="${Number(value) || 0}">0</span>`;
      return `<div class="phero-stat">${fig}<span class="lbl">${escHtml(label)}</span></div>`;
    })
    .join("");
  return `<div class="phero reveal" style="${stagger(0)}">
      <h2 class="phero-title">${escHtml(title)}</h2>
      ${cells ? `<div class="phero-stats">${cells}</div>` : ""}
    </div>`;
}

const PROGRESS_COUNT_WORDS = [
  "no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
];
// A count as a voice line speaks it: words up to twenty, digits past it; `lead`
// capitalises it to open a sentence ("Fifteen sessions this month.").
function progressCountWord(n: unknown, lead = false): string {
  const v = Math.max(0, Math.round(Number(n) || 0));
  const word = v < PROGRESS_COUNT_WORDS.length ? PROGRESS_COUNT_WORDS[v] : v.toLocaleString();
  return lead ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

// Progress's art-led empty state, on the shared primitive.
function progressEmptyStateHtml(svg: string | null | undefined, line: unknown): string {
  return CairnUi.emptyStateHtml({ artHtml: svg || art("exercise", ""), title: line, style: stagger(1) });
}

const CAIRN_PROGRESS_COMPONENTS = {
  fmtShortDate: progressShortDate,
  progressHero: progressHeroHtml,
  countWord: progressCountWord,
  emptyStateHtml: progressEmptyStateHtml,
};

Object.assign(globalThis, {
  CairnProgressComponents: CAIRN_PROGRESS_COMPONENTS,
  fmtShortDate: progressShortDate,
  progressHero: progressHeroHtml,
  progressCountWord,
  emptyStateHtml: progressEmptyStateHtml,
});

if (typeof window !== "undefined") {
  Object.assign(window, {
    CairnProgressComponents: CAIRN_PROGRESS_COMPONENTS,
    fmtShortDate: progressShortDate,
    progressHero: progressHeroHtml,
    progressCountWord,
    emptyStateHtml: progressEmptyStateHtml,
  });
}
