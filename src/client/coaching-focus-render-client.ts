// @ts-check
// Lead, swap and retest markup for the "Where to focus" card. The variant table
// and the card assembler stay in coaching-focus-client; this is the pieces they
// call. Loaded before that file, in the same eager Today bundle.

// One-tap variation swaps for a stalled lift (same movement pattern): rotate the
// stalled lift out for a fresh stimulus. Up to two. Shared by the LEAD block and
// the parallel Alongside rows — on real data the plateau often rides alongside a
// recovery lead, and the tap must work wherever the lever renders. Callers gate
// on options.actions (only the Program view wires [data-cfocus-act]).
function cfocusSwapButtonsHtml(item: ClientCoachingFocusItem): string {
  if (item.domain !== "training" || !item.swap || !Array.isArray(item.swap.to)) return "";
  const from = item.swap.from || "";
  let html = "";
  for (const to of item.swap.to.slice(0, 2)) {
    if (!to) continue;
    html += `<button class="draftbtn cfocus-act" type="button" data-cfocus-act="swap" data-swap-from="${escAttr(from)}" data-swap-to="${escAttr(to)}">Rotate in ${escHtml(to)}</button>`;
  }
  return html;
}

function cfocusText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Say the block objective ONCE. The server headline is "<where you are>. This block:
// <lead title>[ — with X handled alongside]." and the variants that render a lead
// block (route/flat) print that same title again right under it, so the card read
// "…This block: Bring up your overhead press" over a TRAINING row saying "Bring up
// your overhead press". Where the lead block carries the title, the headline keeps
// only what the block does not say: the where-you-are line and the alongside tail.
// A clipped or reworded headline that does not contain the exact stem is untouched.
function cfocusHeadlineWithoutLead(headline: string, title: string): string {
  if (!headline || !title) return headline;
  const stem = `This block: ${title}`;
  const at = headline.indexOf(stem);
  if (at < 0) return headline;
  const before = headline.slice(0, at).trim();
  const tail = headline
    .slice(at + stem.length)
    .trim()
    .replace(/^[—–-]\s*/, "")
    .replace(/^\.$/, "")
    .trim();
  const after = tail ? tail.charAt(0).toUpperCase() + tail.slice(1) : "";
  return [before, after].filter(Boolean).join(" ");
}

// The navigable lead block (full/compact). A RUNNING recovery week is a
// confirmation, not a destination — it renders non-interactive (no route, no
// arrow); every other lead keeps its route.
function cfocusRouteLeadHtml(
  lead: ClientCoachingFocusItem,
  spec: CfocusVariantSpec,
  options: CoachingFocusRenderOptions,
  acts: boolean
): string {
  const confirm = lead.domain === "recovery" && lead.recovery_active === true;
  let html = confirm
    ? `<div class="${spec.leadWrap} cfocus-confirm">`
    : `<div class="${spec.leadWrap} cfocus-go" data-cfocus-go="${escAttr(lead.domain || "")}" role="link" tabindex="0">`;
  html += `<div class="cfocus-lead-top">${cfocusDomainTag(lead.domain)}<h3 class="${spec.leadTitleClass}">${escHtml(lead.title || "")}</h3>${confirm ? "" : `<span class="cfocus-go-arrow" aria-hidden="true">→</span>`}</div>`;
  if (lead.why) html += `<p class="${spec.leadWhyClass}">${escHtml(lead.why)}</p>`;
  if (spec.moveClass && lead.move)
    html += `<p class="${spec.moveClass}"><span class="lbl">Move</span>${escHtml(lead.move)}</p>`;
  // Action buttons render ONLY when options.actions — they are wired where the
  // card lives (Program); a navigate-only surface would render them dead. The
  // surrounding lead row still navigates (focusRouteTarget ignores [data-cfocus-act]).
  if (options.actions) {
    // A recovery lead is ACTIONABLE off lead mode: one tap drafts next week as a
    // recovery week (a reviewable proposal via the propose→apply loop — the same
    // durable /program/evolve job as "Evolve my plan"). Once the draft has landed
    // (draft_pending) — or under lead mode where the coach set it up itself — the
    // button gives way to a review LINK: state, not a repeatable ask. The link is
    // pure navigation via data-cfocus-go, so it renders in every posture.
    if (lead.domain === "recovery" && !lead.recovery_active && !lead.day_posture) {
      // recovery_active renders NOTHING — the week is running, the lead is a
      // confirmation, and re-offering the draft would be the same ask twice.
      // role="link" so the keydown navigator resolves the BUTTON's target
      // (plan-coach), not the surrounding lead row's.
      if (lead.draft_pending) {
        html += `<button class="draftbtn cfocus-review" type="button" role="link" data-cfocus-go="plan-coach">Review your recovery week →</button>`;
      } else if (acts) {
        html += `<button class="draftbtn cfocus-act" type="button" data-cfocus-act="recovery-week">Draft my recovery week</button>`;
      }
    }
    // Swap asks only where the athlete drives them (non-lead mode) — under lead the
    // coach rotates at the boundary itself, so the server also emits no swap payload.
    if (acts) html += cfocusSwapButtonsHtml(lead);
  }
  return `${html}</div>`;
}

