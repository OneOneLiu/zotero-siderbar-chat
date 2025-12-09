import MarkdownIt from "markdown-it";
// @ts-ignore
import tm from "markdown-it-texmath";
import katex from "katex";
import { config } from "../../package.json";
import Addon, { ChatMessage } from "../addon";
import { buildEndpoint, getSettings } from "./settings";
import { getLocaleID } from "../utils/locale";

Zotero.debug("[GeminiChat] Loading readerPane module...");

let md: any = null;

function getMarkdown() {
  if (!md) {
    try {
      Zotero.debug("[GeminiChat] Initializing MarkdownIt...");
      md = new MarkdownIt({
        html: true,
        linkify: true,
        typographer: true,
      });
      Zotero.debug("[GeminiChat] Initializing TexMath...");
      md.use(tm, {
        engine: katex,
        delimiters: "dollars",
        katexOptions: {
          macros: { "\\RR": "\\mathbb{R}" },
          output: "html", // Prevent MathML/HTML duplication
          throwOnError: false
        },
      });
      Zotero.debug("[GeminiChat] MarkdownIt initialized success.");
    } catch (e) {
      Zotero.debug(`[GeminiChat] Failed to init Markdown: ${e}`);
      md = {
        render: (text: string) => text,
      };
    }
  }
  return md;
}

type RenderOptions = {
  body: HTMLElement;
  item: Zotero.Item;
};

export function registerReaderPane(addon: Addon): string {
  const paneKey =
    Zotero.ItemPaneManager.registerSection({
      paneID: "gemini-chat",
      pluginID: config.addonID,
      header: {
        l10nID: getLocaleID("section-header"),
        icon: `chrome://${config.addonRef}/content/icons/gemini.svg`,
      },
      sidenav: {
        l10nID: getLocaleID("section-sidenav"),
        icon: `chrome://${config.addonRef}/content/icons/gemini.svg`,
        // @ts-ignore - orderable exists on ItemPaneManager sections
        orderable: false,
      },
      bodyXHTML: `<div class="gemini-chat-body"></div>`,
      onRender: ({ body, item }: RenderOptions) => {
        renderChat(body, item, addon);
      },
      onItemChange: ({ tabType, body, item, setEnabled }) => {
        const enabled = tabType === "reader";
        setEnabled(enabled);
        if (enabled) {
          renderChat(body, item, addon);
        } else {
          body.innerHTML = "";
        }
        return true;
      },
    }) || "";

  return paneKey;
}

export function registerSidebarButton(getPaneKey: () => string) {
  Zotero.Reader.registerEventListener(
    "renderSidebarAnnotationHeader",
    (event) => {
      const { doc, append } = event;
      if (doc.getElementById("gemini-chat-sidebar-button")) return;

      const btn = doc.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "button",
      );
      btn.id = "gemini-chat-sidebar-button";
      btn.className = "gemini-chat-jump";
      btn.textContent = "Gemini";
      btn.setAttribute("data-l10n-id", getLocaleID("sidebar-button"));

      btn.title = "Open Gemini chat pane";
      btn.style.cssText =
        "border:1px solid transparent;border-radius:4px;padding:2px 6px;cursor:pointer;background:var(--color-field-bg, #ececec);";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const paneKey = getPaneKey();
        if (!paneKey) {
          return;
        }
        const details = doc.querySelector("item-details") as any;
        if (details?.scrollToPane) {
          details.scrollToPane(paneKey);
        }
      });
      append(btn);
    },
    config.addonID,
  );
}

