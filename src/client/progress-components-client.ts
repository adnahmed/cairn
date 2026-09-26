// @ts-check
// Shared Progress view presentation helpers.

type ProgressHeroStat =
  | readonly [unknown, unknown]
  | readonly [unknown, unknown, { text?: boolean; k?: boolean }];

// A day as the chart module labels it ("Jun 20").
function progressShortDate(iso: unknown): string {
  return CairnUiChart.dateLabel(iso);
}

function progressHeroHtml(title: unknown, stats: Array<ProgressHeroStat | null | undefined | false>): string {
  const cells = (stats || [])
    .filter((stat): stat is ProgressHeroStat => !!stat)
    .map(([label, value, opts = {}]) => {
      const fig = opts.text
        ? `<span class="phero-n numeral${String(value).length > 6 ? " phero-n-sm" : ""}">${escHtml(String(value))}</span>`
        : `<span class="phero-n numeral" data-cu="${Number(value) || 0}"${opts.k ? ` data-cufmt="k"` : ""}>0</span>`;
      return `<div class="phero-stat">${fig}<span class="lbl">${escHtml(label)}</span></div>`;
    })
    .join("");
  return `<div class="phero reveal" style="${stagger(0)}">
      <h2 class="phero-title">${escHtml(title)}</h2>
      ${cells ? `<div class="phero-stats">${cells}</div>` : ""}
    </div>`;
}

// Progress's art-led empty state, on the shared primitive.
function progressEmptyStateHtml(svg: string | null | undefined, line: unknown): string {
  return CairnUi.emptyStateHtml({ artHtml: svg || art("exercise", ""), title: line, style: stagger(1) });
}

const CAIRN_PROGRESS_COMPONENTS = {
  fmtShortDate: progressShortDate,
  progressHero: progressHeroHtml,
  emptyStateHtml: progressEmptyStateHtml,
};

Object.assign(globalThis, {
  CairnProgressComponents: CAIRN_PROGRESS_COMPONENTS,
  fmtShortDate: progressShortDate,
  progressHero: progressHeroHtml,
  emptyStateHtml: progressEmptyStateHtml,
});

if (typeof window !== "undefined") {
  Object.assign(window, {
    CairnProgressComponents: CAIRN_PROGRESS_COMPONENTS,
    fmtShortDate: progressShortDate,
    progressHero: progressHeroHtml,
    emptyStateHtml: progressEmptyStateHtml,
  });
}
