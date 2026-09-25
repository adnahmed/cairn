# Cairn v2: the executable roadmap

This is the working plan for the `v2` branch. **Delete this file when v2.0.0 ships**, per the
lean-docs habit: what shipped moves to `docs/ARCHITECTURE-HISTORY.md` and the lasting rules move to
`docs/DESIGN.md` / `docs/ARCHITECTURE.md`.

**North star:** v2 grows out of the current Atelier app; it does not replace it. Every wave ships
inside the app the athlete already uses. The one big change to navigation (fewer tabs) comes last,
after the screens have proven themselves. The order follows the evidence of how the app is actually
used:

1. Make the record true.
2. Let the team decide, with Undo.
3. Improve the logging the athlete already does every day.
4. Then the deeper screens.

Inputs are `docs/VISION.md` (the constitution), `docs/DESIGN.md` → **Component architecture**
(the UI contract every wave follows), and the v2 "moonshot" and "grounded path" prototypes, which
are design artifacts kept outside the repo.

## Laws that bind every wave

These are acceptance criteria for every wave, not guidelines.

- **No scores.** No 0–100 grades, percentiles or letter grades. A read is words plus the person's
  own baseline.
- **Suggestions, never gates.** The athlete drives, and no screen blocks on a read.
- **The team decides and offers Undo.** It asks only for something clinical, something
  irreversible, or evidence it genuinely lacks. Autonomy is server policy (`src/brain/autonomy.ts`),
  never a renderer's choice.
- **A thin logging day is absent, never low** (`classifyIntakeDay`). Silence in any domain reads as
  "quiet", never as a problem.
- **Meal plans are ideas, never eaten as written.** Nothing assumes a planned meal was eaten.
- **One composer.** Multi-line food capture (and photo) happens in one composer that Fuel and chat
  share; it builds on the single `src/foodCapture.ts` contract.
- **The lab flag stays separate from the optimal band.** The lab's own HIGH/LOW and "outside
  optimal" are two different facts, shown as two different marks.
- **Clinical order comes from `MARKER_GROUPS`** (`src/repo/propagation-data.ts`), everywhere markers
  are listed or exported.
- **Sleep is episodic by choice.** No surface depends on a night being worn or logged.
- **No required taps.** Check-ins, ratings and feel scales stay optional, and nothing depends on
  them.
- **Half marathon only.** The race horizon covers the half-marathon build.
- **Kilometers per week** is the unit for run volume everywhere.
- Plus everything in CLAUDE.md "Product constraints" and "Domain gotchas": pull, never push;
  informational, never medical advice; the server owns derived facts.

## How the waves run

- **Branches:** `main` stays at v1.x. `v2` is the integration branch. Each stream works in its own
  worktree on `v2-w<N>-<slug>` branched from `v2`, and merges back after review. Nothing merges to
  `main` until the athlete decides v2 is ready.
- **Migrations:** each stream that needs one is given a number up front, counted from the live
  deployment's `user_version`. Two streams never share a number, and the numbers go into
  `src/migrations/v101-150.ts`.
- **Wave exit gate:**
  - `npm run build`, `npm run tsc -- --noEmit`, the full `npm test`, and `npm run verify` all pass.
  - The wave is deployed to the private test device and checked there against live data.
  - Only then does the next wave start.
- **A component is done when:**
  - It follows the contract in DESIGN.md.
  - Its renderer has unit tests, run through the shared DOM harness (F1).
  - Empty, loading and error states are all present.
  - It has been checked under reduced motion, meets the 44px tap target, and passes AA contrast.
  - It has no hex colors or durations in TypeScript and stays within the size limits.
- **Parallel streams never edit the same file,** with one named exception below. Each wave lists who
  owns which files. A shared primitive lands first, as its own stream, before the streams that use
  it.