function renderChat(body: HTMLElement, item: Zotero.Item, addon: Addon) {
  Zotero.debug(`[GeminiChat] renderChat called for item ${item?.id}`);

  // Ensure markdown is initialized immediately to catch errors early
  // getMarkdown();

  try {
    const itemKey = item?.id ? String(item.id) : "global";
    const messages = addon.getSession(itemKey);
    const doc = body.ownerDocument;

    try {
      if (!doc.getElementById("katex-css")) {
        Zotero.debug("[GeminiChat] Injecting katex CSS...");
        const link = doc.createElement("link");
        link.id = "katex-css";
        link.rel = "stylesheet";
        link.href = `chrome://${config.addonRef}/content/style/katex.min.css`;
        doc.head.appendChild(link);
      }
    } catch (e) {
      Zotero.debug(`[GeminiChat] Failed to inject CSS: ${e}`);
    }

    body.innerHTML = "";

    const wrapper = doc.createElement("div");
    wrapper.className = "gemini-chat-wrapper";
    wrapper.style.display = "flex";
    wrapper.style.flexDirection = "column";
    wrapper.style.gap = "8px";
    wrapper.style.padding = "8px";
    wrapper.style.boxSizing = "border-box";
    wrapper.style.height = "100%";
    wrapper.style.userSelect = "text";
    wrapper.style.cursor = "auto";
    // @ts-ignore
    wrapper.style.MozUserSelect = "text";

    const header = doc.createElement("div");
    header.style.display = "flex";
    header.style.flexDirection = "column";
    header.style.gap = "4px";

    const titleRow = doc.createElement("div");
    titleRow.style.display = "flex";
    titleRow.style.justifyContent = "space-between";
    titleRow.style.alignItems = "center";

    const title = doc.createElement("div");
    title.textContent = "Gemini Chat";
    title.style.fontWeight = "bold";
    title.style.fontSize = "13px";

    const saveAllBtn = doc.createElement("button");
    saveAllBtn.textContent = "💾";
    saveAllBtn.title = "Save full chat to note";
    saveAllBtn.style.background = "none";
    saveAllBtn.style.border = "none";
    saveAllBtn.style.cursor = "pointer";
    saveAllBtn.style.fontSize = "14px";
    saveAllBtn.style.padding = "0 4px";

    saveAllBtn.onclick = async () => {
      saveAllBtn.textContent = "...";
      await saveFullSessionToNote(item, messages);
      saveAllBtn.textContent = "✔";
      setTimeout(() => (saveAllBtn.textContent = "💾"), 2000);
    };

    titleRow.appendChild(title);
    titleRow.appendChild(saveAllBtn);
    header.appendChild(titleRow);

    const subtitle = doc.createElement("div");
    subtitle.style.fontSize = "11px";
    subtitle.style.color = "var(--color-secondary-label, #555)";
    subtitle.textContent = item?.getField?.("title")
      ? `Current: ${item.getField("title")}`
      : "Select a PDF tab to chat";
    header.appendChild(subtitle);

    // Custom Prompts Section
    const settings = getSettings();
    let prompts: Array<{ name: string, prompt: string }> = [];
    try {
      prompts = JSON.parse(settings.customPrompts);
    } catch (e) {
      Zotero.debug(`[GeminiChat] Failed to parse custom prompts: ${e}`);
    }

    if (prompts.length > 0 && Array.isArray(prompts)) {
      const promptBar = doc.createElement("div");
      promptBar.style.display = "flex";
      promptBar.style.gap = "6px";
      promptBar.style.overflowX = "auto";
      promptBar.style.padding = "4px 0";
      promptBar.style.marginBottom = "4px";

      // Hide scrollbar but keep functionality
      promptBar.style.scrollbarWidth = "none";

      prompts.forEach(p => {
        if (!p.name || !p.prompt) return;
        const chip = doc.createElement("button");
        chip.textContent = p.name;
        chip.title = p.prompt;
        chip.style.whiteSpace = "nowrap";
        chip.style.padding = "2px 8px";
        chip.style.fontSize = "11px";
        chip.style.border = "1px solid var(--color-border, #ccc)";
        chip.style.borderRadius = "12px";
        chip.style.background = "var(--color-field-bg, #fff)";
        chip.style.cursor = "pointer";

        chip.addEventListener("click", () => {
          handleSend(p.prompt);
        });

        promptBar.appendChild(chip);
      });

      if (promptBar.children.length > 0) {
        header.appendChild(promptBar);
      }
    }

    const messageList = doc.createElement("div");
    messageList.className = "gemini-chat-messages";
    messageList.style.display = "flex";
    messageList.style.flexDirection = "column";
    messageList.style.gap = "6px";
    messageList.style.flex = "1";
    messageList.style.overflow = "auto";
    messageList.style.padding = "6px";
    messageList.style.border = "1px solid var(--color-border, #ccc)";
    messageList.style.borderRadius = "6px";
    messageList.style.background = "var(--color-field-bg, #f8f8f8)";

    const input = doc.createElement("textarea");
    input.placeholder = "Ask Gemini about this paper...";
    input.rows = 3;
    input.style.resize = "vertical";
    input.style.width = "100%";
    input.style.boxSizing = "border-box";
    input.style.borderRadius = "6px";
    input.style.padding = "6px";

    const actions = doc.createElement("div");
    actions.style.display = "flex";
    actions.style.justifyContent = "space-between";
    actions.style.alignItems = "center";

    const hint = doc.createElement("span");
    hint.style.fontSize = "11px";
    hint.style.color = "var(--color-secondary-label, #555)";
    hint.textContent = "Enter sends.";

    const sendBtn = doc.createElement("button");
    sendBtn.textContent = "Send";
    sendBtn.style.padding = "6px 12px";
    sendBtn.style.borderRadius = "6px";
    sendBtn.style.cursor = "pointer";

    actions.appendChild(hint);
    actions.appendChild(sendBtn);

    wrapper.appendChild(header);
    wrapper.appendChild(messageList);
    wrapper.appendChild(input);
    wrapper.appendChild(actions);
    body.appendChild(wrapper);

    const renderMessages = () => {
      messageList.innerHTML = "";
      messages.forEach((m, index) => {
        const bubble = doc.createElement("div");
        bubble.style.padding = "6px";
        bubble.style.borderRadius = "6px";
        bubble.style.position = "relative";
        // bubble.style.whiteSpace = "pre-wrap";
        bubble.style.background =
          m.role === "user" ? "#e8f0fe" : m.role === "model" ? "#f1f5f9" : "#fff3cd";
        bubble.style.border = "1px solid var(--color-border, #dcdcdc)";
        bubble.style.userSelect = "text";
        // @ts-ignore
        bubble.style.MozUserSelect = "text";

        if (m.role === "user") {
          const saveBtn = doc.createElement("button");
          saveBtn.textContent = "+";
          saveBtn.title = "Add to Note";
          saveBtn.className = "save-note-btn";
          saveBtn.style.position = "absolute";
          saveBtn.style.top = "-8px";
          saveBtn.style.left = "-8px";
          saveBtn.style.width = "20px";
          saveBtn.style.height = "20px";
          saveBtn.style.background = "white";
          saveBtn.style.border = "1px solid #ccc";
          saveBtn.style.borderRadius = "50%";
          saveBtn.style.cursor = "pointer";
          saveBtn.style.fontSize = "14px";
          saveBtn.style.display = "flex";
          saveBtn.style.alignItems = "center";
          saveBtn.style.justifyContent = "center";
          saveBtn.style.color = "#555";
          saveBtn.style.zIndex = "10";
          // saveBtn.style.opacity = "0";
          // saveBtn.style.transition = "opacity 0.2s";

          saveBtn.onclick = async (e) => {
            e.stopPropagation();
            const nextMsg = messages[index + 1];
            const answer = nextMsg?.role === "model" ? nextMsg.text : "";
            saveBtn.textContent = "...";
            await saveToNote(item, m.text, answer);
            saveBtn.textContent = "✔";
            setTimeout(() => (saveBtn.textContent = "+"), 2000);
          };

          bubble.appendChild(saveBtn);

          // bubble.addEventListener("mouseenter", () => { saveBtn.style.opacity = "1"; });
          // bubble.addEventListener("mouseleave", () => { saveBtn.style.opacity = "0"; });
        }

        try {
          // Create a content wrapper to avoid overwriting the button
          const content = doc.createElement("div");
          content.innerHTML = getMarkdown().render(m.text);
          bubble.appendChild(content);
        } catch (e) {
          const content = doc.createElement("div");
          content.textContent = m.text;
          content.style.whiteSpace = "pre-wrap";
          bubble.appendChild(content);
        }
        messageList.appendChild(bubble);
      });
      messageList.scrollTop = messageList.scrollHeight;
    };

    renderMessages();

    const setBusy = (busy: boolean) => {
      addon.setBusy(itemKey, busy);
      sendBtn.disabled = busy;
      input.disabled = busy;
      sendBtn.textContent = busy ? "Asking..." : "Send";
    };

    const handleSend = async (overrideText?: string) => {
      const text = (typeof overrideText === "string" ? overrideText : input.value).trim();
      if (!text || addon.isBusy(itemKey)) return;
      addon.pushMessage(itemKey, {
        role: "user",
        text,
        at: Date.now(),
      });
      if (!overrideText) {
        input.value = "";
      }
      renderMessages();

      const settings = getSettings();
      if (!settings.apiKey) {
        addon.pushMessage(itemKey, {
          role: "system",
          text: "Missing API key. Set it in Preferences -> Gemini Chat.",
          at: Date.now(),
        });
        renderMessages();
        return;
      }

      setBusy(true);
      try {
        const history = addon.getSession(itemKey);
        const pdfPart = await getPdfContextPart(item);

        // Build full conversation history
        const contents = history.map((msg, index) => {
          const parts: any[] = [{ text: msg.text }];

          // Inject context into the VERY FIRST message (if it's from user)
          if (index === 0 && msg.role === "user") {
            // Add PDF data
            if (pdfPart) {
              parts.unshift({ inlineData: pdfPart });
            }
            // Add Title context
            if (item?.getField) {
              const title = item.getField("title") || "";
              // Prepend title to the text part
              parts[parts.length - 1].text = `Paper title: ${title}\n\n${parts[parts.length - 1].text}`;
            }
          }

          return {
            role: msg.role,
            parts: parts
          };
        });

        const reply = await callGemini(settings, contents);
        addon.pushMessage(itemKey, {
          role: "model",
          text: reply,
          at: Date.now(),
        });
      } catch (e: any) {
        addon.pushMessage(itemKey, {
          role: "system",
          text: `Gemini error: ${e?.message || e}`,
          at: Date.now(),
        });
      } finally {
        setBusy(false);
        renderMessages();
      }
    };

    sendBtn.addEventListener("click", () => handleSend());
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey) {
        ev.preventDefault();
        handleSend();
      } else if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
        // allow newline
      }
    });
  } catch (error) {
    Zotero.debug(`[GeminiChat] Render error: ${error}`);
    body.textContent = "Error rendering chat pane. See debug logs.";
  }
}