// The flat lead (the Progress-overview well): no route chrome — its footer links.
function cfocusFlatLeadHtml(lead: ClientCoachingFocusItem, spec: CfocusVariantSpec, after = ""): string {
  const why = lead.why ? `<div class="${spec.leadWhyClass}">${escHtml(lead.why)}</div>` : "";
  const move = spec.moveClass && lead.move ? `<div class="${spec.moveClass}">${escHtml(lead.move)}</div>` : "";
  const body = why + move + after;
  const rest = spec.fold && body ? `<details class="tov-focus-fold"><summary class="tov-focus-fold-sum">Why, and the move</summary><div class="tov-focus-fold-body">${body}</div></details>` : body;
  return `<div class="${spec.leadTitleClass}">${escHtml(lead.title || "")}</div>${rest}`;
}

// The labs due in the check-in window, as their own phrase: never folded into the
// lift list, where a marker would read as one more lift. Names arrive in the
// marker's canonical display casing ("hs-CRP") and are printed as given.
function cfocusRetestLabsPhrase(labs: readonly string[]): string {
  if (!labs.length) return "";
  const scans = labs.filter((name) => /\bscan\b/i.test(name)).length;
  const head = scans === 0 ? "Labs" : scans === labs.length ? "Scans" : "Labs and scans";
  return `${head}: ${labs.join(", ")}`;
}

function cfocusRetestHtml(focus: ClientCoachingFocus, spec: CfocusVariantSpec): string {
  const retest = focus.retest;
  if (spec.retest === "never" || !retest) return "";
  // Lifts and labs are two lists in one window. A placeholder lift name drops
  // ("Re-test unknown" is not a sentence).
  const lifts = (Array.isArray(retest.focus) ? retest.focus : [])
    .map((name) => cfocusText(name))
    .filter((name) => name && name.toLowerCase() !== "unknown");
  const labs = (Array.isArray(retest.labs) ? retest.labs : []).map((name) => cfocusText(name)).filter(Boolean);
  if (!lifts.length && !labs.length) return "";
  const labsPhrase = cfocusRetestLabsPhrase(labs);
  if (spec.retest === "line") {
    // The compact one-liner only speaks when the timing is real: "in ~0 wk" is not
    // a sentence.
    const weeks = Number(retest.in_weeks);
    if (!Number.isFinite(weeks) || weeks < 1) return "";
    const wk = `~${Math.round(weeks)} wk`;
    const line = lifts.length
      ? `Re-test ${lifts.join(", ")} in ${wk}${labsPhrase ? `. ${labsPhrase}` : ""}`
      : `${labsPhrase}, in ${wk}`;
    return `<div class="tov-focus-retest">${escHtml(line)}</div>`;
  }
  const when =
    typeof retest.in_weeks === "number" && retest.in_weeks > 0
      ? `~${retest.in_weeks} week${retest.in_weeks === 1 ? "" : "s"}`
      : "due now";
  let html = `<div class="cfocus-retest cfocus-go" data-cfocus-go="program" role="link" tabindex="0"><span class="cfocus-retest-lbl lbl">Next check-in</span>`;
  const bodyText = lifts.length ? lifts.join(" · ") : labsPhrase;
  html += `<span class="cfocus-retest-body">${escHtml(bodyText)} <span class="cfocus-retest-when">${escHtml(when)}</span></span>`;
  if (lifts.length && labsPhrase) html += `<span class="cfocus-retest-labs">${escHtml(labsPhrase)}</span>`;
  if (retest.why) html += `<span class="cfocus-retest-why">${escHtml(retest.why)}</span>`;
  return `${html}</div>`;
}

const CAIRN_COACHING_FOCUS_RENDER = {
  cfocusSwapButtonsHtml,
  cfocusText,
  cfocusHeadlineWithoutLead,
  cfocusRouteLeadHtml,
  cfocusFlatLeadHtml,
  cfocusRetestHtml,
};

Object.assign(globalThis, {
  CairnCoachingFocusRender: CAIRN_COACHING_FOCUS_RENDER,
  cfocusSwapButtonsHtml,
  cfocusText,
  cfocusHeadlineWithoutLead,
  cfocusRouteLeadHtml,
  cfocusFlatLeadHtml,
  cfocusRetestHtml,
});
