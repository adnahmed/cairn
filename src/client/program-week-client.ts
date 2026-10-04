// @ts-check
// The Program look-ahead, the view: the frame the Program landing paints at once (a
// title, a quiet "Edit plan"), and the days that fill it — a row a day, today washed,
// each future day one tap from its read-only preview. Pure string builders over the
// model (program-week-model.ts); every caller string goes through escHtml/escAttr.
{
  type Row = ClientProgramWeekRow;
  type Group = ClientProgramWeekGroup;

  /**
   * The section frame, painted synchronously by the Program screen so its one action
   * ("Edit plan", the editor's own Train leaf) is wired with the rest of the landing.
   * `body` is what the slot opens with: a held paint, or the skeleton on a cold open.
   */
  function sectionHtml(body: string): string {
    return `<section class="pahead reveal" aria-labelledby="paheadTitle" data-pahead>
      <div class="pahead-head">
        <h2 class="pahead-title" id="paheadTitle">The week ahead</h2>
        <button class="linkbtn-quiet pahead-edit" type="button" data-train-leaf="plan">Edit plan</button>
      </div>
      <div class="pahead-body" data-pahead-body aria-live="polite">${body}</div>
    </section>`;
  }

  function skeletonHtml(): string {
    const rows = Array.from({ length: 5 }, () => `<div class="hshimmer pahead-skel-row"></div>`).join("");
    return `<div class="pahead-skel" aria-busy="true" aria-label="The week ahead"><div class="hshimmer pahead-skel-k"></div>${rows}</div>`;
  }

  function markerHtml(marker: Group["markers"][number]): string {
    const note = marker.note ? `<span class="pahead-mark-note">${escHtml(marker.note)}</span>` : "";
    return `<span class="pahead-mark is-${escAttr(marker.kind.replace(/[^a-z_]/g, ""))}">${escHtml(marker.word)}</span>${note}`;
  }

  function liftHtml(row: Row): string {
    if (row.line) {
      // Today's lift: the server's one line, verbatim, its caveat beneath.
      const line =
        typeof CairnUiReads !== "undefined" ? CairnUiReads.strengthLineHtml(row.line, { compact: true }) : "";
      const said = line || `<span class="pahead-lift-t">${escHtml(String(row.line.text || ""))}</span>`;
      const caveat = String(row.line.caveat || "").trim();
      const lifts = row.lift?.lifts ? `<span class="pahead-lifts">${escHtml(row.lift.lifts)}</span>` : "";
      return `<span class="pahead-item is-strength">${said}${caveat ? `<span class="pahead-caveat">${escHtml(caveat)}</span>` : ""}${lifts}</span>`;
    }
    if (!row.lift) return "";
    const tick = row.lift.done ? `<span class="pahead-tick" aria-label="done">✓</span>` : "";
    const lifts = row.lift.lifts ? `<span class="pahead-lifts">${escHtml(row.lift.lifts)}</span>` : "";
    return `<span class="pahead-item is-strength"><span class="pahead-lift-t">${escHtml(row.lift.title)}${tick}</span>${lifts}</span>`;
  }

  function runHtml(row: Row): string {
    if (!row.run) return "";
    const tick = row.run.done ? `<span class="pahead-tick" aria-label="done">✓</span>` : "";
    return `<span class="pahead-item is-endurance"><span class="pahead-run-t">${escHtml(row.run.text)}${tick}</span></span>`;
  }

  function rowHtml(row: Row): string {
    const body = row.rest
      ? `<span class="pahead-rest">Rest</span>`
      : `<span class="pahead-what">${liftHtml(row)}${runHtml(row)}</span>`;
    const hard = row.hard && !row.rest ? `<span class="pahead-hard">A harder day</span>` : "";
    const cls = `pahead-day${row.today ? " is-today" : ""}${row.rest ? " is-rest" : ""}${row.hard ? " is-hard" : ""}`;
    return `<li class="${cls}" data-open-day="${escAttr(row.date)}" role="link" tabindex="0"${row.today ? ` aria-current="date"` : ""}>
      <span class="pahead-when">${escHtml(row.weekday)}<b>${escHtml(row.day)}</b>${row.today ? `<span class="sr-only">, today</span>` : ""}</span>
      <span class="pahead-main">${body}${hard}</span>
      <span class="pahead-go" aria-hidden="true">›</span>
    </li>`;
  }

  function groupHtml(group: Group): string {
    const marks = group.markers.map(markerHtml).join("");
    return `<div class="pahead-group">
      <div class="pahead-group-head"><span class="pahead-group-k lbl">${escHtml(group.label)}</span>${marks}</div>
      <ol class="pahead-days" aria-label="${escAttr(group.label)}, day by day">${group.rows.map(rowHtml).join("")}</ol>
    </div>`;
  }

  const LIFT_DAYS_ASK = "The days I lift each week are: ";

  function orderHtml(view: ClientProgramWeekView): string {
    const rows = view.order
      .map(
        (lift, i) => `<li class="pahead-order-row">
        <span class="pahead-order-k lbl">${i === 0 ? "Next" : "Then"}</span>
        <span class="pahead-item is-strength"><span class="pahead-lift-t">${escHtml(lift.title)}</span>${
          lift.lifts ? `<span class="pahead-lifts">${escHtml(lift.lifts)}</span>` : ""
        }</span>
      </li>`
      )
      .join("");
    // The lifting weekdays have one setter, the conversation: the lede offers it, prefilled.
    return `<p class="pahead-lede">No lifting weekdays are set yet, so your lifting days simply come round in this order. <button class="linkbtn" type="button" data-pahead-ask="${escAttr(LIFT_DAYS_ASK)}">Tell the coach which days you lift</button></p>
      <ol class="pahead-order">${rows}</ol>`;
  }

  /** The body for a shaped read: the days, the order, or a calm line when there is nothing to show. */
  function bodyHtml(view: ClientProgramWeekView | null): string {
    if (!view) return `<p class="pahead-empty" role="status">The week ahead couldn't be read just now.</p>`;
    if (view.mode === "order") return orderHtml(view);
    if (view.mode !== "calendar") {
      return `<p class="pahead-empty">Nothing planned yet. <button class="linkbtn" type="button" data-pahead-edit>Build your plan</button> or <button class="linkbtn" type="button" data-pahead-ask>ask the coach to draft a week</button>.</p>`;
    }
    return view.groups.map(groupHtml).join("");
  }

  const CAIRN_PROGRAM_WEEK = { sectionHtml, skeletonHtml, bodyHtml };

  Object.assign(globalThis, { CairnProgramWeek: CAIRN_PROGRAM_WEEK });
}