- **Shared append-only files are integration-owned.** Some files take an entry from almost every
  stream, so no stream owns them:
  - `scripts/build-client.mjs` (`CLIENT_OUTPUTS`, `BUNDLES`) and `public/sw.js` (`CORE_ASSETS`);
  - `src/contracts/client-globals.d.ts` (the global namespace declarations);
  - the registries `src/api.ts` and `src/mcp.ts`, when a stream adds a new router or MCP module;
  - `src/db.ts` create blocks and `src/migrations/v101-150.ts`, each stream appending only its own
    pre-assigned migration number;
  - the generated `docs/API.md` and `docs/MCP-TOOLS.md`.

  A stream only **appends** its own entries there: it never reorders, reformats or edits another
  entry. The integrator resolves those files at merge time and, for the generated docs, discards
  both sides of a conflict and reruns `npm run docs:index` (a stream may regenerate them to pass
  its own `verify`, but that copy is never merged by hand).

---

## Wave 0: Make the record true, and lay the ground

Every later screen reads from this data. If three goals disagree, the horizon can't show one; if the
doctor loop repeats itself, the packet will too.

### Track A: truth fixes (being integrated now)

Wave 0's four truth streams are built and reviewed, and are being integrated into `v2` in this
order (meals first, because dedupe's migration follows it):

- **Meal-plan auto-draft becomes a setting that defaults to off** (migration 114). No weekly or
  protective auto plans; ideas arrive only on request.
- **Chat capture routing.** Weight and blood pressure typed in chat land in their own tables, not as
  activities, and the rows already misrouted are repaired. A logged activity can also be deleted
  (REST plus its MCP mirror), so a stray row has a way out.
- **Same-day dedupe** (migration 115). Duplicate weight, tape and check-in rows on the same day
  merge, and a manual run dedupes against the watch's run.
- **Doctor-loop collapse.** Each follow-up appears once, with its real due date
  (`src/repo/doctor-loop.ts`).

Two more truth items are owned by later waves, in generic form: **one active goal** (Wave 1,
stream E) and the **observed intake band** under the protein anchor (Wave 2, stream A). Where a
single deployment's data already disagreed, it was repaired as a one-off live data fix; the waves
add the general guard so it cannot recur.

### Track B: foundation refactors (this is the order)

Each item is a pure refactor: behavior is identical and tests are unchanged or added. The items
exist to make waves 1–6 cheap and safe.

| # | Refactor | Why first | Files |
|---|---|---|---|
| F1 | A shared DOM test harness (`test/_dom.mjs`: a fake element/document plus a loader for one built module) and a pattern for renderer tests | 36 test files each hand-roll a `FakeElement`, and many tests regex the TS source, which breaks on any refactor. Tests have to be sturdy before code moves. | `test/_dom.mjs` (new); migrate tests as their modules are touched |
| F2 | Token completion (`--space-*`, `--text-*`, `--z-*`, `--radius-pill`), a sweep of motion literals onto `--dur-*` / `--ease`, and a ratchet script `scripts/check-client-style.mjs` (hex in TS, inline-style count, per-file line count must not grow) wired into `verify` | Once the ratchet exists, the numbers can only go down | `public/styles.css` §01 + the touched sections, `scripts/` (new), `scripts/run-verify.mjs` |
| F3 | Shared primitives: `ui-sheet` (one overlay), one segmented builder, `ui-chart` (spark/band/zone), `decision-undo`, adoption of `emptyStateHtml`, a single `reducedMotion()`, and removal of `escapeOutboxHtml` | Waves 1–5 build on these, and building them once avoids six more copies | `src/client/ui-*.ts` (new/extended), the call sites listed in DESIGN.md's duplicates table |
| F4 | Split `api-client.ts` (2,418 lines) into `api-core` (fetch, coalescer, auth), `outbox` (queue, lease, drain), `outbox-ui` (bar and review, on `ui-sheet`) and `token-sheet` (its injected `<style>` moves into `styles.css`) | This is the largest file, and it mixes transport, persistence and UI; every write path passes through it | `src/client/api-client.ts` → 4 modules, `scripts/build-client.mjs`. **Starts after F3 has merged** (it needs `ui-sheet`, and F3 edits `api-client.ts` to remove `escapeOutboxHtml`) |
| F5 | The mount contract helpers: `delegate(host, type, {action: handler})` in `ui-actions-client.ts` and the `mountThing(host, deps) → teardown` shape. Mount idempotency is the helper's job, not delegation's: each mount's listeners share one `AbortController` `signal`, a `WeakMap` maps each host to its current teardown, and mounting again on the same host runs the previous teardown first (DESIGN.md, contract rule 4) | New v2 components need it from their first line | `ui-actions-client.ts` (F5 is its only editor in Track B) |
| F6 | Dead-code sweep. **Check each item against dynamic class builders before deleting.** Candidates: `quickLog` + `#qlInput` (`capture.ts:10`; nothing renders that input any more) and `.ql-field` CSS; the unused `CairnHealthCheckup` namespace export; the `canRenderCard` export; CSS families with no source reference (`.feedback-joint*`, `.stand-mcard*`, `.stand-supp*`, `.hsyn-fp*`, `.heat*`, `.agentrow`, `.bm-tape*`, `.hstand-track`) | Less surface to reason about during the waves | `capture.ts`, `health-checkup-client.ts`, `public/styles.css` |

Order, by shared files:

1. F1 and F2 run in parallel. F5 can join them (it only edits `ui-actions-client.ts`), and its
   tests use F1's harness, so it merges after F1.
2. F3 starts after F1 and F5 have merged: its components (`decision-undo` first) mount through
   F5's helper. F3 extends the `ui-*` modules but does not edit `ui-actions-client.ts`; it consumes
   `showToast` and `delegate` as they are. F3 also edits `api-client.ts` (removing
   `escapeOutboxHtml`, moving the outbox review and token sheet onto `ui-sheet`).
3. F4 starts only after F3 has merged, because it splits that same `api-client.ts` and its
   `outbox-ui` module is built on F3's `ui-sheet`.
4. F6 goes last, because it touches `styles.css` after F2 has settled.

**Decision for the athlete: native ES modules.** The shared-global IIFE model is the root cause of
the compatibility bridges, the forwarding shims and the load-order hazards. The recommendation is to
**defer the move to after v2**. v2's rules (one namespace per module, dependencies passed in through
`deps`, no new bare globals) make a later migration mechanical, and doing it mid-v2 would reopen the
bundle and service-worker breakage class during the UI waves. The trade-off is that the bridges
(about 1,040 lines across the six `*-deps` / `*-dependencies` / `*-bridges` files) survive until
then.

