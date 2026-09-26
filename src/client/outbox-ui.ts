// @ts-check
// The outbox's two faces: the "N to sync" bar and the review sheet for logs Cairn
// refused. The bar is a calm pill while a drain is pending or running and turns
// into a review action once something needs attention; the review (on the shared
// CairnUiSheet primitive) retries or discards one saved item at a time. It reads
// the live queue and acts through CairnOutbox; outbox.ts decides when to paint.
type OutboxUiApi = {
  renderBar(state: { flushing: boolean }): void;
  openReview(): void;
  closeReview(): void;
  itemSummary(item: OutboxItem): string;
};
declare const CairnOutboxUi: OutboxUiApi;

{
  const { queue: outbox } = CairnOutboxRuntime;

  function boundedOutboxText(value: unknown, max = 140): string {
    const text = String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();
    return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
  }

  function outboxKindLabel(kind: unknown): string {
    switch (String(kind || "").toLowerCase()) {
      case "activity":
        return "Activity";
      case "food":
        return "Food";
      case "weight":
        return "Weight";
      case "set":
        return "Training set";
      case "finish":
        return "Session finish";
      case "skip":
        return "Exercise skip";
      case "restore":
        return "Exercise restore";
      case "symptom_observation":
        return "Movement check";
      case "daily_session_prepare":
        return "Session setup";
      default:
        return "Saved log";
    }
  }

  function outboxItemSummary(item: OutboxItem): string {
    const body = item.body && typeof item.body === "object" ? (item.body as Record<string, unknown>) : {};
    if (item.kind === "weight" && Number.isFinite(Number(body.weight_lb))) {
      return `${Number(body.weight_lb)} lb`;
    }
    if (item.kind === "food") {
      const meal = boundedOutboxText(body.meal, 24);
      const text = boundedOutboxText(body.text);
      return boundedOutboxText([meal, text].filter(Boolean).join(" · ")) || "Saved food log";
    }
    if (item.kind === "activity") return boundedOutboxText(body.text) || "Saved activity log";
    if (item.kind === "set") {
      const exercise = boundedOutboxText(body.exercise, 64);
      const duration = Number(body.duration_sec);
      if (Number.isFinite(duration) && duration > 0)
        return boundedOutboxText(`${exercise || "Timed set"} · ${duration}s`);
      const weight = Number(body.weight);
      const reps = Number(body.reps);
      const detail = [Number.isFinite(weight) ? `${weight} lb` : "", Number.isFinite(reps) ? `${reps} reps` : ""]
        .filter(Boolean)
        .join(" × ");
      return boundedOutboxText([exercise, detail].filter(Boolean).join(" · ")) || "Saved training set";
    }
    if (item.kind === "finish") {
      const notes = boundedOutboxText(body.notes, 110);
      return notes ? `Finish session · ${notes}` : "Finish session";
    }
    if (item.kind === "daily_session_prepare") {
      const date = boundedOutboxText(body.date, 20);
      return date ? `Prepare workout · ${date}` : "Prepare workout";
    }
    if (item.kind === "skip" || item.kind === "restore") {
      const exercise = boundedOutboxText(body.exercise, 80);
      return `${item.kind === "restore" ? "Restore" : "Skip"}${exercise ? ` · ${exercise}` : " exercise"}`;
    }
    if (item.kind === "symptom_observation") {
      const movement = boundedOutboxText(body.movement, 80);
      const area = boundedOutboxText(body.area_text, 80);
      const outcome = body.outcome === "pain_free" ? "Pain-free today" : "Pain present";
      return boundedOutboxText([outcome, movement, area].filter(Boolean).join(" · ")) || "Saved movement check";
    }
    return "Saved log";
  }

  function outboxItemTime(item: OutboxItem): string {
    const date = new Date(Number(item.ts));
    if (!Number.isFinite(date.getTime())) return "Time unavailable";
    try {
      return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
    } catch {
      return date.toLocaleString();
    }
  }

  let outboxReviewSheet: ClientUiSheetHandle | null = null;

  function closeOutboxReview(): void {
    const open = outboxReviewSheet;
    outboxReviewSheet = null;
    open?.close();
  }

  function focusOutboxReviewControl(sheet: HTMLElement): void {
    const control =
      sheet.querySelector<HTMLElement>("[data-outbox-retry]") ||
      sheet.querySelector<HTMLElement>("[data-outbox-close]");
    try {
      control?.focus();
    } catch {}
  }

  function renderOutboxReview(options: { focusControl?: boolean } = {}): void {
    const sheet = outboxReviewSheet?.isOpen() ? outboxReviewSheet.sheet : null;
    if (!sheet) return;
    const review = outbox().review();
    if (!review.length) {
      closeOutboxReview();
      return;
    }
    const rows = review
      .map(({ item, role }) => {
        const hasDependents = item.kind === "daily_session_prepare" && outbox().hasDependents(item.id);
        const isPrepare = item.kind === "daily_session_prepare";
        const isBlocked = role === "blocked_dependent";
        const blockedByMember =
          isBlocked &&
          !!item.group_id &&
          outbox()
            .list()
            .some((candidate) => candidate.state === "needs_attention" && candidate.group_id === item.group_id);
        const status = isBlocked
          ? blockedByMember
            ? "Blocked behind an earlier workout change that needs attention. You can discard this log individually."
            : "Blocked until the saved session setup is resolved. You can discard this log individually."
          : isPrepare && hasDependents
            ? "Use saved session will replace a conflicting unstarted session. A session with started work stays locked."
            : item.failure_status != null
              ? `Cairn couldn't accept this log (${item.failure_status}).`
              : "Cairn couldn't accept this log.";
        return `<li class="outbox-review-item" data-outbox-id="${escHtml(item.id)}">
      <div class="outbox-review-copy">
        <div class="outbox-review-meta"><strong>${escHtml(outboxKindLabel(item.kind))}</strong><time>${escHtml(outboxItemTime(item))}</time></div>
        <p>${escHtml(outboxItemSummary(item))}</p>
        <small>${escHtml(status)}</small>
      </div>
      <div class="outbox-review-actions">
        ${isBlocked ? "" : `<button type="button" data-outbox-retry>${isPrepare ? "Use saved session" : "Retry"}</button>`}
        <button type="button" class="outbox-discard" data-outbox-discard${hasDependents ? ' disabled aria-disabled="true"' : ""}>Discard</button>
      </div>
    </li>`;
      })
      .join("");
    sheet.innerHTML = `<div class="outbox-review-head">
      <div><p class="eyebrow">Saved on this device</p><h2 id="outboxReviewTitle">Logs that need attention</h2></div>
      <button type="button" class="outbox-review-close" data-outbox-close aria-label="Close log review">×</button>
    </div>
    <p class="outbox-review-intro" id="outboxReviewIntro">Resolve the earliest saved workout item, or discard blocked changes one at a time. A session setup can be discarded only after every dependent log is gone.</p>
    <ul class="outbox-review-list">${rows}</ul>`;
    if (options.focusControl) focusOutboxReviewControl(sheet);
  }

  function openOutboxReview(): void {
    if (typeof document === "undefined") return;
    if (
      !outbox()
        .list()
        .some((item) => item.state === "needs_attention")
    )
      return;
    if (outboxReviewSheet?.isOpen()) {
      outboxReviewSheet.sheet.querySelector<HTMLElement>("[data-outbox-close]")?.focus();
      return;
    }
    const opened = CairnUiSheet.open({
      overlayClass: "outbox-review-ov",
      sheetClass: "outbox-review",
      sheetTag: "section",
      labelledBy: "outboxReviewTitle",
      describedBy: "outboxReviewIntro",
      closeSelector: "[data-outbox-close]",
      initialFocus: "[data-outbox-close]",
      html: "",
      onClose: () => {
        if (outboxReviewSheet === opened) outboxReviewSheet = null;
      },
    });
    outboxReviewSheet = opened;
    opened.sheet.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const row = target.closest<HTMLElement>("[data-outbox-id]");
      const id = row?.dataset.outboxId;
      if (!id) return;
      if (target.closest("[data-outbox-discard]")) {
        void CairnOutbox.discard(id).then((discarded) => {
          if (!discarded) {
            try {
              toast("Discard each saved workout log before discarding the session setup");
            } catch {}
          }
          renderOutboxReview({ focusControl: true });
        });
        return;
      }
      const retry = target.closest<HTMLButtonElement>("[data-outbox-retry]");
      if (retry) {
        retry.disabled = true;
        retry.textContent = "Retrying…";
        void CairnOutbox.retry(id).finally(() => renderOutboxReview({ focusControl: true }));
      }
    });
    renderOutboxReview();
  }

  function renderOutboxBar(state: { flushing: boolean }): void {
    if (typeof document === "undefined") return;
    const pending = outbox().count();
    const attention = outbox()
      .list()
      .filter((item) => item.state === "needs_attention").length;
    const reviewCount = outbox().review().length;
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    let bar = document.querySelector<HTMLElement>(".outbox-bar");
    // While offline the warm `.offline-bar` already promises the logs are saved and
    // will retry — don't stack a second band under it. Surface the count only when
    // we're online (actively retrying, or holding until the drain lands).
    if (pending === 0 || offline) {
      if (bar) {
        bar.classList.remove("show");
        bar.classList.remove("outbox-actionable");
        bar.setAttribute("disabled", "");
        bar.setAttribute("role", "status");
        bar.removeAttribute("aria-label");
      }
      return;
    }
    if (!bar) {
      bar = document.createElement("button");
      bar.className = "outbox-bar";
      bar.setAttribute("type", "button");
      bar.setAttribute("role", "status");
      bar.setAttribute("aria-live", "polite");
      bar.addEventListener("click", openOutboxReview);
      document.body.appendChild(bar);
    }
    const label = attention ? "Needs attention" : state.flushing ? "Syncing" : "Waiting to sync";
    const displayCount = attention ? reviewCount : pending;
    const noun = attention ? "saved item" : "log";
    bar.innerHTML = `<span class="outbox-dot" aria-hidden="true"></span><span>${label} · ${displayCount} ${noun}${displayCount === 1 ? "" : "s"}</span>`;
    bar.classList.toggle("outbox-actionable", attention > 0);
    if (attention > 0) {
      bar.removeAttribute("role");
      bar.removeAttribute("disabled");
      bar.setAttribute(
        "aria-label",
        `${reviewCount} saved item${reviewCount === 1 ? "" : "s"} need attention. Review saved items.`
      );
    } else {
      bar.setAttribute("role", "status");
      bar.setAttribute("disabled", "");
      bar.removeAttribute("aria-label");
    }
    const shown = bar;
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => shown.classList.add("show"));
    else shown.classList.add("show");
  }

  const CAIRN_OUTBOX_UI: OutboxUiApi = {
    renderBar: renderOutboxBar,
    openReview: openOutboxReview,
    closeReview: closeOutboxReview,
    itemSummary: outboxItemSummary,
  };

  Object.assign(globalThis, { CairnOutboxUi: CAIRN_OUTBOX_UI });
}
