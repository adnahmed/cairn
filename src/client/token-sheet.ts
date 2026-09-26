// @ts-check
// The Atelier token sheet (replaces the native window.prompt gate). A designed,
// keyboard-perfect entry sheet for the optional shared token, in the warm-cream
// language of the app rather than an OS chrome prompt. It runs on the shared
// overlay primitive (CairnUiSheet); its styles live in styles.css beside the
// outbox review. api-core opens it when a request comes back 401.
type TokenSheetApi = { open(): void };
declare const CairnTokenSheet: TokenSheetApi;

{
  function openTokenSheet(): void {
    if (typeof document === "undefined" || typeof CairnUiSheet === "undefined") {
      // Non-DOM context, or a shell without the overlay primitive (should not happen
      // in the browser) — degrade to a reload so the app-shell guard has a chance to
      // run again once a token exists.
      try {
        location.reload();
      } catch {}
      return;
    }
    if (document.querySelector(".token-sheet-ov")) return;
    // The app is unusable without the token, so this sheet is deliberately not
    // dismissible: no Escape, no backdrop close. CairnUiSheet keeps Tab inside it.
    const sheet = CairnUiSheet.open({
      overlayClass: "token-sheet-ov",
      sheetClass: "token-sheet",
      labelledBy: "tokenSheetTitle",
      describedBy: "tokenSheetBody",
      dismissible: false,
      initialFocus: ".token-sheet-in",
      html: `<h2 class="token-sheet-h" id="tokenSheetTitle">Enter your access token</h2>
    <p class="token-sheet-p" id="tokenSheetBody">This Cairn is protected by a shared access token. Paste it to continue — it's stored only on this device.</p>
    <input class="token-sheet-in" type="password" inputmode="text" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" aria-label="Access token" placeholder="Access token">
    <div class="token-sheet-err" role="alert" aria-live="assertive" hidden></div>
    <div class="token-sheet-ft"><button class="token-sheet-btn" type="button" data-token-save>Connect</button></div>`,
    });

    const input = sheet.sheet.querySelector<HTMLInputElement>(".token-sheet-in");
    const errEl = sheet.sheet.querySelector<HTMLElement>(".token-sheet-err");
    const save = (): void => {
      const value = (input?.value || "").trim();
      if (!value) {
        if (errEl) {
          errEl.textContent = "Paste the token to continue.";
          errEl.hidden = false;
        }
        input?.focus();
        return;
      }
      try {
        localStorage.setItem("cairn_token", value);
      } catch {}
      location.reload();
    };
    sheet.sheet.querySelector("[data-token-save]")?.addEventListener("click", save);
    input?.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter") save();
    });
  }

  const CAIRN_TOKEN_SHEET: TokenSheetApi = { open: openTokenSheet };

  Object.assign(globalThis, { CairnTokenSheet: CAIRN_TOKEN_SHEET });
}