// buildQuestionParts removed as it is now integrated into the history construction

async function saveFullSessionToNote(item: Zotero.Item, messages: ChatMessage[]) {
  const parentID = item.isAttachment() ? item.parentID : item.id;
  if (!parentID) return;

  const note = new Zotero.Item("note");
  note.parentID = parentID;

  let html = `<h2>Gemini Chat Session (${new Date().toLocaleString()})</h2>`;

  messages.forEach(m => {
    const role = m.role === "user" ? "User" : (m.role === "model" ? "Gemini" : "System");

    // Use getMarkdown().render for formatting
    let content = "";
    try {
      content = getMarkdown().render(m.text);
    } catch (e) {
      content = m.text; // Fallback
    }

    html += `<p><strong>${role}:</strong></p>
    ${content}
    <hr/>`;
  });

  note.setNote(html);
  await note.saveTx();
  Zotero.debug(`[GeminiChat] Full chat saved to item ${parentID}`);
}

async function saveToNote(item: Zotero.Item, question: string, answer: string) {
  const parentID = item.isAttachment() ? item.parentID : item.id;
  if (!parentID) {
    Zotero.debug("[GeminiChat] Cannot save note: No parent item found.");
    return;
  }

  const note = new Zotero.Item("note");
  note.parentID = parentID;

  // Format content
  const qHtml = getMarkdown().render(question);
  const aHtml = getMarkdown().render(answer);

  note.setNote(`<h2>Gemini Chat</h2>
<p><strong>User:</strong></p>
${qHtml}
<hr/>
<p><strong>Gemini:</strong></p>
${aHtml}`);

  await note.saveTx();
  Zotero.debug(`[GeminiChat] Note saved to item ${parentID}`);
}

