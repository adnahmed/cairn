# Cairn Design System — "Atelier"

The visual language of the Cairn PWA. Warm-gallery / studio-catalog aesthetic: training and
nutrition presented like a beautifully printed museum catalog — warm paper, ink typography,
studio-lit illustration plates, generous whitespace, soft layered shadows, quiet motion.

This document is the **frozen contract** between `public/styles.css` (design system),
`public/art.js` (illustration library), and the view modules in `public/js/` (formerly
the single `app.js`). Class names and APIs
listed here are load-bearing — change them in all three places or not at all.
The view modules are generated from `src/client/**`. How those modules are structured (component
contract, state, data loading, tokens, motion, states, accessibility, testing, inventory) is covered in
**Component architecture** at the end of this file.

## Palette (CSS variables in `:root`)

```css
--paper:   #f4efe7;  /* page background, warm cream */
--card:    #fffdf8;  /* card surface */
--card-2:  #f8f3ea;  /* inset surfaces: inputs, wells, chips */
--ink:     #211d17;  /* primary text, near-black warm ink */
--ink-2:   #57503f;  /* secondary text */
--muted:   #746c5c;  /* tertiary text, labels — darkened from #8c8475 to clear WCAG AA on --card-2 */
--line:    #e7dfd2;  /* hairlines */
--line-2:  #d8cfbd;  /* stronger hairlines */
--faint:   #c0b6a0;  /* faint taupe — dismiss/× glyphs, ghosted marks */
--accent:  #b4552d;  /* terracotta — primary actions, highlights */
--accent-deep: #93421f;
--accent-wash: rgba(180,85,45,.1); /* terracotta @ ~10% — chip / hover tint fill */
--on-accent: #fffdf8; /* cream ink/glyph ON a saturated fill (accent/sage/warn/ink/gold) — NOT a surface */
--sage:    #6e7f5c;  /* success, completion, "done" states — borders/marks; ~4:1 on card, NOT for small text */
--sage-text: #5f6e4f; /* sage for small TEXT on card/cream — clears WCAG AA 4.5:1 */
--sage-deep: #5a6a4a; /* darker sage — hover/pressed state for sage text actions */
--sage-bg: #eef0e6;
--warn:    #b3402e;  /* warnings, destructive */
--warn-bg: #f6e8e2;
--gold:    #c9a86a;  /* PR moments, streaks, small celebrations — fills/marks, too light for text */
--gold-deep: #8a6d2e; /* readable amber for "watch" TEXT (a marker value off its optimal band) — AA on card */
--rust:    #965138;  /* muted terracotta — provider sign-in / auth state (agent dot, auth log chip) */
--stone-deep:  #2c2620;  /* stone, warm neutrals from the mark — charcoal stack, dark surfaces */
--stone:       #473f36;  /* stone — flat mark, small sizes */
--stone-taupe: #7d6a56;  /* stone — capstone, quiet secondary */
--shadow-sm: 0 1px 2px rgba(72,58,35,.07), 0 4px 14px rgba(72,58,35,.07);
--shadow-md: 0 2px 4px rgba(72,58,35,.08), 0 14px 36px rgba(72,58,35,.11);
--radius: 18px;
--radius-sm: 12px;
--space-card: 10px; /* standard vertical gap between sibling cards */
```

Theme-color / manifest background: `#f4efe7`. Color-scheme: light. Status bar: `default`.

## Typography

- **Display:** system serif stack (`ui-serif`, Iowan Old Style, Georgia, Times New Roman).
  Headings, day names, big numerals (calories, weights, stat strip), section titles.
  Big numerals use `font-variation-settings:"opsz" 144` and weight 560–620.
- **Body/UI:** system sans stack (`ui-sans-serif`, system-ui, -apple-system, Segoe UI) — token
  `--font-ui`. All body copy, inputs, buttons.
- **Mono:** system mono stack (`ui-monospace`, SFMono-Regular, Menlo, Consolas) — token
  `--font-mono`. Code/token/URL readouts only. Reference the token, never re-inline the stack.
- **Labels:** system sans uppercase, `letter-spacing:.18em`, `font-size:.62rem`,
  color `var(--muted)` — the "PROTEIN ───" caps style. Class: `.lbl`.
- The main PWA does not load third-party fonts. Keep typography on local/system stacks unless a
  future slice deliberately self-hosts font files under `public/`.

## Texture & atmosphere

- Subtle paper grain over `--paper`: inline SVG `feTurbulence` noise data-URI, ~3% opacity,
  on `body::before` (fixed, pointer-events none).
- Cards: `--card` + `--shadow-sm`, hover/active lift to `--shadow-md` on devices with hover.
- No borders on primary cards; hairlines only inside (dividers) and on inset wells.

## Motion

- View enter: cards stagger in — `.reveal` class + inline `style="--i:0..n"`;
  `animation: rise .5s cubic-bezier(.22,1,.36,1) both; animation-delay: calc(var(--i)*45ms)`.
  `rise` = translateY(14px) + fade. Cap `--i` at ~12.
- Chips/log entries pop in with a soft scale-fade.
- Buttons compress slightly on press (`transform: scale(.97)`).
- Rest bar slides up; fill animates linearly. When the countdown lands the bar stays put and flips
  to `.rest.rested` — a quiet count-UP of the rest actually taken ("Rested 2:40"), fill settled
  full-width in the hairline tone, ±15 retired, Skip reading "Done".
- All motion wrapped in `@media (prefers-reduced-motion: reduce){ *{animation:none!important;transition:none!important} }`.

## Illustration library — `public/art.js`

Loaded via `<script src="/art.js"></script>` **before** the `js/*.js` view modules. Exposes `window.CairnArt`:

```js
CairnArt.food(text)        // → SVG string. Keyword-maps free text ("greek yogurt with berries")
                           //   to one of ~20 studio food illustrations. Always returns art
                           //   (generic plate fallback).
CairnArt.exercise(name, muscleGroup) // → SVG string. Maps exercise name to a movement-pattern
                           //   line-art figure (squat, hinge, press-h, press-v, row, pull,
                           //   curl, triceps, lunge, raise, calf, core, carry, cardio, stretch);
                           //   falls back on muscleGroup, then a generic kettlebell still-life.
CairnArt.activity(type)    // → SVG string for cardio/activity types (run, ride, swim, walk, hike, row).
```

- Every SVG: square viewBox `0 0 96 96`, no fixed width/height (CSS sizes it), drawn on a
  soft cream circle (`#efe8db`) with an elliptical studio shadow under the subject.
  Food: minimal flat-volume style (bowl/plate/glass/cup compositions) in the Atelier palette
  plus food-natural hues (salmon `#e8836a`, greens `#7d8f5e`, berry `#8e4f6d`, yolk `#e8b54a`...).
  Exercise: duotone ink line-art (stroke `#211d17`, 2.5px, round caps) with one terracotta accent
  (the barbell plate / dumbbell head / kettlebell), abstract figure (circle head + stroke limbs).
- **Never** interpolate caller text into the SVG markup — match keywords, return static strings.
- Deterministic: same input → same art.

## Component class contract

Shared layout: header is just `#header-title` (on Today it's the tappable date
control; it pins to the top of the scroll and condenses to a slim blurred band —
see `body[data-tab="today"] header.condensed` in styles.css).
Tab bar `.tabbar` / `.tab` / `.tab.active` (markup unchanged; restyled: cream blur bar,
ink icons, terracotta active with a small dot indicator; desktop ≥960px → left sidebar as today).

New/changed components (CSS must implement, the client JS must emit):

- `.artile` — illustration tile: `display:grid;place-items:center`, transparent (art carries its
  own circle). Sizes: `.artile-lg` (96px), `.artile-md` (64px), `.artile-sm` (44px).
- `.lbl` — tracked caps label (see Typography).
- `.numeral` — display serif numeral; `.numeral-xl` (2.6rem), `.numeral-lg` (1.6rem).
- `.card-stack` / `.card-stack-item` — the required vertical-list primitive for sibling cards,
  including async slots. The parent owns `gap:var(--space-card)` and empty items collapse; card
  components must not supply inter-card margins. Mark every direct sibling/slot as
  `.card-stack-item`. A card may still use margins internally, but the stack normalizes the first
  and last child edges. Do not concatenate heterogeneous cards and rely on each family to happen
  to carry matching `margin-bottom` values.
- Stat strip: `.statstrip` / `.stat` / `.stat-n` (display serif numeral) / `.stat-l` (`.lbl` style).
- Today exercise card `.ex`: art thumb `.ex-art` (`.artile-sm/md`) left of `.ex-name`
  (display serif, ~1.15rem, weight 540); target weight as `.ex-target` display numeral;
  set chips `.chip` are cream pills; completed card gets `.ex-complete` → sage left-edge stamp
  + a small sage "✓ done" mark, slight desaturation. A superset partner (`superset_group`)
  carries a quiet outlined `.ex-pair-chip` ("Pair") in `.ex-meta` beside the set count.
- Plan tab (Program gallery): `.prog-day` card per plan day:
  `.prog-head` (weekday/status small caps when the week projection knows one — else
  `Day N` — + `.prog-name` display italic + `.prog-focus` muted line + optional
  `.prog-purpose` italic why-this-session line),
  `.prog-strip` horizontal row of `.artile-md` art for the day's exercises (overlapping ~-10px,
  like a catalog contact strip), `.prog-list` of `.prog-row` (small art, name, `sets × reps`
  numerals right-aligned). A quiet `.prog-order` linkbtn ("Order for effect") appears when
  stored item order differs from compounds→accessories→finishers. A `.prog-edit`
  ghost button flips that day into the existing editor markup (`.pday`, `.pi-*` classes —
  keep them working, restyled as inset wells).
