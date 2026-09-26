// @ts-check
// Starter chips for the empty Chat surface.

type ChatStarterChipsApi = {
  draw(log: Element): void;
};

function drawChatStarterChips(log: Element): void {
  const template = document.createElement("template");
  template.innerHTML = CairnChatClient.starterChipsHtml().trim();
  const wrap = template.content.firstElementChild;
  if (!wrap) return;
  // "What if…" opens the ripple card instead of sending: the team answers a
  // hypothetical with its ripple across the stones, and nothing changes unless the
  // athlete says "Do it".
  const count = wrap.querySelectorAll(".chat-chip").length;
  wrap.insertAdjacentHTML(
    "beforeend",
    `<button class="chat-chip chat-chip-whatif" type="button" data-chat-whatif style="--i:${count}">What if…</button>`,
  );
  log.appendChild(wrap);
  wrap.querySelector("[data-chat-whatif]")?.addEventListener("click", () => openChatWhatIf());
  wrap.querySelectorAll(".chat-chip:not([data-chat-whatif])").forEach((b) => b.addEventListener("click", () => {
    const input = $<HTMLTextAreaElement>("#chatInput");
    if (!input) return;
    input.value = b.textContent || "";
    const send = $("#chatSend");
    if (send) (send as HTMLElement).click();
  }));
}

const CAIRN_CHAT_STARTER_CHIPS: ChatStarterChipsApi = {
  draw: drawChatStarterChips,
};

Object.assign(globalThis, { CairnChatStarterChips: CAIRN_CHAT_STARTER_CHIPS });

if (typeof window !== "undefined") {
  Object.assign(window, { CairnChatStarterChips: CAIRN_CHAT_STARTER_CHIPS });
}
