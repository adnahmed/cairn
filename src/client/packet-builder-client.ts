// @ts-check
// packet-builder, the view (docs/V2-PLAN.md wave 3). Pure renderers for the doctor
// packet builder: the card shell, one Include / Leave out toggle per section (the F3
// segmented primitive, `CairnUi.segmentedHtml`), the live preview, and its
// loading / error / empty states. The informational, not-medical-advice line lives in
// the shell, outside the preview, so it shows in every state. The shell exposes one
// sub-slot, `[data-packet-questions-slot]`, that the composer fills with the
// visit-questions component; this view never renders that component's markup.
{
  type Preview = ClientPacketPreview;
  type Row = ClientPacketPreviewRow;
  type Section = ClientPacketPreviewSection;

  /** The informational line; it rides every state, the empty one included. */
  function disclaimerHtml(text?: string): string {
    const line = text || CairnPacketBuilderModel.DISCLAIMER;
    return `<p class="packet-disclaimer" role="note" data-packet-disclaimer>${escHtml(line)}</p>`;
  }

  function shellHtml(opts: { disclaimer?: string } = {}): string {
    return `<section class="hshare-card packet" aria-label="Doctor packet">
    <div class="packet-head">
      <div class="lbl hshare-kicker">For your doctor</div>
      <h2 class="hshare-title">Doctor packet</h2>
      <p class="hshare-copy">Choose what goes in. The preview is what your doctor sees, in clinical panel order with the lab's own flags.</p>
    </div>
    <div class="packet-toggles" data-packet-toggles>${togglesSkeletonHtml()}</div>
    <div class="packet-questions" data-packet-questions-slot></div>
    <div class="packet-preview-wrap">
      <div class="packet-preview-head"><span class="lbl">Preview</span><span class="packet-status" role="status" aria-live="polite" data-packet-status></span></div>
      <div class="packet-preview" data-packet-preview>${previewSkeletonHtml()}</div>
    </div>
    <div class="packet-actions">
      <button type="button" class="logbtn packet-act" data-packet-open>Open the packet</button>
      <button type="button" class="ghostbtn packet-act" data-packet-text>Download as text</button>
    </div>
    ${disclaimerHtml(opts.disclaimer)}
  </section>`;
  }

  function togglesSkeletonHtml(): string {
    return `<div class="skel-card packet-skel" aria-hidden="true"><div class="hshimmer"></div><div class="hshimmer"></div><div class="hshimmer hshimmer-sm"></div></div>`;
  }

  /** One row per section: its label and an Include / Leave out segmented toggle. */
  function togglesHtml(options: readonly ClientPacketSectionOption[], selected: readonly string[]): string {
    const on = new Set(selected);
    const rows = options
      .map((o) => {
        const seg = CairnUi.segmentedHtml({
          items: [
            ["on", "Include"],
            ["off", "Leave out"],
          ],
          active: on.has(o.id) ? "on" : "off",
          label: o.label,
          variant: "plain",
          pressed: true,
          attr: "packet-section",
          className: "packet-seg",
          attrs: { "data-packet-sec": o.id },
        });
        return `<li class="packet-toggle"><span class="packet-toggle-label">${escHtml(o.label)}</span>${seg}</li>`;
      })
      .join("");
    return `<ul class="packet-toggle-list" aria-label="What the packet includes">${rows}</ul>`;
  }

  function previewSkeletonHtml(): string {
    return `<div class="skel-card packet-skel" aria-hidden="true"><div class="hshimmer hshimmer-lg"></div><div class="hshimmer"></div><div class="hshimmer"></div><div class="hshimmer hshimmer-sm"></div></div>`;
  }

  /**
   * The lab's flag or the optimal phrase, as the packet itself prints them: a lab flag
   * stands alone (the packet drops the optimal note beside it), and "Outside optimal"
   * shows only for a marker the lab did not flag. Two marks, never one word.
   */
  function marksHtml(row: Row): string {
    const flag = row.flag
      ? `<span class="packet-flag" title="Flagged by the lab">Lab: ${row.flag === "high" ? "high" : "low"}</span>`
      : "";
    const opt = !row.flag && row.outsideOptimal ? `<span class="packet-opt">Outside optimal</span>` : "";
    return flag || opt ? `<span class="packet-marks">${flag}${opt}</span>` : "";
  }

  function rowHtml(row: Row): string {
    const meta = [row.detail, row.date ? absDate(row.date) : ""].filter(Boolean).join(" · ");
    return `<li class="packet-row"><span class="packet-row-title">${escHtml(row.title)}</span>${marksHtml(row)}${
      meta ? `<span class="packet-row-meta">${escHtml(meta)}</span>` : ""
    }</li>`;
  }

  function sectionHtml(section: Section): string {
    const tag = section.ordered ? "ol" : "ul";
    const body = section.empty
      ? `<p class="packet-empty-line">${escHtml(section.empty)}</p>`
      : `<${tag} class="packet-rows">${section.rows.map(rowHtml).join("")}</${tag}>${
          section.more ? `<p class="packet-more">and ${section.more} more</p>` : ""
        }`;
    return `<section class="packet-pv-sec" data-packet-pv="${escAttr(section.id)}"><h3 class="packet-pv-title">${escHtml(section.label)}</h3>${body}</section>`;
  }

  /** `enter` gives the first paint its one settle; a repaint after a toggle swaps quietly. */
  function previewHtml(preview: Preview, opts: { enter?: boolean } = {}): string {
    const bits = [
      preview.generated ? `Prepared ${absDate(preview.generated)}` : "",
      preview.range ? `readings ${absDate(preview.range.from)} to ${absDate(preview.range.to)}` : "",
    ].filter(Boolean);
    const head = bits.length ? `<p class="packet-pv-head">${escHtml(bits.join(" · "))}</p>` : "";
    const body = preview.sections.length
      ? preview.sections.map(sectionHtml).join("")
      : `<p class="packet-empty-line">Every section is left out. The packet will carry the header and the note below.</p>`;
    return `<article class="packet-paper${opts.enter ? " settle-in" : ""}">${head}${body}</article>`;
  }

  function previewErrorHtml(): string {
    return `<div class="packet-error"><p class="packet-empty-line">Couldn't build the preview just now.</p><button type="button" class="linkbtn linkbtn-plain packet-retry" data-packet-retry>Try again</button></div>`;
  }

  function emptyHtml(opts: { disclaimer?: string } = {}): string {
    return `${CairnUi.emptyStateHtml({
      title: "Nothing to share yet",
      body: "Add a lab report or DEXA scan first. The packet stays grouped by clinical panel once markers exist.",
      action: {
        label: "Add a document",
        className: "logbtn hpic-cta-btn packet-act",
        attrs: { "data-packet-add": "" },
      },
      className: "empty-state reveal packet-empty",
    })}${disclaimerHtml(opts.disclaimer)}`;
  }

  /** The status line after a paint: how many sections are going in. */
  function statusText(preview: Preview): string {
    const n = preview.sections.length;
    return n ? `${n} section${n === 1 ? "" : "s"} in the packet` : "Header only";
  }

  const CAIRN_PACKET_BUILDER = {
    shellHtml,
    togglesHtml,
    togglesSkeletonHtml,
    previewHtml,
    previewSkeletonHtml,
    previewErrorHtml,
    emptyHtml,
    statusText,
  };

  Object.assign(globalThis, { CairnPacketBuilder: CAIRN_PACKET_BUILDER });
}