async function getPdfContextPart(item: Zotero.Item): Promise<{ mimeType: string; data: string } | null> {
  const attachment = getBestAttachment(item);
  if (!attachment) return null;

  const path = await attachment.getFilePathAsync();
  if (!path) return null;

  try {
    const data = await getFileData(path);
    if (data) {
      return {
        mimeType: "application/pdf",
        data
      };
    }
  } catch (e) {
    Zotero.debug(`[GeminiChat] Failed to read PDF: ${e}`);
  }
  return null;
}

function getBestAttachment(item: Zotero.Item): Zotero.Item | null {
  if (item.isAttachment()) return item;
  if (item.isRegularItem()) {
    const attachmentIDs = item.getAttachments();
    for (const id of attachmentIDs) {
      const att = Zotero.Items.get(id);
      if (att && !att.isNote() && att.attachmentContentType === 'application/pdf') {
        return att;
      }
    }
  }
  return null;
}

async function getFileData(path: string): Promise<string | null> {
  if (typeof IOUtils !== "undefined") {
    try {
      const bytes = await IOUtils.read(path);
      return arrayBufferToBase64(bytes);
    } catch (e) {
      Zotero.debug(`[GeminiChat] IOUtils read failed: ${e}`);
    }
  }

  // @ts-ignore
  if (typeof OS !== "undefined" && OS.File) {
    try {
      // @ts-ignore
      const bytes = await OS.File.read(path);
      return arrayBufferToBase64(bytes);
    } catch (e) {
      Zotero.debug(`[GeminiChat] OS.File read failed: ${e}`);
    }
  }

  return null;
}

function arrayBufferToBase64(buffer: Uint8Array | ArrayBuffer | any): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const end = Math.min(i + chunkSize, len);
    const chunk = bytes.subarray(i, end);
    // @ts-ignore
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

async function callGemini(settings: ReturnType<typeof getSettings>, contents: any[]): Promise<string> {
  const endpoint = buildEndpoint(settings);
  const payload = {
    contents: contents,
  };

  let signal: AbortSignal | undefined;
  let timer: any;

  if (typeof AbortController !== "undefined") {
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), 60000);
    signal = controller.signal;
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status} ${res.statusText}: ${text}`);
    }
    const data: any = await res.json();
    const content: string =
      data?.candidates?.[0]?.content?.parts
        ?.map((p: { text?: string }) => p.text)
        .filter(Boolean)
        .join("\n")
        ?.trim() || "No response";
    return content;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