**Acceptance:**

- The four truth fixes are deployed and verified against live data.
- F1–F6 are merged, `verify` includes the style ratchet, and no behavior test changed its
  expectations.
- F5: mounting a component twice on the same host and tapping once runs its handler exactly once,
  and calling the teardown leaves no listener on the host (tested through F1's harness).

---

## Wave 1: The team decides, you Undo

**Outcome:** kinds of change that currently ask and then quietly lapse (training targets, rotations,
structure) now decide and announce, with Undo. Clinical, locked and irreversible changes still ask.
Today shows one line, "2 changes overnight", which opens a single **Changes** feed: what changed,
why, and Undo. A weekly read that would say the same as last week says so in one line instead of
repeating itself.

**Components:**

- `decision-undo` (from F3). Replaces the four revert call sites. The server owns the label ("Restore
  previous bench target"), and Undo stays available at the affected detail after the toast expires.
- `changes-line` (Today). One line built from the server count; hidden when the count is zero; tap
  opens the feed.
- `changes-feed`. Extracted from `renderCoach` in `coach-meals-screen.ts`, which already has a
  history-first "Changes" surface, into its own component. Rows are grouped by day and show: what
  changed, why (in the spoken voice), one of the four fixed outcome phrases, confidence words
  (`tentative` / `observed` / `strong`), and Undo.
- `ask-card`. The remaining asks (clinical, irreversible, missing evidence): calm, and never a nag.

**Server:**

- `decideAutonomyTier` (`src/brain/autonomy.ts`) maps the lapsing ask kinds to announce under the
  lead mode. `clinicianFloorHolds` is untouched in both directions, and the surprise budget stays in
  force.
- **Asks still waiting at the switch are re-decided, never applied blindly.** They can be days or
  weeks old, and the plan has moved since. They go through the existing path in
  `src/domain/brain/autonomy-service.ts`: `retireDraftsWithDeadPremise()` first retires any whose
  target has left the plan, then the thaw sweep (`thawParkedReviewDecisions`) re-offers the
  survivors under the new tier, with the surprise budget in force. Decision logic never lives in a
  migration; if one is needed at all (number assigned at the time), it only marks rows for that
  re-evaluation.
- **One active goal** (stream E). Activating a new journey phase (`activateJourneyPhase`,
  `src/repo/journey.ts`) completes any stale active phase, so only one is active. The profile's
  goal weight and date and the active phase can't silently disagree: a server read reports any
  disagreement between them in words, for the coach context and the goal surfaces, instead of
  either side quietly winning.
- An athlete-facing projection of `brain_decisions` in `src/domain/brain/`: `GET /api/brain/changes`
  plus an MCP near-mirror. Rows carry the finished title, why, outcome phrase, confidence word and
  Undo `{available, label}`. No evaluator scores.
- Weekly-read repeat detection in the weekly-read generator (`src/repo/insights.ts` /
  `src/coachOps/memory.ts`).

**Acceptance:**

- A lapsing-kind change lands without a waiting row, appears in the feed, and Undo restores the
  server snapshot exactly (tested).
- A clinical change still asks (existing autonomy tests stay green).
- A stale ask whose target has left the plan is retired, never applied; a surviving one is
  re-decided through the autonomy path; no migration applies a change (tested).
- Activating a phase leaves exactly one active phase, and a profile goal that disagrees with the
  active phase is reported by the read, never silently overwritten (tested).
- The Today line is absent at zero, and its count equals the number of feed rows.
- The feed paints instantly from SWR, and Undo invalidates and repaints only the affected rows.

**Risks:**

- Autonomy the athlete doesn't expect. Mitigations: the surprise budget, an announce toast, and Undo
  at the affected item.
- Double announcement (toast plus feed plus item flag) for one decision. Each decision gets one
  voice per surface.
- Stale asks landing on a plan that has moved on. Mitigation: the premise check runs first, the
  survivors go through the ordinary thaw path, and nothing is applied by a migration.

**Streams:**

- **A (server):** `src/brain/autonomy.ts`, `src/domain/brain/*`, the brain route and its MCP module,
  plus the migration if one is needed.
- **B (feed):** `coach-meals-screen.ts` and the new `changes-feed-*` files.
- **C (Today line):** `today-rail-controller.ts`, one mount in `today-screen.ts`, and the new
  `changes-line-*` files.
- **D (weekly read):** the insight files.
- **E (one goal):** `src/repo/journey.ts`, the goal-disagreement read beside it, the journey route
  and its MCP module (`src/routes/journey.ts`, `src/surfaces/mcp/journey.ts`).

B and C consume `decision-undo` from F3. D and E are independent.

---

## Wave 2: Food, the logging already done every day, made editable

**Outcome:**

- **A logged meal comes back as a card.** One row per item, with editable grams; add a row, remove a
  row, done. No follow-up chat message is needed to correct it.
- **The same composer opens from a "Log" button in Fuel,** pre-set to food, with multi-line text and
  photo intact.
- **Fuel shows today so far:** energy, protein and fiber (numbers with units, never a score); a
  partial day reads "in progress". It also shows the meals logged today, plus three ideas built from
  the athlete's staples. Each idea has **Start from this**, which fills the composer for editing and
  never logs by itself.
- **Scheduled meal plans are replaced by ideas on demand,** kept within the athlete's own observed
  intake band, protein first.

**Components:**

- `meal-card` (view + controller). Built on the `foodCapture.ts` row shape. Grams use numeric inputs
  with `inputmode="decimal"`, rows add and remove with `expandEl`/`collapseEl`, and confidence/basis
  show as words. Refactors the meal read cards in `capture-read-cards-client.ts` and
  `food-detail-controller.ts`.
- `food-composer`. Extracted from `chat-composer-controller.ts`, `chat-attachment-client.ts` and the
  voice machinery into one component that both chat and Fuel mount. It keeps the frequent-foods
  prefill chips.
- `fuel-today`. Refactors `day-fuel-client.ts`/`day-fuel-controller.ts`.
- `idea-card`. "Start from this" / "Another idea".
- **The Fuel surface** lives at Plan → Food (the `plan/food` route) until Wave 5; `plan/meals`
  redirects into it. The meal-plan journal stays reachable as history.

**Server:**

- Extend `updateFoodNote` (`src/repo/nutrition.ts`) and `PUT /api/food-notes/:id` so ingredient-row
  edits recompute the note's totals deterministically, with no agent turn.
- A person's edit wins over a late enrichment pass: the row is locked once the athlete touches it.
- **The protein anchor and the observed intake band.** A server-owned read in `src/repo/` beside
  `intake-window.ts` and `cut-target.ts`:
  - The band is derived only from days `classifyIntakeDay` reads complete, together with the
    bodyweight response over the same weeks. Partial and unlogged days are absent, never "low",
    and never widen or lower the band. With too few complete days there is no band, and the read
    says so in words.
  - The protein anchor comes first. The band bounds energy only and never overrides the protein
    target.
  - It is an observation, not a target and not a maintenance measurement. `capProtectiveRaise`
    still caps a protective raise at **measured** maintenance, and the band never licenses a
    surplus or stands in for that measurement.
- `GET /api/fuel/ideas`, plus an MCP mirror. Deterministic first: staples from `frequentFoods` and
  the logged history, sized within the observed intake band, protein first. An agent refinement is
  optional and never blocks the paint.
- The auto-draft setting comes from Wave 0.

**Acceptance:**

- Editing one row's grams updates the totals with one PUT and no new chat message.
- A pasted multi-line meal with six or more items yields that many rows.
- Logging from Fuel lands in Fuel's list without leaving the screen.
- An idea is never shown as eaten or as a plan to follow.
- A partial day never reads "low".
- The intake band ignores partial days, and an idea never trades protein away to fit the band
  (tested).
- No meal plan is drafted by the scheduler (tested).

**Risks:**

- Extracting the composer touches chat, which is high-traffic and prone to keyboard and viewport
  bugs on iOS. The existing chat keyboard and composer tests guard it, and the chat surface gets a
  manual phone check.
- Enrichment racing a person's edit.
- Ideas quality.

**Streams:**

- **A (server):** `src/repo/nutrition.ts`, the new intake-band read, the nutrition route and its
  MCP module.
- **B (meal card):** `capture-read-cards-client.ts`, `food-detail-controller.ts` and the new
  `meal-card-*` files.
- **C (composer):** `chat-composer-controller.ts`, `chat-attachment-client.ts`, `chat-screen.ts` and
  the new `food-composer-*` files.
- **D (Fuel surface):** `day-fuel-*`, `renderFoodJournal`/`renderMeals` in `coach-meals-screen.ts`,
  `meal-plan-client.ts`, and the new `idea-card-*` files. D goes last, because it mounts B's and C's
  components.

---

## Wave 3: Health you can navigate, and a packet you can hand over

**Outcome:**

- **Records** gains grouping modes on top of the existing search: out of range first, by panel
  (`MARKER_GROUPS` order), and newest. Search extends to documents, visit notes and body readings.
- **The doctor packet** gains section toggles, plus visit questions drawn from the deduplicated
  doctor loop and any waiting clinical item. The export keeps today's clinical order, the lab flags,
  and the note about stale results.
- An overdue rescan or recheck is surfaced once, as evidence the team would like, and never as a
  nag.

**Components:**

- `records-search`. Extracted from `stand-screen.ts` (`showAllMarkers`, `renderResults`,
  `matchesQuery`, `standControlsHtml`).
- A segmented control for the grouping modes (F3).
- `marker-row`. The `.hmk` row, with the lab-flag mark and the optimal phrase as two separate
  elements.
- `packet-builder`: toggles plus a live preview.
- `visit-questions`: the athlete can remove or add a question.
- `evidence-wanted`: a single calm line.

All of these sit in the lazy `me-health` bundle and are never referenced eagerly.

**Server:**

- `GET /api/records/search?q=&group=` across markers, documents, notes and body readings, in
  `src/domain/health/`, plus an MCP mirror.
- Section toggles on `src/report.ts` (`buildClinicalReportData` / HTML / text / JSON) via
  `?sections=`.
- Visit questions from `doctorLoopRead` (`src/repo/doctor-loop.ts`) plus clinical asks.

**Acceptance:**

- "By panel" order equals `MARKER_GROUPS` order.
- "Out of range first" keys on the lab flag. "Outside optimal" is its own mark and is never merged
  with the flag into one word.
- A section toggled off is absent from HTML, text and JSON.
- Each doctor-loop item appears once.
- `impact_score` never leaves the server.
- The informational, not-medical-advice line is present.

**Risks:**

- `stand-screen.ts` is 1,393 lines, so the Records extraction must go first within the wave.
- Lazy-bundle boundaries.
- Test fixtures must be synthetic: no real panels, names or values.

**Streams:**

- **A (server):** `src/report.ts`, `src/domain/health/*`, the export and connected-brain routes, and
  their MCP modules.
- **B (Records UI):** `stand-screen.ts` (the only stream that edits it), `health-markers-*`, and the
  new `records-*` files.
- **C (packet UI):** `health-share-controller.ts` and the new `packet-*` / `visit-questions-*`
  files, mounted through a slot that B exposes.

---

## Wave 4: The race horizon, then the pebbles

**Timing:** if the athlete's race is close, run this wave before Wave 3.

**Outcome:**

- **A race view:** weeks to race, this week's km against the ladder, the taper, and race day. The
  finish estimate reads `fits` / `stretch` / `beyond horizon`, and is never a grade.
- **A pebble strip on Today:** six words, one per stone (Strength, Endurance, Fuel, Recovery, Body,
  Heart). Each word taps into its stone's existing surface. Recovery says "quiet" when there's
  nothing to read.

**Components:**

- `race-ladder`: weeks as rows, with the current week marked and km per week shown as bars against
  the ladder, with no score.
- `race-estimate`: fit words only.
- **The race view** as a section of Plan → Endurance (a `plan/race` route, or a view inside
  `endurance`). It replaces today's compact `.rbuild-more` card as the primary race surface.
- `pebble-strip`: six pebbles that fit at 360px, using reading-layer tones, a word under each
  pebble, and a settle entrance.

**Server:**

- `raceBuild()` (`src/repo/race-build.ts`) already exists and is only read here: never a second
  engine.
- `GET /api/today/stones`, plus an MCP mirror. It is a server-owned projection of the five signal
  dimensions (`src/repo/signal-state.ts`) and the domain reads onto six athlete-facing words, spoken
  through `spokenSignalVoice`. A dimension with no fresh signal reads "quiet". No score.

**Acceptance:**

- The ladder's weeks and km equal `raceBuild()`.
- The taper and race-week kinds are correct.
- Run volume is in km per week.
- The pebble strip never asks for a tap.
- Missing sleep reads "quiet", never "low".
- The renderer never works out a stone's word itself.

**Risks:**

- Mapping five dimensions onto six stones: this belongs on the server and must not creep into a
  renderer.
- Crowding Today: the strip is one line, and the Brief still leads.

**Streams:**

- **A (server):** the stones projection plus its route and MCP.
- **B (race view):** `plan-endurance-client.ts`, `plan-endurance-model.ts` and the new `race-*`
  files.
- **C (pebbles):** the new `pebble-strip-*` files plus one mount in `today-screen.ts`.

B and C share no files.

---

## Wave 5: You, the full cairn, and fewer tabs

**The athlete decides when this wave starts,** after living with waves 1–4.

**Outcome:**

- The full six-stone cairn lives in **You**, and the decade view appears inside Heart only.
- Navigation consolidates from eight tabs (`src/contracts/client-routes.ts`) toward **Today /
  Horizon / Ask / You**, with Session reached from Today. Every old link redirects.
- In **Ask**, what-if answers show their ripple across the stones, and "Do it" hands the change to
  the team.

**Components:**

- `cairn-stack` and `stone-detail`.
- **Horizon:** the race view, the goal line, and labs/scans on one timeline. A season zoom comes
  later.
- **Ask:** the chat surface plus a ripple card.
- The tab bar.

**Server:**

- `POST /api/what-if` as a `src/coachOps/*` op, plus an MCP mirror. It returns a proposed change and
  its ripple. "Do it" routes it through the autonomy policy as a draft, and it never applies itself.

**Acceptance:**

- A redirect table test covers every v1 `/app/<tab>/<section>` path.
- The tab bar has five items or fewer.
- A feature-parity checklist shows nothing lost.
- A what-if never mutates state on its own.

**Risks:**

- This is the largest change to navigation, and it breaks muscle memory.
- Lazy-bundle boundaries move.
- The router has many tests.

**Streams:**

- **A (shell):** `app/tabs.ts`, `app/router.ts`, `route-state.ts`, `client-routes.ts` and
  `index.html`. Only A touches the shell.
- **B:** You / `cairn-stack`.
- **C:** Horizon.
- **D:** the what-if server op and the Ask client.

---

## Wave 6: Polish, performance, motion, marketing, release

**Outcome:** a finished-feeling v2, and material to share it with.

**Motion pass:**

- *Change settles:* a value the team changed washes accent once, over `--dur-3`.
- Rows animate as they're added or removed.
- The pebble strip settles into place.
- The Undo toast.
- All remaining motion literals move to tokens.
- Everything is verified under reduced motion.

**Performance:**

- Set a byte budget per bundle and enforce it in `verify`.
- Every tab gets its first paint from SWR.
- Any new heavy surface goes into a lazy bundle.
- Measure on the test device.

**Accessibility audit** against the minimums in DESIGN.md.

**Marketing refresh:**

- Update `README.md`, `docs/WHY-CAIRN.md`, `docs/QUICKSTART.md` and `docs/SHARING.md` for v2.
- Record promo GIFs and video from the **demo seed only**, never a real database. Clips: the Brief,
  a team change with Undo, the editable meal card, Fuel ideas, Records grouping, the doctor packet,
  the race ladder and the pebble strip.

**Release prep:**

- Add an `ARCHITECTURE-HISTORY.md` entry.
- Bump the version to 2.0.0 and run `npm run release:check`.
- Write migration notes in `docs/OPERATIONS.md`.
- Delete this file.
- Merging `v2` into `main` is the athlete's call.

**Streams:**

- Motion: `styles.css` plus the `ui-*` modules.
- Performance: `scripts/`.
- Docs and marketing.
- Recordings, which run against the demo seed after the UI freeze.

---

## Side note: keeping a hosted option open

A hosted, subscription option is **out of scope for v2**. None of the v2 work should close that door:

- No new single-user assumptions in the client. The auth token path (`X-Cairn-Token`) stays the one
  place identity enters.
- Agent execution stays behind `runChosen` / `runAgentWithFallback`, so a hosted build could swap
  local CLIs for an API-backed runner.
- Nothing new hardcodes a filesystem path, a host or a timezone.

Anything more (tenancy, billing, managed agents) is its own design, written after v2 ships. A
research memo on the hosted option already exists, kept outside the repo. It is a side track, not a
wave, and nothing in it schedules work here.