- Plan week strip (Strength + Endurance): `.pweek` card with `.pweek-map` (7 cells when
  calendar-anchored, auto-fill template otherwise). Each `.pweek-day` carries weekday,
  glyph (lift/run/mixed/rest), short label (the logged session's title on a done day, the
  run's label + km on a run day, else the plan day's NAME — never the focus sentence), and a
  status chip (Done / Today / Up next). `.is-today` / `.is-done` / `.is-hard` are status deltas
  only — never a gate. `.pweek-progress` under the map is the one spoken week-so-far line
  (counts, no scores); optional `.pweek-note` below it for a layout suggestion or a quiet summary.
  Every cell is a real `<button>` (`aria-pressed`, `data-pweek-day`). At ≥720px it is the
  labeled grid above, with today's server line in `.pweek-today`. Below 720px the same buttons
  become a dot strip: weekday over a 30px `.pweek-token` (done = sage fill + ✓ in
  `--on-accent`; today = `--accent` ring; rest = dashed `--faint` "·"; run → gold outline;
  lift ◆ / lift+run ✦; `.is-hard` = a small gold dot) with a 2px `.pweek-under` mark on the
  selected day, then ONE `.pweek-detail` line for that day (small-caps kicker, the cell label in
  the serif, its status; today's panel prints the server's strength line instead, so
  `.pweek-today` is hidden there). Tap swaps the detail (`settlein`, `--dur-2`), the selected
  token scales 1.1; tapping it again returns to today. All of it is still under reduced motion.
- Plan Endurance briefing: `.end-brief` (coach sentence `.end-brief-lead` plus a km/mi
  toggle `.end-units` on `.end-brief-bar`, the next-run plate `.end-next` — when, name,
  prescription, then `.read-contrib` rows for setup / expect / sits-by — then `.end-then`
  for the next two, a three-run review). Later sessions sit behind `.end-later`. The
  connected week map is a collapsed `.end-week-fold` below the briefing and loads on open.
  Race clocks/paces live behind `.rbuild-more` (`compact` race-build card, summary "The
  rest of the program"). The composer is a collapsed `.end-shape-fold` details, same
  quiet-strip posture as `.plan-redraw`.
- Meal plans (Coach tab): `.mp-card`. Header `.mp-hero`: agent + status `.mp-badge` (draft/ok/off),
  daily kcal as `.numeral-xl` + `.lbl "per day"`, protein as `.numeral-lg`. Days `.mp-day`
  with `.mp-dayname` (display italic). Each meal `.meal-row`: `.meal-art` (`.artile-md` food art)
  | `.meal-main` (`.meal-name` 600, `.meal-items` muted) | `.meal-macros` right column —
  kcal numeral + tiny `P / C / F` caps figures when present.
- Finished-session **done card** `.sessiondone`: centered card with a sage `.done-mark`
  check, `.done-kicker` (`.lbl`), `.done-title` (display serif), `.done-chips` (cream pills:
  sets/tonnage/duration), optional `.done-notes` (italic), the `#feedbackSlot` ("how did
  that feel?"), and `.done-actions` (Log more / In your history →). No score, ever.
  The `#feedbackSlot` form is the two feel scales and nothing else — the "add a pain note"
  toggle and its `where? (e.g. left knee)` input are GONE (they were the last pain mini-UI
  standing, and asking for a place is what clipped a sentence into the `area_text` label).
  A stored note is still SHOWN on the settled `.feedback-done` line; it is never re-offered
  as a field. The save omits `joint_pain` entirely rather than sending null, so a soreness
  tap cannot clear a note written elsewhere.
- Session-close **Pain & injury** `.symptom-lifecycle`: a compact, left-aligned editorial lifecycle
  under `#feedbackSlot` — a DISPLAY surface with exactly one action on it. Pain is reported the way a
  person reports it (a session note, the feedback line, chat) and derived from those words, so there
  is no composer, no movement picker and no pain-free/pain-present pair here; the empty state says
  so ("Mention pain in your session notes or chat — Cairn picks it up."). `.symptom-lifecycle-head`
  leads with the `.lbl`; `.symptom-active-list` holds `.symptom-active-row.well-accent-sm` notes,
  each a `.symptom-row-heading` pairing the athlete's own words (`.symptom-area`) with a small
  `.symptom-watching` state — `.symptom-unconfirmed` mutes it for an unconfirmed legacy import.
  `.symptom-row-actions` carries the single `linkbtn` that closes a note. Resolved notes live behind
  native `.symptom-history` disclosure and use `.symptom-history-row` / `.symptom-resolved-on`.
  Reuse the shared `linkbtn`, `pillbtn` and well primitives; do not reintroduce stacked bare inputs,
  a mini pain form, or centered clinical copy.
- History session card `.sess.hist` is tappable (`.hist-tap`, `role="button"`) → opens the
  edit overlay; a quiet `.hist-edit` caps cue sits by the weekday. Edit overlay reuses the
  `.detail` scaffold with `.ed-sets` / `.ed-exgroup` / `.edset` (inline number inputs +
  `.edset-del`) and `.ed-notes`.
- Exercise detail manage row `.detail-manage` / `.manage-row`: small `.pill-sm` pills to
  change type (reps⇄timed) or delete (`.pill-warn`). Off-plan cards reuse `.ex-skip` styling
  as `.ex-remove` (a remove ✕ before any set lands).
- Macro bars `.macrobar`: hairline track, ink fill, label left + value right (screenshot style).
- Activity entries `.qlent`: small `.qlent-art` (CairnArt.activity) + text + enrichment badge.
- Buttons: `.logbtn` terracotta ink-on-cream → solid terracotta circle/pill, cream glyph;
  `.ghostbtn` hairline pill; `.draftbtn` hairline terracotta text pill.
- **Interaction primitives live in `styles.css` §04c**, at the TOP of the file (above every
  component) so a component can safely layer its own delta on top. Reuse them; a new surface
  should never re-declare an accent link, a spined well, or a × glyph. Each consumer keeps its
  bespoke class as a *hook* carrying only layout deltas (`.hb-rn-link{font-size:.8rem}`), never
  the look.
  - **Text buttons — `.linkbtn`.** Borderless accent button (weight 600, tactile `--press-sm`).
    Base = underlined inline link (`--accent-deep`); modifiers `.linkbtn-plain` (no underline,
    `--accent` — standalone actions like "Ask the coach →") and `.linkbtn-sm` (smaller). The
    muted sibling **`.linkbtn-quiet`** (→ `--ink-2` on hover) is the calm "why this" / "details"
    / "see the evidence" disclosure. Migrated onto these: `.hb-mk-allbtn`, `.hb-rn-link`,
    `.end-link`, `.feedback-edit`, `.cardio-sync-go`, `.insight-act(-go)`, `.insight-why-more`,
    `.agent-detail-link`, `.hb-devidence` (+ the `.hsyn-ask`/`.hmk-ask` asks). *Intentionally
    distinct, not migrated:* `.lately-all` (uppercase micro-eyebrow) and the `.brief-steer-opt`
    steer widget (ink-2 options with dot separators — its own cohesive affordance).
  - **Spined wells — `.well-accent` / `.well-accent-sm` / `.well-accent-sage`.** The "one lever /
    one change" callout: `.well-accent` = card + 3px terracotta spine + `--radius` + `--shadow-sm`;
    `.well-accent-sm` = 2px spine + `--radius-sm` inline mini-well (no card bg/shadow — the site
    adds its own); `.well-accent-sage` = the sage-spine modifier (calm / done / weekly). Each site
    adds only its padding (+ optional tint bg). Used by `.hsyn-onechange`, `.hstand-lever`,
    `.pperf-lever`, `.eb-proposal`, `.sug-composer`, `.weekly-change`, `.sug-card`, `.weekly-card`.
    The kind-themed `.brief` hero stays hand-rolled (its rest/easy/train spine-colour variants and
    warm wash sit outside the primitive).
  - **Close / dismiss — `.xbtn`.** Bare-glyph × (`--muted` → `--ink`, `--press-xs`). Migrated:
    `.chip-x` (destructive — retints to `--warn`), `.supp-x`, `.bpsheet-x`, `.agenda-x`, and the
    framed `.sheet-x` (adds a card-2 circle chrome on top).
  - **Coach-change rationale and outcome language.** A background coaching change is rendered at the
    affected exercise or meal, never as a global activity feed. Reuse `.ex-flag` for the compact
    item note, `.linkbtn-quiet` for “why this,” and the actionable-toast pattern for a one-tap
    **Undo**. A material announced change uses `.well-accent`; a calm completed evaluation may add
    `.well-accent-sage`. The four outcome phrases are fixed: “this moved as expected,” “the result
    didn't match what I expected,” “we can't tell yet,” and “this was stopped before we could tell.”
    Confidence is written only as `tentative`, `observed`, or `strong`; never expose evaluator
    scores, coefficients, internal tiers, or specialist transcripts. Undo labels name the concrete
    effect (“Restore previous bench target”), remain available at the affected detail surface after
    the toast expires, and use the same press/motion/reduced-motion tokens as existing actions.
- Chat `.bubble.user` = ink on `--ink` (cream text); `.bubble.assistant` = card.
- Health **Standing** (Stand, the hero read): `.hstand*` — the momentum-led capacity read
  (three-age strip, `.hstand-bc-*` live body-composition, `.hstand-lever` terracotta well = the one
  health lever, momentum chips, level-ladder comparisons — strong / solid / building, never a
  printed population percentile). Blood-pressure **capture** lives in a sheet
  (`.bpsheet*`), never inline in the read. Connected-brain rail: `.hb-section` cards (directives,
  `.supp-*` supplements, and `.symlink-card` symptom↔marker connections — gold left-spine, `.symlink` /
  `.symlink-note` / `.symlink-mk`; a quiet "worth mentioning to your doctor" read, hidden when empty).
- **Cardiovascular risk** (Stand → Age, `#hRisk` above the standing read): `.hrisk*` — the
  AHA PREVENT (2023) clinical read. `.hrisk-vage` is the vascular-age headline, ALWAYS paired in the
  same card with `.hrisk-enh` (the enhancer overlay — ApoB/Lp(a)/hs-CRP/body-fat/VO2max/family-history,
  the residual risk the base equation misses); `.hrisk-enh-lede-tension` is the honesty guard that
  names it explicitly when a favorable vascular age is undercut by non-empty enhancers — a card must
  never show vascular age standing alone. `.hrisk-stats` leads with total-CVD 10/30-yr (`.hrisk-stat-primary`)
  alongside ASCVD and heart-failure; `.hrisk-levers` is an optional compact "what moves it" chip strip;
  `.hrisk-provisional`/`.hrisk-badge`/`.hrisk-assumptions` surface a still-assumed input with a calm
  `.hrisk-sharpen` nudge into the profile (Settings → You). `.hrisk-missing` is the calm insufficient-inputs state
  (never an error tone). A clinical risk % and a vascular age are real numbers, not a banned 0–100
  wellness score; `.hrisk-frame` always closes with the informational-not-medical-advice line.
- **Performance** read (Train → Program, the athletic counterpart to Standing): `.pperf*` — the
  "where you stand" capacity benchmark. `.pperf-hero` (sage left-spine, headline + sub + `.pperf-chip`
  momentum chips); `.pperf-caps` of `.pcap` rows (movement label + shared `.level-chip` with the
  beginner→elite ladder word, never a percentile number, bar, or mark); `.pperf-lever` terracotta
  well = the one training lever; `.pperf-block` for imbalances / re-tests; `.pperf-variety`;
  `.pperf-aero` aerobic line; `.pperf-balance` italic holistic note. Tone classes `-strong` (sage) /
  `-watch` (terracotta) / `-steady` (gold). Level-ladder words only; population-percentile numbers
  never print (constitution). Clinical risk % and vascular age stay the `.hrisk*` exemption.
- Keep ALL other existing class names working (`.sess`, `.modal*`, `.heat*`, `.vol*`, `.mem*`,
  `.hdoc*`, `.life*`, `.enr*`, `.seg*`, `.daybtn`, `.logrow`, `.field`, `.toast`, `.rest*`,
  `.ob-*`, `.agentrow` family) — restyled to the Atelier language, same selectors.

## Reading layer primitives

The **shared, composable grammar every read speaks** — the Brief, Energy Balance, the Stand reads,
the Train capacity read, and every future reading surface compose these rather than reinventing a
read, so more intelligence never becomes a new dialect. Bound to the constitution (VISION.md
**Amendment 2 — the reading grammar**): a read leads with a **plain-language sentence**; a **win is
made visible**; **what's lacking is calm information, never failure**; and **visual state is expressed
against the athlete's OWN baseline range in qualitative words** — *in / below / above your range* —
**never a 0–100 score, a letter grade, or population-relative geometry** (no percentile bar, no rank
against strangers). Terracotta reads **strictly as attention / a lever, never punishment**; **no
number appears in the primary read** (depth stays one pull away on the detailed surfaces). These
primitives live in `styles.css` **§04d**, at the TOP of the file (above every component, alongside the
§04c interaction primitives) so a reading surface can layer its own delta on top. The HTML is emitted
by `src/client/ui-reads.ts` (the `CairnUiReads` namespace — pure string renderers, every caller
string escaped). They are static display primitives (no motion of their own; they inherit the global
reduced-motion discipline); where a consumer makes one tappable it layers the press with the
`--press*` tokens.

- **`.read-band` — personal-baseline band.** A horizontal track (`.read-band-track`) carrying a soft
  sage range region (`.read-band-range` = the athlete's OWN rolling range, positioned by inline
  `left`/`width` percentages), a positioned dot for today (`.read-band-dot`, ink; the `.hot` modifier
  on `.read-band` retints the dot terracotta when today's value is a lever), an optional `.lbl`
  `.read-band-label`, and a plain-language `.read-band-phrase` slot. Fluid — reads at card width and in
  a narrow inline slot; the `.read-band-inline` modifier lays label · track · phrase out on one row.
  Renderer `baselineBandHtml({label, position, rangeStart, rangeEnd, phrase, hot})` clamps positions to
  `[0,1]` and, when range data is missing, **degrades to just the phrase** — the band is never drawn
  empty. The band region is the athlete's own range; there is no axis, no tick, no number.
- **`.read-contribs` / `.read-contrib` — contributor rows.** One row per contributor: a small state pip
  (`.read-contrib-pip` with `.ok` sage / `.watch` terracotta = attention or a lever / `.quiet`
  neutral-outline = thin data, "the read is looser"), a `.read-contrib-label`, and a qualitative
  `.read-contrib-state` line (words, not a value). Renderer `contributorRowsHtml(rows)` takes
  `{label, state, tone: 'ok'|'watch'|'quiet'}`, clamps tone to the allowlist (unknown → `quiet`), drops
  empty rows.
- **`.level-chip` — qualitative level chip.** A sage-soft ground with sage text for a capacity /
  benchmark word ("intermediate", "in your range"), plus an optional muted `.level-chip-detail`. A
  reference read, never a graded score. Renderer `levelChipHtml({label, detail?})`. (Text uses
  `--sage-text` — the AA-clearing sage for small type.)
- **`.trend-lead` — trend-first headline row.** A serif `.trend-lead-name` beside a directional
  `.trend-lead-phrase` — `.toward` sage (moving toward optimal), `.away` terracotta (away and
  actionable), `.stable` muted. Renderer `trendLeadHtml({name, phrase, tone})` clamps tone to the
  allowlist (unknown → `stable`). The direction is words, never an arrow on a score.
- **`.strength-line` — today's lift.** The server's one line (`GET /api/today-strength-line`, and the
  same object on the Brief, the Today aggregate and the week projection) printed VERBATIM: an optional
  `.lbl` `.strength-line-k` kicker, the `.strength-line-t` line ("Run in · Pull still open"), a quiet
  `.strength-line-caveat` for a rest/easy read, and — on a reshaped day — a folded
  `.strength-line-orig` `<details>` holding the plan's own list. `data-strength-state` carries the state
  (a `logged` line reads sage). Renderer `strengthLineHtml(line, {kicker, compact})`; `compact` drops the
  caveat and the fold where the surface already is the caveat (a rest/easy Brief).

## Hard rules

- `public/` stays dependency-free vanilla JS — no build step, no frameworks, no external images.
- All server-supplied strings rendered into `innerHTML` go through `escHtml`/`escAttr`.
- Don't break behavior: every element id, `data-*` attribute, and event-wiring pattern in
  the client JS is functional. Polling (`pollToken`), rest timer, day switcher, editor, onboarding —
  all must keep working.
- Light theme only. `color-scheme: light` (date inputs etc. follow).
- **Dates read human, never raw.** Don't surface bare `YYYY-MM-DD` in UI copy. Three date helpers,
  one per context:
  - `humanDate(iso)` → "today" / "yesterday" / "3 days ago" / "2 weeks ago" / "Apr 2024" (relative
    when recent, month-year when old). Used for the `.hpic-asof` "As of …" caption and for
    humanizing dates that appear inside coach/review prose.
  - `relAge(iso)` → "today" / "N days ago" / "N weeks ago" / "N months ago" / "a year ago" /
    "N years ago" — never falls back to a bare month-year. Used for **reading/marker recency**,
    where "3 months ago" reads warmer than "Apr 2024". Always pair it with a `title="${absDate(iso)}"`
    tooltip so the exact date is one hover away (relative-by-default, precise-on-demand).
  - `absDate(iso)` → full "June 11, 2026" — for those `title=` tooltips only.
  Coach/review prose runs through `humanizeReviewText(text, latestISO)`, which strips the
  most-recent panel date (shown once as the `.hpic-asof` "As of …" caption) so it isn't restated
  on every line, and humanizes any remaining ISO dates. Status timestamps stay on `relTime()`.
- **Action pills — reuse the family, don't re-roll.** The real sizes today: `.pillbtn`
  (`11px 22px`/`.82rem`/~40px, the flagship) with `.pill-sm` (`8px 15px`/`.76rem`/~32px),
  `.pill-warn`/`.pill-accent` modifiers; `.ghostbtn` and `.draftbtn` (`~9px 13–15px`/`.76rem`/~34px);
  `.iconbtn`/`.delbtn` (30–32px). Pair a pill row with a height-matched icon/delete so it sits on one
  baseline. Divider-separated sections (`.hdoc-foot`, `.himpacts`, `.mp-history`) use
  `margin-top:~16px; padding-top:14px`. Don't hand-roll a one-off pill — reuse a family class.
  There are **two intentional pill scales**, not one: the larger sentence-case **flagship**
  `.pillbtn` (~40px, hero detail-action rows) and the compact **uppercase** `.ghostbtn`/`.draftbtn`
  (~34px, inline actions). They share radius, weight, transition, and the global `:active` press —
  differing only in size + case by role. Don't force them to one height; pick the scale that fits
  the context.
- **Segmented / toggle "active" fill is `--ink`.** Every mutually-exclusive switch — `.segbtn`,
  the sliding `.seg-thumb`, `.disc-seg`/`.goalmode-seg`, the plan-editor `.pi-kindbtn`, `.hread-chip`
  — fills `--ink` (cream text) when active. Don't use `--accent` for a segment's active state
  (`--accent` is for actions, not "which of these is selected").

## Motion tokens

One easing family, three speeds — defined in `:root`, used everywhere. Nothing snaps.

```css
--ease:  cubic-bezier(.22,1,.36,1);  /* the house curve — settle, don't bounce hard */
--dur-1: 200ms;   /* presses, hovers, small state flips */
--dur-2: 320ms;   /* segmented thumbs, sheets, overlays, view transitions */
--dur-3: 450ms;   /* list entrances, bars growing, photo fades */

/* tactile press — one intentional depth scale, keyed to target size.
   The press deepens as the target shrinks so it reads at any size. */
--press-lg: scale(.99);   /* large surfaces — cards, rows, tap-entries */
--press:    scale(.97);   /* standard — buttons, pills, day/seg buttons */
--press-sm: scale(.94);   /* compact action buttons */
--press-xs: scale(.9);    /* tiny icon buttons — ×, dots, swatches, chevrons */
```

The motion vocabulary on top of the existing `.reveal` stagger:

- **Count-up numerals** — `countUp(el, target)` in the client JS eases big figures from 0
  (cubic ease-out, ~750ms). Markup contract: `data-cu="<number>"` (+ optional
  `data-cufmt="k"` for humanized `12.4k`) and a `runCountUps(scope)` call after render.
- **Bars grow to width** — give any `.volbar-fill`/`.macrobar-fill` the `.barfill` class;
  `@keyframes bargrow` animates from 0 to the inline width on first paint.
- **Sliding seg thumb** — `segBar()` emits `.seg.seg-sliding` with a `.seg-thumb` pill
  positioned by `--segn`/`--segi`; `wireSeg` updates `--segi` on tap and swaps the
  sub-view inside a view transition. Hand-built segs (onboarding) keep the classic
  background-swap active state — only `.seg-sliding` suppresses it. The thumb math
  assumes equal-width segments, so when a bar's pills won't fit (`fitSeg` measures
  `scrollWidth > clientWidth`) it adds `.seg-scroll`: the bar scrolls horizontally
  with content-width pills and the thumb yields to the solid active-pill background.
  Never clip the last pill — overflow always scrolls.
- **Finish micro-exit** — `@keyframes slideOut` (`.slide-out`, `--dur-2`) lifts the
  finished logging surface away (translateY + fade) before Today re-renders to the
  calm `.sessiondone` "done" card, which reveals in. Reduced-motion-gated in JS.
- **View transitions** — `withViewTransition(fn)` wraps tab and sub-view swaps in
  `document.startViewTransition` when available (instant fallback otherwise; disabled
  under reduced motion). Shared-element zooms use the `detail-art` view-transition-name
  (tapped tile ↔ overlay art) and `seg-thumb` for the segmented pill.
- **Tab switch** — `tabSwap(fn)` carries a tab change in ONE fade: the View Transition
  root crossfade, shortened to `--dur-1` while `<html data-vt="tab">` is set, or the
  `view-in` keyframe where transitions are unavailable — never both. The skeleton (or a
  warm tab's synchronous cached paint) lands inside the swap. The tab bar gets the
  `tabbar` view-transition-name for tab switches only, so it renders live and its active
  dot scales/fades in (`--dur-1`) instead of ghosting.
- **Skeleton → content** — when content replaces a top-level skeleton, `viewHydrate()`
  adds `#view.view-hydrate` (opacity .35 → 1 over `--dur-1`) and switches the swapped
  cards' `.reveal`/`.settle-in` entrance off inline: one entrance, never a fade AND a rise.
  Cards arriving later into async slots keep their own entrance.
- **Programmatic focus is quiet** — a tab switch lands focus on `#view` or its first
  heading (`tabindex="-1"`). A pointer-driven switch marks it `data-focus-quiet` (no
  outline, removed on blur); `:focus:not(:focus-visible)` on `#view`/`[tabindex="-1"]`
  drops the outline too. A keyboard-activated switch keeps the ring.
- **Leaf sub-bar** — the Progress `.prog-subseg` leaf bar is text tabs (no pill container,
  smaller caps) whose `.seg-thumb` becomes a 2px ink underline on a hairline rule; it
  renders only when the active group has more than one leaf.
- **Toast** slides up + settles (`translate(-50%,14px) scale(.97)` → identity).
- **Tactile press** — every interactive surface compresses on `:active` using the
  `--press*` scale tokens above, never an ad-hoc literal. Pick by target size:
  `--press-lg` for cards/rows/tap-entries, `--press` for buttons/pills/day+seg
  buttons, `--press-sm` for compact action buttons, `--press-xs` for tiny icon
  buttons (×, dots, swatches, chevrons). This is the single load-bearing
  micro-interaction — a finger-following 1:1 response, so it is deliberately
  **kept under reduced motion** (it's affordance, not decoration); only the
  decorative entrances/loops/transitions are silenced.
- **Hover lift** (devices with `@media (hover:hover)` only) — cards and tap targets
  raise `--shadow-sm → --shadow-md`; pills/buttons tint their accent. Never on touch,
  where the press scale carries the feedback.
- Everything decorative dies under `@media (prefers-reduced-motion: reduce)`
  (`*{animation:none!important;transition:none!important}`, then a curated set of
  slowed loading indicators + functional transitions restored); JS checks
  `reducedMotion()` before count-ups, view transitions, and parallax.

## Loading & progress — one calm "an agent is thinking" vocabulary

Reached for by **every** surface where an operation can exceed ~400ms (agent
calls, day-reads, drafts, reviews, history fetches), so "working" always reads
the same warm way. Defined in `styles.css` + the client JS helpers; never hand-roll a
one-off spinner. Motion is slow and legible under `prefers-reduced-motion`.

- **`.aspin`** — the calm spinner ring; size via `--asz` or `.aspin-sm` / `.aspin-xs`,
  and `.aspin-ghost` on a dark/terracotta button. The single in-flight glyph.
- **`btnBusy(btn, label, {ghost})`** — swaps a tapped button's label for an `.aspin`
  ring + working text (footprint pinned so nothing jumps); returns a `restore()`.
  The default for any button that kicks off an agent op (session-suggest, meal
  draft, nutrition check-in, recipe, health refresh).
- **`.is-thinking`** — an indeterminate terracotta→gold filament that sweeps a
  surface being (re)generated (e.g. the Brief reshaping on an override chip).
- **`.typing`** — three breathing dots for the chat reply; the pending assistant
  bubble renders an optional caption + `.typing`.
- **`loadingState(label)`** → `.loadstate`: a centered `.aspin` + display-italic
  label for a whole region that's fetching/thinking — the one case the inline
  pieces above don't cover (the chat log hydrating, the history overlay loading).
- **`.hshimmer`** — the shimmer skeleton placeholder (Health-view picture build).
- **`.is-thinking--determinate`** — the `.is-thinking` filament becomes a
  left-anchored progress fill driven by a `--frac` custom property (0..1), same
  gradient/glow family as the indeterminate sweep. The job runner sets `--frac`
  from real `phase` fractions (`job.meta.frac = {done, total}`). Reduced motion →
  the fill jumps to its width (transition killed), no sweep.
- **`thinkingCaption(el, op)`** — rotates a curated, op-specific script through `el`
  (~2.6s/line, the chat `.typing-cap`/`capfade` crossfade), looping the tail;
  returns `stop()`. Replaces a static "Drafting…/Reading…" line on a long-op anchor
  with evolving copy. Scripts live in `THINKING_SCRIPTS` (`session_suggest`,
  `meal_plan`, `recipe`, `nutrition_checkin`, `day_read_override`, `chat_distill`,
  `insight`). Under reduced motion it shows line 1 statically. The host carries a
  `.job-cap` (or `.typing-cap`) slot for it to write into.

## Instant, alive: SWR cache + durable agent jobs

The spine that makes the app feel instant. Two client layers (in `public/js/`),
both generalizing proven code (`upgradeBriefInPlace` + the chat SSE client):

- **Stale-while-revalidate** — `peekCached(key)` / `cachedApi(path,{key,freshFor,
  onUpgrade})` / `paintSWR({key,path,peek,render,token})` / `swrInvalidate(keyOrPrefix)`
  / `swrSweep()`. A surface paints **real last-known content instantly** (skeleton
  only on a true cold start), then revalidates in the background and upgrades in
  place **only when the JSON payload changed**. Both tiers (in-memory Map over
  `localStorage` `cairn.swr.v1.<key>`) are JSON-only — never cache DOM; rendering
  still flows through `escHtml`/`escAttr`. A stale paint flies the **`.swr-refreshing`**
  hairline (`body.swr-busy::after` — a calm low-opacity top filament, distinct from
  the `.offline-bar` warn band; reduced motion → a static tinted 1px border). A
  mutating write that changes a surface calls `swrInvalidate(key)` so the next paint
  refetches (the role `state.brief = null` plays for the Brief). **`SWR_NS`**
  (`"cairn.swr.v1."`) is the version segment — bump it in lockstep with any
  payload-shape change so old cached bodies are dropped.
- **Durable agent jobs** — the kind-agnostic counterpart to the chat-turn client:
  `enqueueJob(path,body)` / `openJobStream(id,handlers)` / `jobReconnect()` /
  `teardownJobs(pred)` / `runOp(kind,body,{path,anchor,render,onFail,caption})`.
  A heavy/agentic op is a server-side job streamed for evolving progress; it
  survives a tab switch / reload / restart (`jobReconnect()` re-attaches via a
  stable `data-job-anchor="<kind>"`, rebuilding handlers through a
  `registerJobReconnector(kind, factory)` for ops that should resume after a
  reload). A SEPARATE `jobStreams` map keeps the single chat `EventSource`
  untouched. **`runOp`** is robust to the server's `bg_ops_enabled` toggle: the op
  POST returns `{ok, job}` (background — stream it) or a legacy inline result (no
  `.job` — render now), and the `done` event's `result` is byte-for-byte the object
  the endpoint returned synchronously before, so the `done` render reuses the old
  await-path render verbatim.

## Progressive artwork — `artImg()`

The bridge from illustration plates to Morsel-style studio photos. Server contract:
`GET /api/art?kind=food|exercise|activity&q=<text>` → `200 image/*` when a generated
image is cached, `204` when not (the 204 itself enqueues background generation).

`artImg(kind, q, cls, svg?)` renders the CairnArt SVG **instantly** inside
`.artile.artimg`, layered with an `<img class="artimg-photo">` that fades in
(`opacity` + tiny `scale` settle, `--dur-3`) on `load`. A 204 or failure fires the
img error path: the photo stays invisible, the SVG plate remains — no flash, no broken
icon. One quiet retry fires ~20s later, guarded by `pollToken`. Photos are round-cropped
(`border-radius:50%`) so they sit on the same circular plate language as the SVGs.
The `q` is `encodeURIComponent`-ed and capped at 120 chars; alt text is escaped.
`settings.art_enabled` (Settings → "Artwork generation") gates the whole layer —
off means SVG-only, zero requests.

## Detail overlay anatomy — `.detail`

Full-screen item view (food note, exercise), opened with a shared-element zoom from the
tapped tile (`openDetailFrom(tile, build)`) and closed by ✕ / Escape / backdrop / pills
(`closeDetail()` — also called on every tab switch so overlays never leak).

```
.detail                fixed, z-70, paper
├ .detail-bg           blurred scaled photo (when cached) under a cream gradient wash
├ .detail-x            floating close button (top-right, safe-area aware)
└ .detail-scroll       centred column, max 560px
  ├ .detail-art        hero plate: artImg artile-xl · view-transition-name: detail-art
  │   └ .detail-art-zoom   wheel/pinch "lean in" zoom (CSS transform, clamped 1–2.2)
  ├ .detail-title      display serif ~1.8rem
  ├ .detail-ctx .lbl   tracked caps context ("19% of the day · 20:01" / muscle group)
  ├ .detail-kcal       .detail-num count-up numeral + .detail-unit label
  ├ .detail-spark      tiny terracotta sparkline (est-1RM trend / durations)
  ├ .detail-macros     .macrobar rows, hairline .barfill bars animating to width
  ├ .detail-section    .lbl heading + .detail-body copy / .detail-setline rows
  └ .detail-actions    .pillbtn row (.pill-warn destructive, .pill-accent primary)
```

The art drifts idly (`@keyframes drift`, 6.5s alternate) and parallaxes on overlay
scroll (translate + fade, JS, reduced-motion-gated). `.prbadge` is the gold PR pill.

## Meals planner (Plan tab · Meals)

The journal view over the current weekly meal plan (prefers an accepted/applied/kept
plan, falls back to the newest draft):

- `.mealhero` — week-of label + `.mp-badge` status + agent, count-up `daily_kcal` /
  `daily_protein_g` numerals, summary line, Keep/Discard `.pillbtn` row for drafts.
- `.mealday` — one section per day: `.mealday-head` (tiny caps date + `.mealday-name`
  big display day name, per-day kcal/protein `.mealday-total`) over a `.mealday-card`
  of `.meal-row`s (artImg food plate | name + items | kcal numeral + P/C/F caps).
- `.meals-empty` — illustration plate + italic display title + an "Ask team to plan
  this week" CTA on the shared `.pillbtn pill-accent`, with `.meals-status` for run feedback.
- `.mp-history` — `<details>` keeping the classic `.mp-card` list as collapsed history.
- `.shop-chips` — the plan's shopping list as cream chips.

## Timed exercises

- Encoding: a set with `duration_sec` (weight/reps null) is a timed set; an exercise's
  `mode:'timed'` or a plan item's `target_seconds` flips the card. Durations render as
  `m:ss` (`fmtDur`) everywhere — chips, history, plan gallery (`3 × 0:45`), detail view
  (best duration instead of est-1RM). Timed sets never count toward tonnage.
- Logging row swaps WT/REPS/RIR for one `.in-dur` input accepting `90`, `1:30`, or `2m`
  (`parseDur`), normalised back to `m:ss` after each log.
- The "+ Add exercise" form carries a Reps/Timed `.addex-mode` toggle (`.modebtn`).

## Today trajectory and bodyweight capture

The collapsed `This week` fold owns the `.statstrip`: discipline-aware training volume,
weight pace, and its bodyweight tile. Pace is trajectory here, never a standalone warning
or prewritten coach ask. A second small `#wtChipMini` bodyweight quick action stays above
the fold beside its hidden inline input/save row, so one-tap weight capture is always
reachable; saving updates both visible weight controls. Typed capture lives in Chat rather
than as a separate Today control. Stat numerals count up via `data-cu`.

Below the bodyweight chip, the capture row carries two quiet, optional surfaces fed by
their own loaders and empty by default (`:empty{display:none}`, so neither draws anything
until it has something worth a tap): `#freqFoods` ("Usual around now") one-tap re-logs
the foods most often eaten near this time of day, and `#checkinSlot` (today only) is a
single dismissible "how are you feeling?" row that expands to one-tap mood/energy dots —
never a form, never a nag. The check-in feeds `dayRead` directly, so it stays load-bearing
even though it renders as one line.

Voice capture lives in the Chat composer (`#chatMic`, press-to-talk on the reused
`capture-voice-client.ts` machinery), not on Today — capture is scoped to Chat per product
law. It rides the trailing edge of `#chatInput` the same way the mic once rode Today's
quick-log field, hidden outright where the browser has no Web Speech support. Dictated
text lands in the composer for the athlete to review and send themselves; it never
auto-submits.

## Marker trends (Stand → Markers)

Lab markers read as a grouped catalog, fed by `GET /api/markers/priority` (the superset that
carries optimal bands + group + trend on top of the flat marker shape). Each marker carries
`group`/`group_label`; the response's `groups` array is the canonical, ordered list of health
groups present, and headers render in that order. Markers within every group use a clinician-style
scan order first (CBC-like rows together, CMP-like liver/kidney rows together, standard lipid panel
before ApoB/Lp(a) and advanced lipoprotein details), then fall back to server order for unknown
markers. LDL-C and direct LDL-C remain separate rows with a local note when both are present.
**Never a numeric grade/score anywhere** — the constitution bans 0–100 grades; markers speak in
position-vs-optimal and direction only.

- `.hmk-groups` — vertical stack (gap 18px) of `.hmk-section` health-group sections; desktop flows
  those sections into two columns.
- `.hmk-grouphead` — `.lbl` caps section heading per group ("Lipids & Cardiovascular", "Metabolic
  & Glucose", "Iron & Red Blood", …) in `--ink-2`. It is sticky below the Health segmented controls
  so a long scroll always keeps the current clinical panel visible.
- `.hmk-groupnote` — a short muted panel note, used sparingly. The lipid group uses it to explain
  why standard LDL-C and direct LDL-C are shown as separate assays rather than merged.
- `.hmk-subhead` — uppercase inline row divider inside a ledger card. Only used where it improves
  scan speed, currently lipids ("Standard lipid panel", "Atherogenic particle risk", "Advanced
  lipoprotein detail").
- `.hmk-card` — one ledger card per group, holding `.hmk` rows. `.hmk-row` is a `<button>`
  (`aria-expanded`) when the marker has ≥2 numeric readings, else a static row. `.hmk-id` stacks
  `.hmk-name` over `.hmk-when` (relAge recency, `title=absDate`); `.hmk-right` carries the delta
  arrow `.hmk-delta`, the latest `.hmk-val` + `.hmk-unit`, and the `.hmk-chev` disclosure.
- Tapping opens `.hmk-panel` (grid-rows `0fr`→`1fr`) into the inline **progress chart**
  (`markerChartSvg` + `markerPanelHtml`) — a hand-built SVG, no library, in the house line style:
  - `.hchart-band` — the optimal-zone band shaded (sage @ ~14%), folded into the y-domain so it's
    always on-screen even when every reading sits outside it.
  - `.hchart-line` — a Catmull-Rom ink curve that draws on open (`sparkdraw`, reduced-motion-gated).
  - `.hchart-dot` — every numeric reading as a flag-tinted dot: `.hchart-dot-watch` (warn) for a
    lab-flagged reading, `.hchart-dot-ok` (sage) otherwise. Drawn by `CairnUiChart.lineChartSvg`.
  - `.hchart-txt` — date labels at the axis ends (`CairnUiChart.dateLabel`).
  - `.hchart-latest` — the latest value + relAge recency callout above the chart.
  - `.hchart-cap` — sentence-case caption (NOT `.lbl`) under the chart: optimal band + the trend in
    plain words ("optimal 40–80 mg/dL · rising over ~14 mo") from the server `trend` (`markerTrendWord`).
- The Health → Read view's "what matters now" list (`.hb-mk`) keeps the compact generic `CairnUiChart.sparkSvg()`;
  the richer `.hchart` is the detailed Markers-tab view. The two are intentionally distinct surfaces.

## Health sharing (Stand → Share)

Share is the utility shelf for moving data out of Cairn or cleaning the imported corpus. Keep it
separate from Markers so the detailed lab-history catalog stays scan-led.

- Lead with the doctor-facing clinical marker report (`GET /api/health-report`) because it is the
  human artifact: grouped clinical panels, findings first, dated history, DEXA when present, and a
  MyChart-ready text copy. The report opens from an about:blank new tab so the PWA stays in place,
  then the new tab navigates to the printable HTML/PDF surface. In that report, the text-copy and
  PDF actions live in a fixed bottom action bar (`.actionbar`, `.no-print`) so they remain reachable
  after a long marker scroll but never appear in the printed/PDF document.
- Keep structured JSON export (`GET /api/health-export`) secondary. It is for tools/imports, not the
  default physician handoff.
- Keep data-maintenance actions here too, currently "Align lab names" (`POST /api/markers/reconcile`).
  It affects how future marker trends group, but it is not part of reading today's health picture.

## Coach tab (chat)

A crafted chat surface, not a form. Layout + behavior contract:

- **Flex viewport column.** `.chatview` (`display:flex;flex-direction:column`, height
  set live by `measureChatTop()`) holds `.chatlog-wrap` (`position:relative`, flexes) over
  `.chatdock` (`flex:0 0 auto`). The log is the ONLY scroller; the composer dock is always
  the bottom row, so the input bar **can never scroll off** — even under iOS Display Zoom /
  Larger Text. The height is re-measured on every viewport shift (zoom, keyboard,
  orientation, resize) via `visualViewport`, so it's robust, never a magic number. The CSS
  `height:calc(100dvh - 240px)` on `.chatview` is only the pre-measure default.
- **Shell-first.** `renderChat()` paints the shell (composer usable immediately) and shows a
  `loadingState` in the log, THEN hydrates `GET /api/chat` in the background (`pollToken`-guarded).
- **Bubbles.** `.bubble.user` = ink-on-`--ink` (cream), `.bubble.assistant` = card. Live turns
  enter with `.bubble-in` (scale-fade). Consecutive same-role turns **group**: `.cont` tightens
  the top, `.grouped` squares off a non-last bubble's tail; only the run's last bubble keeps the
  tail + a subtle `.bubble-time` (clock time, side-aligned). A pending assistant turn early-returns a
  caption + `.typing` dots (no time/copy). Assistant replies carry a hover/long-press copy
  (`.bubble-copy`), applied actions render as sage `.bubble-tag` pills, drafts as `.draftbtn`.
- **Jump-to-latest.** `.chat-jump` floats bottom-right of the log when scrolled up >120px.
- **Header cluster.** `.hdr-chat-actions` (anchored to the `position:relative` header) holds a
  `.hdrcircbtn` history/search button + the `.freshbtn` fresh-start (distill & archive). Both are
  removed by `renderTab` on tab leave.
- **History overlay.** `openChatHistory()` opens the read-only `.detail` scaffold with a search box
  (`/api/chat/search`) over past conversations (`/api/chat/sessions`, grouped by `archived_at`).
  Tapping a session/hit renders that conversation read-only (`appendMsg(..., {readonly:true})` into a
  `.chat-hist-convo`). Nothing is ever hard-deleted; this only reads. Gotcha: `.chat-hist-convo` lives
  inside `.detail-scroll`, which is a `text-align:center` column and the page's real scroller — so the
  convo must reset `text-align:left` (else bubbles render centered) and must NOT inherit `.chatlog`'s
  `overflow/overscroll` (as a no-room scroll container those swallow the touch gesture and nothing
  scrolls). Both are pinned on `.chat-hist-convo` in `styles.css`.

## Component architecture

How `src/client/**` is put together: what the code does today, and the rules that v2 UI work
follows. `docs/V2-PLAN.md` sequences the refactors; this section is the contract they aim at. The
numbers below were measured at v1.9.1 — re-measure before you quote them.

### What the code does today

- **One global scope, no framework.** 244 TypeScript modules (~60k lines; `.ts` files under
  `src/client`) compile file by file into `public/js/`, then get concatenated in a fixed order into
  seven bundles (`BUNDLES`,
  `scripts/build-client.mjs`). A module is an IIFE or block that publishes a `Cairn<Name>` namespace
  with `Object.assign(globalThis, …)`. There are about 206 of these namespaces, plus about 435 bare
  global functions kept for older callers.
- **HTML is built from strings.** About 357 `…Html()` renderers return markup, `innerHTML =` appears
  about 330 times, and `escHtml` is called about 1,000 times. There is no virtual DOM.
- **File roles follow the suffix, mostly.** `*-client.ts` means view (139 files; 73 of them do no
  fetching and add no listeners). `*-controller.ts` means load + state + wiring (39). `*-model.ts`
  means pure data shaping (6), and `*-screen.ts` means a tab or destination (8). The closest thing
  to a clean split today is `today-brief-client.ts` (pure renderers) with
  `today-brief-controller.ts` (fetching, caching, wiring).
- **Events are wired after paint.** There are about 535 `addEventListener` calls across 114 files.
  Delegation through `closest()` is rare (about 46 uses), and 8 files guard against double-wiring
  with `dataset.wired`.
- **31 modules still mix fetching, listeners and renderers.** They are the refactor list, largest
  first: `api-client.ts`, `body-metrics-client.ts`, `today-screen.ts`, `stand-screen.ts`,
  `plan-editor-controller.ts`, `progress-program-controller.ts`.

### The component contract

A **component** is one piece of UI with a stable prefix, for example `pweek`, `hmk` or `meal-card`.
It lives in one to three files that share a stem:

| File | Holds | Must not |
|---|---|---|
| `<stem>-model.ts` (optional) | Pure functions from a server DTO to a view model | Touch the DOM, fetch, read `state` |
| `<stem>-client.ts` (view) | `thingHtml(model, opts): string`. Deterministic; every caller string goes through `escHtml`/`escAttr` or a `CairnUi` primitive | Fetch, add listeners, read `state`, write storage |
| `<stem>-controller.ts` | `mountThing(host, deps): () => void`. Loads through `deps`, paints into `host`, wires with delegated listeners on `host`, and returns a teardown | Query outside `host`, render another component's markup inline |

Rules:

1. **Screens compose and components stay unaware of screens.** A `*-screen.ts` owns the layout, the
   route/segment, the slot ids (`#fooSlot`) and the `deps` it builds. It paints its shell or skeleton
   synchronously, then mounts components into `.card-stack-item` slots. A component never reaches
   into another component's nodes or calls another screen's `render…`.
2. **Dependencies come in through `deps`, not globals.** A controller receives what it needs
   (`api`, `toast`, SWR helpers, `navigate`, …) as an object. The existing `…Deps()` factories
   (`todayRailDeps`, `exerciseDetailDeps`, `me-health-dependencies.ts`) are the pattern. New code
   adds no compatibility bridges and no one-line forwarding shims (there are about 51 today, such as
   `sparkDateLabel` in `health-markers-client.ts:61`).
3. **Each module has one export and one name.** Publish one `Cairn<Stem>` namespace, once, through
   `Object.assign(globalThis, …)`. In the browser `globalThis` is `window`, so the extra
   `window.X = …` block that about 200 files repeat is redundant. Don't copy it. Don't add new bare
   globals. A top-level reference into another module still needs a lazy `() => fn()` thunk
   (CLAUDE.md), and an eager bundle never touches a lazy bundle's namespace at load time.
4. **Actions are data attributes, handled by delegation.** Name an action
   `data-<prefix>-<action>`; `data-pweek-day`, `data-cfocus-go` and `data-decision-undo` already
   work this way. Put one listener per event type on `host` and dispatch from the event target
   upward: `CairnUiActions.delegate(host, type, {"<prefix>-<action>": (el, event) => …})` takes
   each key as the data attribute without its `data-` prefix and runs at most one handler per
   event, the one on the innermost element (between the target and `host`) carrying an action,
   so an action button inside a navigable row acts and never also navigates.
   Delegation alone does **not** make `mount` idempotent: a host is a persistent slot, so a second
   `mountThing(host, deps)` replaces the markup but adds a second listener to the same host, and one
   tap then fires twice (two revert POSTs, two logged sets). Idempotency comes from the mount helper,
   `CairnUiActions.mount(host, name, wire)` (`ui-actions-client.ts`). It keeps a `WeakMap` from
   host to a map of mount name → that mount's teardown; a new mount of the same name on the same
   host runs the previous teardown first. `wire` gets `{host, signal, delegate}`: `signal` belongs
   to an `AbortController` owned by this mount, and `delegate(type, actions)` registers its
   listener with that signal. The teardown `mount` returns aborts the controller (every listener
   goes with it), runs the cleanup `wire` returned if it returned one, and forgets the mount;
   calling it twice, or calling an older mount's teardown, changes nothing. The name is part of
   the key so two components on one shared legacy host (a whole view) never tear each other down.
   A `mountThing(host, deps)` therefore ends in
   `return CairnUiActions.mount(host, "<prefix>", ({delegate}) => delegate("click", {…}))`, as
   `mountProgramBlock` (`progress-program-block-client.ts`) and the session primer toggle do.
   Only code that wires through that helper may drop `dataset.wired` guards. Use ids only for
   slots a screen owns.
5. **Async paints check that they are still current.** Each continuation after an `await` checks the
   render generation (`pollToken`, `ui-shell.ts:217`) or the controller's own token, plus
   `host.isConnected`, before it writes.
6. **The server owns the truth; renderers print it.** Today's lift line, reading-grammar words,
   outcome phrases and Undo labels all arrive finished from the server. A renderer frames them and
   never works them out again (CLAUDE.md, "Today's lift has ONE server line").

### State ownership

| State | Owner |
|---|---|
| Durable truth | The server. Never mirrored by hand. |
| Last-known server JSON | The SWR cache (`swr-cache.ts`), JSON only |
| Route, navigation, cross-screen hand-offs | `state` (`ClientAppState`, `src/contracts/client-state.ts`): `tab`, `logDate`, `*Seg`, `pending*`, `chatPrefill` |
| Component UI state (open fold, selected day, unsaved edits) | The controller's closure, or the DOM itself (`aria-pressed`, `<details open>`) |
| Per-viewer preferences (units, a dismissed card) | `localStorage` `cairn.*` keys, every access wrapped in try/catch |
| Writes made while offline | The outbox (`outboxEnqueue` in `outbox.ts` / `runSessionMutation` in `outbox-session.ts`) |

Don't add new underscore caches to `state`. The existing ones (`_dayFuel`, `_goal`, `_briefInflight`,
`_briefMorph`, `_lifeById`, `_famById`, `_notesById`) move to an SWR key or a controller closure when
their owner is touched. **Never cache HTML.** `today-screen.ts:162` stores rendered markup in
`sessionStorage`; it is scheduled to go.

### Data loading

- **Reads:** a surface uses `paintSWR({key, path, peek, render, token})`, a slot uses `cachedApi`,
  and a synchronous warm paint uses `peekCached` (`swr-cache.ts`). Show a skeleton only on a true
  cold start, and upgrade in place only when the JSON actually changed. **One cache per fact.** New
  surfaces don't add their own `sessionStorage` snapshot (`stand-screen.ts:1243` and
  `today-screen.ts:162` both do today); SWR already provides that snapshot.
- **Writes:** call `api(path, {method})`, then `swrInvalidate(key | prefix)`, then repaint only the
  component that changed. A write that has to survive going offline goes through the outbox.
- **Prefetch:** start reads before you await them. On Today, `CairnTodayPrefetch`
  (`today-data-loader.ts`) and `prefetchRail` (`today-rail-controller.ts:134`) hand the in-flight
  promise to the slot instead of fetching twice. `api()` already merges identical concurrent GETs
  (`createApiCoalescer`, `api-cache.ts`).
- **Agent work:** use `runOp` (`agent-job-client.ts:262`) with a `data-job-anchor` and
  `registerJobReconnector`. A paint never waits on an agent.
- **Server signals:** `{ok:false, error}` with HTTP 200 is a calm refusal, so leave the surface as it
  was and say why in one sentence. `200 + null` means the thing is absent.

### Naming

- **Files:** `<surface>-<component>-{model,client,controller}.ts`, screens `<surface>-screen.ts`,
  shared primitives `ui-<name>.ts`. Each new file gets a `CLIENT_OUTPUTS` entry and a place in
  `BUNDLES` (and `CORE_ASSETS` if it becomes a new served asset).
- **Functions:** renderers `thingHtml`, SVG builders `thingSvg`, controllers
  `mountThing`/`wireThing`, loaders `loadThing`, pure shaping `thingModel`.
- **CSS:** each component gets one short prefix (`.hmk-*`, `.pweek-*`), listed in the inventory
  below. Use `.is-*` for state and `-ok` / `-watch` / `-quiet` for tone, the same words the reading
  layer uses. Don't coin a new tone vocabulary.

### Size limits

A module stays under **400 lines**, and **600 is the hard ceiling**; 30 files are over 400 today and
14 are over 600. A render function stays under about 80 lines; past that, split it into
sub-renderers. A screen file does composition only and stays under 400. The existing oversize files
are allowed to shrink but never to grow, and each is split when a wave touches it.

### Tokens

- Every color, shadow, radius, font, duration, easing and press depth is defined in `styles.css`
  §01 `:root`. **TypeScript never writes a hex color or a duration literal.** SVG built in TS styles
  itself through classes or `var(--token)`. The only exceptions are the authored illustration
  libraries (`art.js`, `cairn-body-figure.ts`). Hex literals today: `body-metrics-client.ts` 118,
  `agent-login-modal-client.ts` 29, `progress-overview-client.ts` 20, `progress-screen.ts` 13,
  `api-client.ts` 13.
- **Inline `style=""` carries data only:** custom properties (`--i`, `--frac`, `--segi`, `--segn`)
  and data geometry (`left`/`width` percentages). About 527 inline styles in 80 files do more than
  that today (98 of them in `body-metrics-client.ts`).
- **Scales that are still missing:** spacing (only `--space-card` exists), type (about 70 distinct
  `rem` sizes), z-index (about 15 raw values between 1 and 90), and a pill radius (`999px` appears
  127 times). The v2 foundation adds `--space-*`, a short `--text-*` scale, named `--z-*` layers and
  `--radius-pill`, and new CSS uses only those.
- **New component CSS** goes in its own numbered `styles.css` section under the component's prefix.
  The section numbers are out of order today (04c/04d come before 04b, 29b comes after 35, and §31
  appears twice); renumber them when the file is next reorganized.

### Motion system

The tokens and vocabulary are in **Motion tokens** above. Rules for anything new:

- **Duration by role:** `--dur-1` (200ms) for presses, hovers and state flips. `--dur-2` (320ms) for
  sheets, overlays, segment thumbs, view transitions and detail swaps. `--dur-3` (450ms) for
  entrances, bars growing and photo fades. Count-ups (~750ms) are the one longer exception, and
  loading loops are separate from all of these. There are 55 `.15s` transitions and 10 copies of the
  `--ease` curve written out as literals today; move them to tokens when you touch their section.
- **Easing:** `var(--ease)` only. Use `linear` only for spinners and progress fills.
- **Press:** use the `--press*` token that matches the target size. Press is kept under reduced
  motion because it confirms the tap rather than decorating it.
- **One entrance per element:** either `.reveal` with a `--i` stagger (capped at 12) or `settle-in`,
  never a fade and a rise together. `viewHydrate()` owns the skeleton-to-content swap.
- **View changes** go through `withViewTransition`/`tabSwap`. The shared-element names are reserved
  (`detail-art`, `seg-thumb`, `tabbar`); register any new one here before using it.
- **Height changes** use `collapseEl`/`expandEl` (`ui-motion-client.ts`) or the `grid-template-rows`
  0fr→1fr pattern (`.hmk-panel`). Never hand-animate `height:auto`.
- **Reduced motion:** JS checks one predicate, `reducedMotion()` (`ui-feedback-client.ts`), and
  never its own `matchMedia` (`test/uiReducedMotion.test.js` holds that). Every new keyframe is
  either silenced by §30 or deliberately restored there as functional.
- **Budget:** only one thing moves for attention at a time. Reading surfaces get no looping
  decoration, and the only celebration is the gold PR moment.

### Empty, loading and error states

| Situation | Primitive | What it says |
|---|---|---|
| Cold load | Skeleton shaped like the final layout (`todaySkeleton`, `segSkeleton`, `skelLines`, `ui-feedback-client.ts:145–163`) | Nothing. It is the layout. |
| Region fetching or an agent thinking | `loadingState` / `CairnUi.loadingStateHtml` + `thinkingCaption` | A calm, op-specific line |
| Button kicked off an operation | `btnBusy(btn, label)` | A working label, footprint pinned |
| Surface being regenerated | `.is-thinking` / `.is-thinking--determinate` | Nothing more |
| Background refresh | `.swr-refreshing` hairline | Nothing. Never a spinner over real content. |
| Empty | `CairnUi.emptyStateHtml` (`ui-components.ts:133`) | What would fill it and where that comes from ("Mention pain in your session notes or chat"). Never "0" or "no data", and never blame. |
| Optional async slot with nothing to show | Collapse it (`:empty{display:none}`, `.card-stack` drops empty items) | Nothing |
| No recent signal in a domain | Plain words | "Quiet". A silence is normal and never reads as a problem or "low". |
| Refusal (`{ok:false}` at 200) | One sentence in place | Why, with the surface left unchanged |
| Network failure | `tabErrorState` (`ui-feedback-client.ts:136`) for a tab; `toast` for an action, keeping what was typed; while offline, the outbox and "Saved — will sync" | Plain, recoverable |

About 21 files still build their own `*-empty` markup; move them to `emptyStateHtml` when you touch
them. Progress's `emptyStateHtml(svg, line)` is a thin entry point onto the same primitive.

### Accessibility minimums

- Actions are `<button type="button">` and navigation is a link. `role="button"` on a `div` exists
  only in legacy code (5 files).
- Toggles set `aria-pressed`, and disclosures use `aria-expanded` or a native `<details>`. A
  segmented control is `role="group"` with an `aria-label`.
- Tap targets are at least 44px (§38). The focus ring shows for keyboard users and stays quiet for
  pointer users (**Motion tokens**, "Programmatic focus is quiet").
- Small text uses the AA text tokens (`--muted`, `--sage-text`, `--gold-deep`), never `--sage` or
  `--gold`.
- Color is never the only signal. A dot or pip carries its meaning in `aria-label`/`title` and in a
  visible phrase.
- Async status uses `role="status"` with `aria-live="polite"` (`loadingStateHtml`,
  `jobCaptionHtml`). Never assertive.
- **Overlays share one primitive,** `CairnUiSheet.open` (`ui-sheet.ts`): `role="dialog"`,
  `aria-modal="true"`, a label, focus moved in and returned to the opener on close, Escape and
  backdrop both close (unless the sheet is deliberately not dismissible, like the token sheet and
  first-run onboarding), Tab stays inside, and the background is inert. The meal sheet, BP sheet,
  onboarding, token sheet, outbox review and agent sign-in all run on it; `.detail` stays the
  full-screen item overlay.
- `prefers-reduced-motion` (§30) and `prefers-contrast: more` (§39) are honored. A number always
  carries its unit, and dates read the way a person says them (**Hard rules**).

### Testing

Client tests run the **built** module (`public/js/<name>.js`) against the shared DOM harness in
`test/_dom.mjs`. They don't read the TypeScript source with regexes (about 29 test files still do),
and they don't hand-roll a `FakeElement` (43 files still do; move them onto the harness when their
module is touched).

- **What the harness gives you.** `loadClientModule(names, {globals, document})` runs one or more
  built modules, in the order given, in a fresh `vm` sandbox and returns its global object (the
  fake `window`). The sandbox holds the host builtins, a fake `document`, in-memory
  `localStorage`/`sessionStorage`, the DOM constructors (`HTMLElement`, `HTMLButtonElement`, …, so
  `instanceof` checks work) and window-level events. Anything else the module reaches for, such as
  another module's `Cairn<Name>` namespace or `setTimeout`, goes in `globals`. The fake DOM parses
  `innerHTML`, so `querySelector` finds what the renderer actually emitted. It supports a practical
  selector subset, attributes, `dataset`, `classList`, `style`, form values, focus, and events that
  capture and bubble through the document to the window. An unsupported selector throws instead of
  returning `null`. `el.click()` and `fire(el, type, init)` return a promise that settles when every
  handler they ran has settled, so `await button.click()` waits for an async handler.
- **Renderer test.** Load `html-utils` plus the module, call `thingHtml(model)`, and put the result
  through `renderHtml(html)`. Then assert on structure: `host.querySelector(".thing-row")`,
  `.textContent`, `.dataset`, `aria-*`. A regex over the markup is fine for a phrase, but not for
  structure. Pin the escaping by rendering hostile input (`<b>`) and asserting that it comes back as
  text rather than as an element.
- **Controller test.** Give the controller a `createHost(document, {html})` host. The host is
  attached to `document.body`, so `isConnected` is true the way it is on a real screen. Build `deps`
  from plain recording functions (`api` pushes the path and returns a fixture), then mount, and
  drive it with `click()`/`fire()` on the elements the render produced. Assert on the host's DOM and
  on what the deps recorded. To simulate the person leaving, call `host.remove()` rather than
  setting a flag. For timing, use `flush()` (`await` it to drain chained promises) and
  `createFakeTimers()`, which run only when the test calls `tick()` or `runPending()`.
- **The harness is honest, so be honest back.** A disabled button doesn't fire, a `<select>` only
  takes a value that one of its options has, and a removed node is disconnected. If a test only
  passes against a hand-rolled fake, the fake is hiding a real difference, so fix the fixture or the
  code rather than the harness. `test/domHarness.test.js` pins the harness's own behavior.

### Component inventory

**Shared primitives to reuse and extend.** A new surface composes these instead of re-rolling them.

| Primitive | Module | Notes |
|---|---|---|
| `escHtml` / `escAttr` | `html-utils.ts` | The only escapers |
| `CairnUi` (attrs, action button, text chip, loading state, segmented control `segmentedHtml` + `segmentedNavHtml`, job caption, sheet chip, empty state) | `ui-components.ts` | Pure renderers; the model for new primitives |
| `CairnUiReads` (baseline band, contributor rows, level chip, trend lead, strength line) | `ui-reads.ts` | The reading grammar |
| Feedback: `btnBusy`, `countUp`/`runCountUps`, `loadingState`, `thinkingCaption`, `tabErrorState`, skeletons | `ui-feedback-client.ts` | |
| `showToast` (with an action) + `armDestructiveAction` | `ui-actions-client.ts` | `toast`/`armDelete` in `ui-shell.ts:33/37` are thin wrappers |
| View transitions: `withViewTransition`, `tabSwap`, `viewHydrate` | `ui-view-transitions-client.ts` (re-exported in `ui-shell.ts`) | |
| `collapseEl` / `expandEl` | `ui-motion-client.ts` | |
| Segments: `segBar` / `wireSeg` / `fitSeg` | `ui-segments-client.ts` | |
| Detail overlay: `openDetailFrom` / `closeDetail` | `detail-overlay-client.ts` | Full-screen items only |
| Sheet / dialog: `CairnUiSheet.open` → `{overlay, sheet, close, isOpen}` | `ui-sheet.ts` | The one overlay primitive; new sheets take `.ui-sheet-ov` / `.ui-sheet` (§21), existing ones pass their own classes |
| Charts: `CairnUiChart` (`sparkSvg`, `lineChartSvg`, `gaugeSvg`, `zoneBarSvg`, `linearScale`, `domain`, `dateLabel`) | `ui-chart.ts` | One scale and one date label; tone by class, no hex |
| Decision Undo: `CairnDecisionUndo.buttonHtml` + `CairnDecisionUndoController` (`revert`, `mount`, `offer`) | `decision-undo-client.ts`, `decision-undo-controller.ts` | Server-owned label; one busy state and one calm refusal |
| Save bar | `save-bar.ts` | |
| SWR, jobs, API + outbox | `swr-cache.ts`, `agent-job-client.ts`, `api-core.ts` (+ `api-cache.ts`, `token-sheet.ts`), `outbox*.ts` | The outbox is five modules: queue, runtime (live queue + lease), replay, session, drain + `CairnOutbox`; `outbox-ui.ts` paints the bar and review |
| Art: `artImg`, `CairnArt`, `CairnBodyFigure` | `art-controller.ts`, `public/art.js`, `cairn-body-figure.ts` | |
| Markdown, dates, formats | `markdown-client.ts`, `date-utils.ts`, `format-utils.ts` | |

**Duplicates to consolidate** (v2 foundation). F3 folded the segmented control, overlay, chart,
decision-undo, reduced-motion and escaping rows into the primitives above; what remains is noted
in each row.

| Pattern | Copies today | Target |
|---|---|---|
| Segmented control | Done: `CairnUi.segmentedHtml` builds the section bar, the Progress group/leaf bars, the Health sub-tabs, the Profile choice groups and the Stand clinical flags. Onboarding's two `.seg` groups are still hand-built | One `segmentedHtml({items, active, label, variant: 'sliding'\|'plain'\|'leaf'})` + `wireSeg` |
| Overlay / sheet / modal | Done: every sheet runs on `ui-sheet`. The token sheet and agent sign-in still inject their own `<style>` (F4 moves the token sheet's into `styles.css`) | One `ui-sheet` (bottom sheet on mobile, dialog on desktop) meeting the overlay rules above; `.detail` stays for full-screen items |
| Charts | Done for the SVG charts: sparkline, marker line chart and gauge, body-metrics zone bar, and the date labels (`sparkDateLabel`, `fmtShortDate`) all come from `ui-chart`. `baselineBandHtml` stays in `CairnUiReads` (a frozen reading-grammar primitive, HTML not SVG; `tovLoadBandHtml` composes it). The canvas `progress-chart-*` shares the date label but keeps its canvas palette (with hex fallbacks) | One `ui-chart` module (spark/line, band, zone bar) sharing scales and date labels; no hex |
| Decision Undo | Done: the exercise Undo, the rail's Hold/Undo and the meal Hold/Undo all revert through `CairnDecisionUndoController` | One `decision-undo` component (button + toast action + busy state + error) |
| Empty state | `emptyStateHtml` alongside about 21 hand-rolled `*-empty` blocks | `emptyStateHtml` |
| Reduced-motion check | Done: `motionReduced` and the inline `matchMedia` checks are gone | `reducedMotion` |
| HTML escaping | Done: `escapeOutboxHtml` is gone | `escHtml` |
| Screen snapshots | `today-screen.ts:162` (HTML), `stand-screen.ts:1243` (JSON) | SWR |

**Components v2 adds** (sequenced in `docs/V2-PLAN.md`): `changes-line`, `changes-feed`,
`decision-undo`, `meal-card` (editable rows), `food-composer` (shared by Fuel and chat),
`fuel-today`, `idea-card`, `records-search`, `packet-builder`, `visit-questions`, `race-ladder`,
`pebble-strip`, `cairn-stack`.
