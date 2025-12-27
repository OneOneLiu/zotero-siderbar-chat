import MarkdownIt from "markdown-it";
// @ts-ignore
import tm from "markdown-it-texmath";
import katex from "katex";
import { config } from "../../package.json";
import Addon, { ChatMessage } from "../addon";
import { getSettings } from "./settings";
import { getLocaleID } from "../utils/locale";
import { GEMINI_MODELS, getProviderConfig } from "../constants";
import { getProvider } from "../providers";

Zotero.debug("[GeminiChat] Loading readerPane module...");

let md: any = null;

function getMarkdown() {
  if (!md) {
    try {
      Zotero.debug("[GeminiChat] Initializing MarkdownIt...");
      md = new MarkdownIt({
        xhtmlOut: true, // Use '/' to close single tags (<br />)
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
      },
      bodyXHTML: `<div class="gemini-chat-body"></div>`,
      onRender: ({ body, item }: RenderOptions) => {
        // Only render if we are likely in a valid context.
        if (!body || !item) return;
        renderChat(body, item, addon);
      },
      onItemChange: async ({ tabType, body, item, setEnabled }: any) => {
        // Strictly only enable for "reader"
        const enabled = tabType === "reader";
        if (typeof setEnabled === "function") setEnabled(enabled);

        if (enabled && body && item) {
          renderChat(body, item, addon);
        } else if (body) {
          body.innerHTML = "";
        }
      },
    }) || "";

  return paneKey;
}

export function registerSidebarButton(getPaneKey: () => string) {
  if (!Zotero.Reader) {
    Zotero.debug("[GeminiChat] Zotero.Reader not found, skipping sidebar button registration.");
    return;
  }
  Zotero.Reader.registerEventListener(
    "renderSidebarAnnotationHeader",
    (event) => {
      try {
        const { doc, append } = event;
        if (!doc || doc.getElementById("gemini-chat-sidebar-button")) return;

        // Ensure we are in a valid window context
        if (!doc.ownerGlobal || !doc.ownerGlobal.Zotero) return;

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
          // Use stopImmediatePropagation to be sure, but be careful
          e.preventDefault();
          e.stopPropagation();
          const paneKey = getPaneKey();
          if (!paneKey) return;

          const details = doc.querySelector("item-details") as any;
          if (details && typeof details.scrollToPane === "function") {
            details.scrollToPane(paneKey);
          }
        });
        append(btn);
      } catch (e) {
        Zotero.debug(`[GeminiChat] Error in renderSidebarAnnotationHeader: ${e}`);
      }
    },
    config.addonID,
  );
}

function renderChat(body: HTMLElement, item: Zotero.Item, addon: Addon) {
  Zotero.debug(`[GeminiChat] renderChat called for item ${item?.id}`);

  if (!item || !item.id) {
    Zotero.debug("[GeminiChat] renderChat aborted: invalid item");
    return;
  }

  try {
    const itemKey = item?.id ? String(item.id) : "global";
    const messages = addon.getSession(itemKey);
    const doc = body.ownerDocument;
    const HTML_NS = "http://www.w3.org/1999/xhtml";

    const createElement = (tagName: string) => {
      return doc.createElementNS(HTML_NS, tagName) as HTMLElement;
    };

    // Safely get head
    const head = doc.head || doc.getElementsByTagName("head")[0] || doc.documentElement;

    let currentSettings: any = {};
    try {
      currentSettings = getSettings();
    } catch (e) {
      Zotero.debug(`[GeminiChat] Error getting settings: ${e}`);
    }

    // Inject CSS
    try {
      if (!doc.getElementById("gemini-chat-styles")) {
        const style = createElement("style");
        style.id = "gemini-chat-styles";
        style.textContent = `
          :root {
            --gemini-bg-app: #f5f5f7; /* iOS-like background */
            --gemini-bg-header: rgba(245, 245, 247, 0.95); /* Match app bg */
            --gemini-bg-bubble-user: #007AFF;
            --gemini-bg-bubble-model: #ffffff;
            --gemini-text-primary: #1d1d1f;
            --gemini-text-secondary: #86868b;
            --gemini-border-light: #e5e5e5;
            --gemini-input-bg: #ffffff;
            --gemini-shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
          }
          .gemini-chat-wrapper {
            display: flex;
            flex-direction: column;
            height: ${currentSettings.chatHeight || 500}px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: var(--gemini-bg-app);
            color: var(--gemini-text-primary);
            font-size: 14px;
            width: 100%;
            box-sizing: border-box;
          }
          .gemini-chat-header {
            padding: 12px 16px;
            background: var(--gemini-bg-header);
            border-bottom: 1px solid var(--gemini-border-light);
            display: flex;
            flex-direction: column;
            gap: 10px;
            z-index: 10;
          }
          .gemini-chat-title-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 8px;
          }
          .gemini-chat-title-group {
            display: flex;
            align-items: center;
            gap: 8px;
            flex: 1;
            min-width: 0; /* Allow shrinking */
          }
          .gemini-chat-title {
            font-weight: 600;
            font-size: 15px;
            background: linear-gradient(135deg, #007AFF, #5856D6);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            flex-shrink: 0;
          }
          .gemini-chat-model-select {
            font-size: 12px;
            padding: 4px 8px;
            border: 1px solid var(--gemini-border-light);
            border-radius: 6px;
            max-width: 200px;
            background-color: transparent;
            color: var(--gemini-text-primary);
            cursor: pointer;
            transition: all 0.2s;
            flex-shrink: 1; /* Allow shrinking */
            min-width: 0;
          }
          .gemini-chat-model-select:hover {
            border-color: #007AFF;
          }
          .gemini-chat-subtitle {
            font-size: 11px;
            color: var(--gemini-text-secondary);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            padding-left: 2px;
          }
          
          /* Prompts Area */
          .gemini-chat-prompts {
            display: flex;
            gap: 8px;
            flex-wrap: wrap; /* Allow wrapping */
            padding: 2px 0 6px 0;
          }

          .gemini-chat-prompt-chip {
            white-space: nowrap;
            padding: 6px 12px;
            font-size: 12px;
            border: 1px solid transparent;
            border-radius: 16px;
            background: white;
            box-shadow: var(--gemini-shadow-sm);
            cursor: pointer;
            transition: all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
            color: var(--gemini-text-primary);
            font-weight: 500;
          }
          .gemini-chat-prompt-chip:hover {
            transform: translateY(-1px);
            box-shadow: 0 2px 5px rgba(0,0,0,0.08);
            color: #007AFF;
          }

          .gemini-chat-messages {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 16px;
          }

          .gemini-chat-bubble {
            max-width: 88%;
            padding: 10px 14px;
            border-radius: 18px;
            position: relative;
            font-size: 14px;
            line-height: 1.5;
            word-wrap: break-word;
            box-shadow: var(--gemini-shadow-sm);
            user-select: text;
          }
          .gemini-chat-bubble.user {
            align-self: flex-end;
            background: var(--gemini-bg-bubble-user);
            color: white;
            border-bottom-right-radius: 4px;
            background-image: linear-gradient(135deg, #007AFF, #005ecb);
          }
          .gemini-chat-bubble.model {
            align-self: flex-start;
            background: var(--gemini-bg-bubble-model);
            color: var(--gemini-text-primary);
            border-bottom-left-radius: 4px;
          }
          .gemini-chat-bubble.system {
            align-self: center;
            background-color: transparent;
            box-shadow: none;
            color: var(--gemini-text-secondary);
            font-size: 11px;
            padding: 4px 8px;
            border: 1px solid var(--gemini-border-light);
            border-radius: 12px;
          }
          
          .gemini-chat-bubble p { margin: 0 0 8px 0; }
          .gemini-chat-bubble p:last-child { margin: 0; }
          
          /* Save Button */
          .gemini-chat-save-btn {
            position: absolute;
            top: -8px;
            left: -10px;
            width: 22px;
            height: 22px;
            background: white;
            border: 1px solid var(--gemini-border-light);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            font-size: 12px;
            color: var(--gemini-text-secondary);
            box-shadow: 0 2px 4px rgba(0,0,0,0.08);
            opacity: 0;
            transform: scale(0.8);
            transition: all 0.2s;
            z-index: 5;
          }
          .gemini-chat-bubble:hover .gemini-chat-save-btn {
            opacity: 1;
            transform: scale(1);
          }
          .gemini-chat-save-btn:hover {
            color: #007AFF;
            border-color: #007AFF;
          }

          /* Input Area */
          .gemini-chat-input-area {
            padding: 16px;
            background: var(--gemini-bg-header);
            border-top: 1px solid var(--gemini-border-light);
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          .gemini-chat-input-row {
            display: flex;
            gap: 8px;
            align-items: flex-end;
            background: white;
            border: 1px solid var(--gemini-border-light);
            border-radius: 20px;
            padding: 6px 8px 6px 12px;
            transition: border-color 0.2s;
            box-shadow: var(--gemini-shadow-sm);
          }
          .gemini-chat-input-row:focus-within {
            border-color: #007AFF;
            box-shadow: 0 0 0 3px rgba(0,122,255,0.1);
          }

          .gemini-chat-textarea {
            flex: 1;
            border: none;
            padding: 4px 0;
            font-family: inherit;
            font-size: 14px;
            resize: none;
            min-height: 24px;
            max-height: 120px;
            outline: none;
            background: transparent;
            color: var(--gemini-text-primary);
          }
          
          /* Buttons */
          .gemini-chat-send-btn {
            background: transparent;
            color: #007AFF;
            border: none;
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            font-size: 18px;
            transition: all 0.2s;
            border-radius: 50%;
          }
          .gemini-chat-send-btn:hover {
            background-color: rgba(0,122,255,0.1);
          }
          .gemini-chat-send-btn:disabled {
            color: #ccc;
            cursor: default;
            background-color: transparent;
          }

          .gemini-chat-spinner {
            width: 16px;
            height: 16px;
            border: 2px solid rgba(0,122,255,0.3);
            border-top-color: #007AFF;
            border-radius: 50%;
            animation: gemini-chat-spin 0.8s linear infinite;
          }
          @keyframes gemini-chat-spin { to { transform: rotate(360deg); } }

          .gemini-chat-hint {
            font-size: 10px;
            color: var(--gemini-text-secondary);
            text-align: center;
            opacity: 0.7;
          }

          /* Loading Dots */
          .gemini-chat-bubble.loading {
             background: transparent;
             box-shadow: none;
             padding: 0 10px;
             margin-top: -8px;
             display: flex;
             gap: 4px;
             align-items: center;
          }
          .gemini-chat-dot {
            width: 6px;
            height: 6px;
            background-color: #b0b0b5;
            border-radius: 50%;
            animation: gemini-chat-bounce 1.4s infinite ease-in-out both;
          }
           .gemini-chat-dot:nth-child(1) { animation-delay: -0.32s; }
           .gemini-chat-dot:nth-child(2) { animation-delay: -0.16s; }
           @keyframes gemini-chat-bounce {
             0%, 80%, 100% { transform: scale(0); }
             40% { transform: scale(1); }
           }
           .gemini-chat-meta {
             font-size: 10px;
             color: rgba(255,255,255,0.7); /* Light on blue bubble? No, usually handles both */
             margin-top: 4px;
             text-align: right;
           }
           .gemini-chat-bubble.model .gemini-chat-meta { color: #999; }
           .gemini-chat-bubble.user .gemini-chat-meta { color: rgba(255,255,255,0.8); }

          /* Selection Toolbar */
          .gemini-chat-selection-toolbar {
            position: fixed;
            z-index: 1000;
            background: #333;
            border-radius: 4px;
            padding: 4px;
            display: flex;
            gap: 4px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            animation: gemini-chat-fade-in 0.2s ease-out;
          }
          .gemini-chat-format-btn {
            background: transparent;
            border: none;
            color: white;
            padding: 4px 8px;
            cursor: pointer;
            border-radius: 2px;
            font-size: 12px;
            font-weight: 500;
          }
          .gemini-chat-format-btn:hover {
            background: rgba(255,255,255,0.2);
          }
          
          /* Context Chips */
          .gemini-chat-context-chips {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
            padding: 0 16px 8px 16px;
          }
          .gemini-chat-context-chip {
            font-size: 11px;
            background: #e1e1e6;
            color: var(--gemini-text-primary);
            padding: 4px 8px;
            border-radius: 12px;
            display: flex;
            align-items: center;
            gap: 4px;
            max-width: 100%;
          }
          .gemini-chat-context-chip-text {
             overflow: hidden;
             text-overflow: ellipsis;
             white-space: nowrap;
             max-width: 120px;
          }
          .gemini-chat-context-remove {
            cursor: pointer;
            width: 14px;
            height: 14px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            background: rgba(0,0,0,0.1);
            font-size: 9px;
            line-height: 1;
          }
          .gemini-chat-context-remove:hover {
            background: rgba(0,0,0,0.2);
            color: white;
          }

          /* Input Add Button */
          .gemini-chat-add-btn {
            background: transparent;
            color: var(--gemini-text-secondary);
            border: none;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            font-size: 20px;
            border-radius: 50%;
            margin-bottom: 4px; /* Align with textarea bottom */
          }
          .gemini-chat-add-btn:hover {
             color: #007AFF;
             background-color: rgba(0,122,255,0.05);
          }

          @keyframes gemini-chat-fade-in { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        `;
        head.appendChild(style);
      }

      // Inject Katex CSS if missing
      if (!doc.getElementById("katex-css")) {
        const link = createElement("link") as HTMLLinkElement;
        link.id = "katex-css";
        link.setAttribute("rel", "stylesheet");
        link.setAttribute("href", `chrome://${config.addonRef}/content/style/katex.min.css`);
        head.appendChild(link);
      }
    } catch (e) {
      Zotero.debug(`[GeminiChat] CSS Inject Error: ${e}`);
    }

    body.innerHTML = "";

    const wrapper = createElement("div");
    wrapper.setAttribute("class", "gemini-chat-wrapper");

    // --- Header ---
    const header = createElement("div");
    header.setAttribute("class", "gemini-chat-header");

    const titleRow = createElement("div");
    titleRow.setAttribute("class", "gemini-chat-title-row");

    const titleGroup = createElement("div");
    titleGroup.setAttribute("class", "gemini-chat-title-group");

    // Get provider display name
    const providerConfig = getProviderConfig(currentSettings.provider);
    const providerName = providerConfig?.name || "AI Chat";

    const title = createElement("div");
    title.textContent = providerName;
    title.setAttribute("class", "gemini-chat-title");

    titleGroup.appendChild(title);

    // Only show model selector dropdown for Gemini
    if (providerConfig?.usesDropdown) {
      const modelSelect = createElement("select") as HTMLSelectElement;
      modelSelect.setAttribute("class", "gemini-chat-model-select");

      const models = GEMINI_MODELS;

      models.forEach(m => {
        const opt = createElement("option") as HTMLOptionElement;
        opt.value = m;
        opt.textContent = m.replace("gemini-", "");
        if (m === currentSettings.model) {
          opt.selected = true;
        }
        modelSelect.appendChild(opt);
      });

      modelSelect.addEventListener("change", () => {
        const val = modelSelect.value;
        Zotero.Prefs.set(config.prefsPrefix + ".model", val, true);
      });

      titleGroup.appendChild(modelSelect);
    } else {
      // For non-Gemini providers, show model name as text
      const modelName = createElement("div");
      modelName.setAttribute("class", "gemini-chat-subtitle");
      modelName.textContent = currentSettings.model || "No model specified";
      modelName.style.paddingLeft = "8px";
      titleGroup.appendChild(modelName);
    }

    titleRow.appendChild(titleGroup);
    header.appendChild(titleRow);

    const subtitle = createElement("div");
    subtitle.setAttribute("class", "gemini-chat-subtitle");
    subtitle.textContent = item?.getField?.("title")
      ? item.getField("title")
      : "Select a PDF tab to chat";
    header.appendChild(subtitle);

    // --- Prompts ---
    let prompts: Array<{ name: string, prompt: string }> = [];
    try {
      if (currentSettings.customPrompts) {
        prompts = JSON.parse(currentSettings.customPrompts);
      }
    } catch (e) {
      Zotero.debug(`[GeminiChat] Error parsing prompts: ${e}`);
    }

    if (prompts.length > 0 && Array.isArray(prompts)) {
      const promptBar = createElement("div");
      promptBar.setAttribute("class", "gemini-chat-prompts");

      prompts.forEach(p => {
        if (!p.name || !p.prompt) return;
        const chip = createElement("button");
        chip.setAttribute("class", "gemini-chat-prompt-chip");
        chip.textContent = p.name;
        chip.title = p.prompt;
        chip.onclick = () => handleSend(p.prompt);
        promptBar.appendChild(chip);
      });
      header.appendChild(promptBar);
    }

    // --- Load History Button (if empty) ---
    if (messages.length === 0) {
      getHistoryNote(item).then(note => {
        if (note) {
          const loadContainer = createElement("div");
          loadContainer.style.padding = "0 16px";
          loadContainer.style.marginBottom = "8px";

          const loadBtn = createElement("button");
          loadBtn.textContent = "📂 Load Chat History from Note";
          loadBtn.className = "gemini-chat-prompt-chip"; // Reuse chip style
          loadBtn.style.width = "100%";
          loadBtn.style.textAlign = "center";
          loadBtn.style.backgroundColor = "#f0f0f0";

          loadBtn.onclick = () => {
            const noteContent = note.getNote();
            const loadedMsgs = parseHistoryFromNote(noteContent);
            if (loadedMsgs.length > 0) {
              loadedMsgs.forEach(m => addon.pushMessage(itemKey, m));
              // Force re-render
              renderChat(body, item, addon);
            }
          };

          loadContainer.appendChild(loadBtn);
          // Insert after header or prompts?
          // Prompts are inside header. Steps:
          // header -> [Title, Subtitle, Prompts]
          // Let's put this inside header at the bottom?
          header.appendChild(loadContainer);
        }
      });
    }

    // --- Messages ---
    const messageList = createElement("div");
    messageList.setAttribute("class", "gemini-chat-messages");

    // --- Interaction Logic (Selection & Formatting) ---
    let selectionToolbar: HTMLElement | null = null;

    const removeToolbar = () => {
      if (selectionToolbar) {
        selectionToolbar.remove();
        selectionToolbar = null;
      }
    };

    const applyFormat = (format: 'highlight' | 'red' | 'bold') => {
      const selection = doc.getSelection();
      if (!selection || selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);
      const span = createElement(format === 'bold' ? 'strong' : 'span');

      if (format === 'highlight') {
        span.style.backgroundColor = '#ffeba6'; // Yellow highlight
        span.style.color = 'black';
        span.style.padding = '0 2px';
        span.style.borderRadius = '2px';
      } else if (format === 'red') {
        span.style.color = '#d93025'; // Red text
      }

      try {
        range.surroundContents(span);
        selection.removeAllRanges();
        removeToolbar();

        // Persist changes
        // Find which message bubble was modified
        let current = span.parentElement;
        while (current && !current.classList.contains("gemini-chat-bubble")) {
          current = current.parentElement;
        }

        if (current) {
          // Identify the message index by finding the bubble in the list
          const bubbles = Array.from(messageList.getElementsByClassName("gemini-chat-bubble"));
          const index = bubbles.indexOf(current);
          if (index !== -1 && messages[index]) {
            // Find content node (the generic div wrapping the markdown)
            let contentNode = span.parentElement;
            while (contentNode && contentNode.parentElement !== current) {
              contentNode = contentNode.parentElement;
            }

            if (contentNode) {
              // Update the message text with the new HTML
              messages[index].text = contentNode.innerHTML;

              // Auto-save changes
              const currentNoteID = addon.getNoteID(itemKey);
              saveFullSessionToNote(item, messages, currentNoteID).then(id => {
                if (id) addon.setNoteID(itemKey, id);
              }).catch(e => Zotero.debug(`[GeminiChat] Auto-save highlight failed: ${e}`));
            }
          }
        }

      } catch (e) {
        Zotero.debug(`[GeminiChat] Apply format error: ${e}`);
      }
    };

    messageList.addEventListener("mouseup", (e) => {
      // Small delay to let selection settle
      setTimeout(() => {
        const selection = doc.getSelection();
        if (!selection || selection.isCollapsed) {
          removeToolbar();
          return;
        }

        // Check if selection is inside a bubble
        let node = selection.anchorNode;
        let insideBubble = false;
        while (node) {
          if (node.nodeType === 1 && (node as Element).classList.contains("gemini-chat-bubble")) {
            insideBubble = true;
            break;
          }
          node = node.parentNode;
        }

        if (!insideBubble) {
          removeToolbar();
          return;
        }

        // Show toolbar
        removeToolbar();
        selectionToolbar = createElement("div");
        selectionToolbar.className = "gemini-chat-selection-toolbar";

        const btnHighlight = createElement("button");
        btnHighlight.className = "gemini-chat-format-btn";
        btnHighlight.innerHTML = "🖊️ High";
        btnHighlight.onclick = () => applyFormat('highlight');

        const btnRed = createElement("button");
        btnRed.className = "gemini-chat-format-btn";
        btnRed.innerHTML = "🔴 Red";
        btnRed.onclick = () => applyFormat('red');

        const btnBold = createElement("button");
        btnBold.className = "gemini-chat-format-btn";
        btnBold.innerHTML = "<b>B</b>";
        btnBold.onclick = () => applyFormat('bold');

        selectionToolbar.appendChild(btnHighlight);
        selectionToolbar.appendChild(btnRed);
        selectionToolbar.appendChild(btnBold);

        body.appendChild(selectionToolbar); // Append to body to be fixed/absolute

        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        // Position above selection
        const toolbarHeight = 40;
        selectionToolbar.style.top = (rect.top - toolbarHeight) + "px";
        selectionToolbar.style.left = rect.left + "px";
      }, 10);
    });



    // --- Context Chips Area ---
    const contextChips = createElement("div");
    contextChips.setAttribute("class", "gemini-chat-context-chips");

    // --- Input ---
    const inputArea = createElement("div");
    inputArea.setAttribute("class", "gemini-chat-input-area");

    const inputRow = createElement("div");
    inputRow.setAttribute("class", "gemini-chat-input-row");

    const addBtn = createElement("button");
    addBtn.setAttribute("class", "gemini-chat-add-btn");
    addBtn.textContent = "+";
    addBtn.title = "Add context files";

    // We'll define handleContextPicker later
    addBtn.onclick = () => handleContextPicker();

    const input = createElement("textarea") as HTMLTextAreaElement;
    input.setAttribute("class", "gemini-chat-textarea");
    input.placeholder = "Ask a question...";
    input.rows = 1;

    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = (input.scrollHeight) + "px";
    });

    const sendBtn = createElement("button") as HTMLButtonElement;
    sendBtn.setAttribute("class", "gemini-chat-send-btn");
    sendBtn.textContent = "➤";
    sendBtn.title = "Send";

    const hint = createElement("div");
    hint.setAttribute("class", "gemini-chat-hint");
    hint.textContent = "Enter to send, Shift+Enter for new line";

    inputRow.appendChild(addBtn);
    inputRow.appendChild(input);
    inputRow.appendChild(sendBtn);
    inputArea.appendChild(contextChips); // Chips inside input area, at top
    inputArea.appendChild(inputRow);
    inputArea.appendChild(hint);

    wrapper.appendChild(header);
    wrapper.appendChild(messageList);
    wrapper.appendChild(inputArea);
    body.appendChild(wrapper);

    const renderMessages = () => {
      messageList.innerHTML = "";
      messages.forEach((m, index) => {
        const bubble = createElement("div");
        bubble.setAttribute("class", `gemini-chat-bubble ${m.role}`);

        if (m.role === "user") {
          const saveBtn = createElement("button");
          saveBtn.textContent = "+";
          saveBtn.title = "Save this request to note";
          saveBtn.setAttribute("class", "gemini-chat-save-btn");

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
        }

        try {
          const content = createElement("div");
          // Initialize md if needed
          const mdInstance = getMarkdown();
          content.innerHTML = mdInstance.render(m.text);
          bubble.appendChild(content);
        } catch (e) {
          bubble.textContent = m.text;
        }

        if ((m.meta && m.meta.duration) || m.usage) {
          const meta = createElement("div");
          meta.setAttribute("class", "gemini-chat-meta");
          if (m.usage) meta.style.cursor = "help";

          let metaText = "";
          if (m.meta && m.meta.duration) {
            metaText += `${(m.meta.duration / 1000).toFixed(1)}s`;
          }
          if (m.usage) {
            if (metaText) metaText += " | ";
            // Display as: Prompt / Output (Total)
            // e.g. 150 / 50 (200 tks)
            metaText += `${m.usage.promptTokens} / ${m.usage.completionTokens} tks`;
            const tooltip = `Total: ${m.usage.totalTokens}\nPrompt: ${m.usage.promptTokens}\nOutput: ${m.usage.completionTokens}`;
            meta.setAttribute("title", tooltip);
          }

          meta.textContent = metaText;
          bubble.appendChild(meta);
        }

        messageList.appendChild(bubble);
      });

      // Show loading indicator if busy
      if (addon.isBusy(itemKey)) {
        const loadingBubble = createElement("div");
        loadingBubble.setAttribute("class", "gemini-chat-bubble model loading");
        loadingBubble.innerHTML = `
          <div class="gemini-chat-dot"></div>
          <div class="gemini-chat-dot"></div>
          <div class="gemini-chat-dot"></div>
        `;
        messageList.appendChild(loadingBubble);
      }

      messageList.scrollTop = messageList.scrollHeight;
    };

    renderMessages();

    const setBusy = (busy: boolean) => {
      addon.setBusy(itemKey, busy);
      sendBtn.disabled = busy;

      if (busy) {
        sendBtn.innerHTML = ""; // Clear emoji
        const spinner = createElement("div");
        spinner.className = "gemini-chat-spinner";
        sendBtn.appendChild(spinner);
        sendBtn.title = "Asking...";
      } else {
        sendBtn.textContent = "➤";
        sendBtn.title = "Send";
      }
    };

    // Initial sync
    setBusy(addon.isBusy(itemKey));

    const renderChips = () => {
      contextChips.innerHTML = "";
      const items = addon.getContextItems(itemKey);

      items.forEach(ctxItem => {
        const chip = createElement("div");
        chip.className = "gemini-chat-context-chip";

        let title = ctxItem.getField("title");
        if (ctxItem.isAttachment() && ctxItem.parentItem) {
          title = ctxItem.parentItem.getField("title");
        }
        if (!title) title = "Untitled";

        const text = createElement("span");
        text.className = "gemini-chat-context-chip-text";

        // Truncate to 3 words
        const words = title.split(/\s+/);
        if (words.length > 3) {
          text.textContent = words.slice(0, 3).join(" ") + "...";
        } else {
          text.textContent = title;
        }

        chip.title = title; // Full title in tooltip for the whole chip

        const remove = createElement("span");
        remove.className = "gemini-chat-context-remove";
        remove.textContent = "✕";
        remove.onclick = (e) => {
          e.stopPropagation();
          addon.removeContextItem(itemKey, ctxItem.id);
          renderChips();
        };

        chip.appendChild(text);
        chip.appendChild(remove);
        contextChips.appendChild(chip);
      });
    };

    // Initial render of chips
    renderChips();

    const handleContextPicker = async () => {
      Zotero.debug("[GeminiChat] handleContextPicker (Native) triggered");
      try {
        const mainWindow = Zotero.getMainWindow();
        if (!mainWindow) return;

        // Native 'Select Items' dialog
        // Usage: openDialog(url, name, options, io)
        // standard Zotero select dialog uses io.dataOut to return items.
        // io.dataIn can be used to set mode.

        const io = {
          dataIn: {}, // Empty dataIn often implies default selection mode? 
          dataOut: null as (string[] | Zotero.Item[] | null),
          singleSelection: false
        };

        // Based on Zotero source code inspection patterns or common knowledge:
        // chrome://zotero/content/selectItemsDialog.xhtml is the list picker.
        // However, for "Related" items, Zotero uses a specialized picker or configuring this one.
        // If we pass 'dataIn' as null, does it default to library? We'll see.

        mainWindow.openDialog(
          "chrome://zotero/content/selectItemsDialog.xhtml",
          "selectItems",
          "chrome,modal,centerscreen,resizable=yes",
          io
        );

        if (io.dataOut) {
          const selection = io.dataOut;
          Zotero.debug(`[GeminiChat] Native picker returned: ${Array.isArray(selection) ? selection.length : 'non-array'}`);

          if (Array.isArray(selection)) {
            let addedCount = 0;
            selection.forEach((idOrItem: any) => {
              const item = Zotero.Items.get(idOrItem) || idOrItem; // It might be ID or Item object
              if (item instanceof Zotero.Item) {
                // Logic to find PDF
                let pdfItem: Zotero.Item | null = null;
                if (item.isAttachment() && item.attachmentContentType === 'application/pdf') {
                  pdfItem = item;
                } else if (item.isRegularItem()) {
                  const attachmentIDs = item.getAttachments();
                  for (const id of attachmentIDs) {
                    const att = Zotero.Items.get(id);
                    if (att && !att.isNote() && att.attachmentContentType === 'application/pdf') {
                      pdfItem = att;
                      break;
                    }
                  }
                }

                if (pdfItem) {
                  addon.addContextItem(itemKey, pdfItem);
                  addedCount++;
                }
              }
            });

            if (addedCount > 0) renderChips();
            else mainWindow.alert("No PDF attachments found in selection.");
          }
        }
      } catch (e) {
        Zotero.debug(`[GeminiChat] Context Picker Error: ${e}`);
        // Fallback to manual selection if native fails completely?
        // confirm("Native picker failed. Use manual selection?") ... 
        // For now just log.
        const mw = Zotero.getMainWindow();
        if (mw) mw.alert("Error opening picker: " + e);
      }
    };

    // Drop Handler for Drag & Drop
    const handleDrop = (evt: DragEvent) => {
      evt.preventDefault();
      evt.stopPropagation();

      const xfer = evt.dataTransfer;
      if (!xfer) return;

      const zoteroItems = xfer.getData("zotero/item");
      if (zoteroItems) {
        try {
          // Fallback to calling the picker if drag detected but parsing is hard
          handleContextPicker();
        } catch (e) { }
      }
    };

    contextChips.ondragover = (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "copy";
    };
    contextChips.ondrop = handleDrop;

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
        input.style.height = "auto";
      }
      renderMessages();

      const settings = getSettings();
      if (!settings.apiKey) {
        addon.pushMessage(itemKey, {
          role: "system",
          text: `Missing API key. Set it in Preferences -> LLM Chat.`,
          at: Date.now(),
        });
        renderMessages();
        return;
      }

      setBusy(true);
      const startTime = Date.now();

      // Create a placeholder message for the model response
      addon.pushMessage(itemKey, {
        role: "model",
        text: "",
        at: startTime,
        meta: { duration: 0 }
      });
      renderMessages();

      try {
        const history = addon.getSession(itemKey);

        // --- Multi-file Context Gathering ---
        const contextItems = addon.getContextItems(itemKey);

        // Include current item if appropriate (usually yes)
        // Check if current item has PDF content?
        const currentAttachment = item.isAttachment() ? item : getBestAttachment(item);

        const allContextFiles: Zotero.Item[] = [];
        if (currentAttachment && (currentAttachment.attachmentContentType === 'application/pdf')) {
          allContextFiles.push(currentAttachment);
        }

        contextItems.forEach(ci => {
          // Dedupe
          if (!allContextFiles.find(existing => existing.id === ci.id)) {
            allContextFiles.push(ci);
          }
        });

        const contextParts: any[] = [];

        // Handle PDF context based on provider
        if (settings.provider === "gemini") {
          // Gemini: Send base64 PDF (multimodal support)
          for (const pdfItem of allContextFiles) {
            const part = await getPdfContextPart(pdfItem);
            if (part) {
              const title = pdfItem.getField("title") || pdfItem.parentItem?.getField("title") || "Untitled";
              contextParts.push({ text: `[Context Document: ${title}]` });
              contextParts.push({ inlineData: part });
            }
          }
        } else {
          // DeepSeek/Doubao: Extract and send PDF text
          for (const pdfItem of allContextFiles) {
            const pdfText = await getPdfText(pdfItem);
            if (pdfText) {
              const title = pdfItem.getField("title") || pdfItem.parentItem?.getField("title") || "Untitled";
              const textContent = `[Context Document: ${title}]\n\n${pdfText}`;
              contextParts.push({ text: textContent });
            }
          }
        }

        const contents = history.slice(0, -1).map((msg, index) => {
          const parts: any[] = [{ text: msg.text }];
          return { role: msg.role, parts: parts };
        });

        // Find last user message in 'contents' and prepend context
        if (contents.length > 0 && contextParts.length > 0) {
          let lastUserMsg = null;
          for (let i = contents.length - 1; i >= 0; i--) {
            if (contents[i].role === 'user') {
              lastUserMsg = contents[i];
              break;
            }
          }
          if (lastUserMsg) {
            lastUserMsg.parts.unshift(...contextParts);
          }
        }

        const sessions = addon.getSession(itemKey);
        const modelMsg = sessions[sessions.length - 1];

        let accumulatedText = "";

        for await (const chunk of callAIStream(settings, contents)) {
          if (typeof chunk === "string") {
            accumulatedText += chunk;
            modelMsg.text = accumulatedText;
          } else if (typeof chunk === "object" && chunk.usage) {
            modelMsg.usage = {
              promptTokens: chunk.usage.promptTokenCount,
              completionTokens: chunk.usage.candidatesTokenCount,
              totalTokens: chunk.usage.totalTokenCount
            };
          }
          renderMessages();
        }

        const duration = Date.now() - startTime;
        if (modelMsg.meta) {
          modelMsg.meta.duration = duration;
        }

      } catch (e: any) {
        const sessions = addon.getSession(itemKey);
        sessions.pop();

        addon.pushMessage(itemKey, {
          role: "system",
          text: `AI error: ${e?.message || e}`,
          at: Date.now(),
        });
      } finally {
        setBusy(false);
        renderMessages();

        // Auto-save chat history
        try {
          const currentNoteID = addon.getNoteID(itemKey);
          const savedID = await saveFullSessionToNote(item, messages, currentNoteID);
          if (savedID) {
            addon.setNoteID(itemKey, savedID);
          }
        } catch (e) {
          Zotero.debug(`[GeminiChat] Auto-save failed: ${e}`);
        }
      }
    };

    sendBtn.onclick = () => handleSend();
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        handleSend();
      }
    });

  } catch (error: any) {
    Zotero.debug(`[GeminiChat] Render error: ${error}\n${error?.stack}`);
    body.textContent = `Error rendering chat pane: ${error?.message || error}`;
  }
}

async function saveFullSessionToNote(item: Zotero.Item, messages: ChatMessage[], existingNoteID?: number): Promise<number | null> {
  const parentID = item.isAttachment() ? item.parentID : item.id;
  if (!parentID) return null;

  let note: any;

  // 1. Try to find existing history note by name first if no ID provided or valid
  // This ensures singleton behavior per item
  if (!note) {
    const historyNote = await getHistoryNote(item);
    if (historyNote) {
      note = historyNote;
    }
  }

  // 2. If existingNoteID was explicitly passed and valid, use it (though step 1 mostly covers it)
  if (!note && existingNoteID) {
    try {
      const existing = Zotero.Items.get(existingNoteID);
      if (existing && !existing.deleted && existing.isNote()) {
        note = existing;
      }
    } catch (e) { }
  }

  // 3. Create new if not found
  if (!note) {
    note = new Zotero.Item("note");
    note.parentID = parentID;
  }

  let html = `<h2>Gemini Chat History</h2>`;

  messages.forEach(m => {
    const role = m.role === "user" ? "User" : (m.role === "model" ? "Gemini" : "System");

    let content = "";
    try {
      // If we are repopulating from loaded history which is already HTML, this might double encode?
      // m.text from loaded history is HTML.
      // m.text from fresh input is Markdown.
      // We can heuristic check? Or just trust markdown-it to handle it.
      // If m.text starts with <, assume HTML?

      content = getMarkdown().render(m.text);
    } catch (e) {
      content = m.text;
    }

    let timestampHtml = "";
    if (m.role === "user" && m.at) {
      const timeStr = new Date(m.at).toLocaleString();
      timestampHtml = `<p class="gemini-chat-timestamp" style="color:#888; font-size:0.8em; margin-bottom:0;">[${timeStr}]</p>`;
    }

    html += `${timestampHtml}<p><strong>${role}:</strong></p>
    ${content}
    <hr/>`;
  });

  note.setNote(html);
  await note.saveTx();

  return note.id;
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

async function getHistoryNote(item: Zotero.Item): Promise<Zotero.Item | null> {
  const parentID = item.isAttachment() ? item.parentID : item.id;
  if (!parentID) return null;

  const parent = Zotero.Items.get(parentID);
  if (!parent) return null;

  const noteIDs = parent.getNotes();
  for (const id of noteIDs) {
    const note = Zotero.Items.get(id);
    if (note && !note.deleted && note.getNote().includes("<h2>Gemini Chat History</h2>")) {
      return note;
    }
  }
  return null;
}

function parseHistoryFromNote(html: string): ChatMessage[] {
  const messages: ChatMessage[] = [];
  // Simple parsing based on known structure
  // <h2>Gemini Chat History</h2>
  // <p class="gemini-chat-timestamp">...</p>
  // <p><strong>User:</strong></p> ... <hr/>
  // <p><strong>Gemini:</strong></p> ... <hr/>

  const chunks = html.split("<hr/>");
  chunks.forEach(chunk => {
    // Determine role
    let role: "user" | "model" | "system" | null = null;
    let text = "";

    // Remove timestamp from chunk for parsing text
    // The timestamp is usually before the User label
    const cleanChunk = chunk.replace(/<p class="gemini-chat-timestamp".*?<\/p>/g, "");

    if (cleanChunk.includes("<strong>User:</strong>")) {
      role = "user";
      text = cleanChunk.replace(/<p><strong>User:<\/strong><\/p>/, "").trim();
    } else if (cleanChunk.includes("<strong>Gemini:</strong>")) {
      role = "model";
      text = cleanChunk.replace(/<p><strong>Gemini:<\/strong><\/p>/, "").trim();
    } else if (cleanChunk.includes("<strong>System:</strong>")) {
      role = "system";
      text = cleanChunk.replace(/<p><strong>System:<\/strong><\/p>/, "").trim();
    }

    if (role && text) {
      // Clean up common wrapper if present (though split might leave some)
      // The text is HTML. We can just use it as is for now since the view expects HTML-ish
      // or markdown.
      // The current view renders markdown. If we pass HTML, markdown-it preserves it.
      messages.push({
        role,
        text,
        at: Date.now() // Timestamps are stripped from view, so we just use current for the object
      });
    }
  });

  return messages;
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

/**
 * Extract text content from PDF for non-Gemini providers
 */
async function getPdfText(item: Zotero.Item): Promise<string | null> {
  Zotero.debug("[GeminiChat] getPdfText called with item: " + item?.id);

  // The item passed here is already an attachment
  if (!item) {
    Zotero.debug("[GeminiChat] No item provided for PDF text extraction");
    return null;
  }

  try {
    const itemID = item.id;
    Zotero.debug("[GeminiChat] Attempting to extract text from item ID: " + itemID);

    // Check if PDF has been indexed using the correct constant
    // @ts-ignore
    const indexedState = await Zotero.Fulltext.getIndexedState(item);
    // @ ts-ignore
    const INDEX_STATE_INDEXED = Zotero.Fulltext.INDEX_STATE_INDEXED || 2;

    Zotero.debug(`[GeminiChat] PDF index status for item ${itemID}: ${indexedState} (indexed=${INDEX_STATE_INDEXED})`);

    // If not indexed, index it first
    if (indexedState !== INDEX_STATE_INDEXED) {
      Zotero.debug("[GeminiChat] PDF not indexed, triggering indexing...");
      // @ts-ignore
      await Zotero.Fulltext.indexItems([itemID]);
      // Wait for indexing to complete
      // @ts-ignore
      await Zotero.Promise.delay(1000);
      Zotero.debug("[GeminiChat] Waited 1000ms for indexing");
    }

    // Read the cached fulltext file
    // @ts-ignore
    const cacheFile = Zotero.Fulltext.getItemCacheFile(item);
    Zotero.debug("[GeminiChat] Cache file path: " + cacheFile?.path);

    if (cacheFile && await IOUtils.exists(cacheFile.path)) {
      Zotero.debug("[GeminiChat] Cache file exists, reading...");
      // @ts-ignore
      const content = await Zotero.File.getContentsAsync(cacheFile.path);

      if (content) {
        const text = typeof content === 'string'
          ? content
          : new TextDecoder().decode(content as BufferSource);

        if (text && text.trim().length > 0) {
          Zotero.debug(`[GeminiChat] ✅ Extracted ${text.length} characters from PDF`);
          return text.trim();
        }
      }
    }

    Zotero.debug("[GeminiChat] ⚠️ No text content found in PDF cache");
    return null;
  } catch (e) {
    Zotero.debug("[GeminiChat] ❌ Failed to extract PDF text: " + e);
    return null;
  }
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

async function* callAIStream(settings: ReturnType<typeof getSettings>, contents: any[]): AsyncGenerator<string | { usage: any }, void, unknown> {
  const provider = getProvider(settings.provider);

  // Build endpoint using provider
  const endpoint = provider.buildEndpoint({
    apiBase: settings.apiBase,
    model: settings.model,
    apiKey: settings.apiKey,
  }, true);

  // Format request using provider
  const payload = provider.formatRequest(contents, settings.model);

  let signal: AbortSignal | undefined;
  if (typeof AbortController !== "undefined") {
    const controller = new AbortController();
    // Longer timeout for streaming
    setTimeout(() => controller.abort(), 120000);
    signal = controller.signal;
  }

  // Prepare headers
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  // OpenAI-compatible providers use Authorization header
  if (settings.provider !== "gemini") {
    headers["Authorization"] = `Bearer ${settings.apiKey}`;
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }

  if (!res.body) throw new Error("No response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      // Gemini returns a JSON array: [ { ... }, { ... } ]
      // But acts as a stream. We simply regex for "text" fields to be safe and simple.
      // A more robust way is to finding matching brackets, but regex is surprisingly effective for this specific API shape 
      // if we are just extracting the text parts.
      // However, to be cleaner, let's try to parse complete JSON objects from the buffer.
      // The stream format is essentially:
      // [
      // { ... },
      // { ... }
      // ]

      // We'll treat the buffer as text and extract content using regex to avoid complex JSON stream parsing logic
      // Regex to find: "text": "..." 
      // Note: This is a simplification. For production usage, a real JSON stream parser is better.
      // But given we want "minimal new problems", regex on the JSON string is often safer than writing a fragile parser.

      // Actually, let's try a split approach. The API usually sends one JSON object per 'data' chunk or comma separated.
      // Let's match valid JSON objects.

      let scannerIdx = 0;
      while (scannerIdx < buffer.length) {
        const start = buffer.indexOf('{', scannerIdx);
        if (start === -1) break;

        // Minimal bracket balancing
        let depth = 0;
        let end = -1;
        let inString = false;
        let escape = false;

        for (let i = start; i < buffer.length; i++) {
          const char = buffer[i];
          if (escape) {
            escape = false;
            continue;
          }
          if (char === '\\') {
            escape = true;
            continue;
          }
          if (char === '"') {
            inString = !inString;
            continue;
          }
          if (!inString) {
            if (char === '{') depth++;
            if (char === '}') {
              depth--;
              if (depth === 0) {
                end = i;
                break;
              }
            }
          }
        }

        if (end !== -1) {
          const jsonStr = buffer.substring(start, end + 1);
          try {
            const parsed = JSON.parse(jsonStr);
            const parsedChunk = provider.parseStreamChunk(parsed);
            if (parsedChunk) {
              if (parsedChunk.type === "text" && parsedChunk.text) {
                yield parsedChunk.text;
              } else if (parsedChunk.type === "usage" && parsedChunk.usage) {
                yield { usage: parsedChunk.usage };
              }
            }
          } catch (e) {
            // ignore parse error
          }

          // Move buffer forward
          buffer = buffer.substring(end + 1);
          scannerIdx = 0; // Reset scanner since buffer shifted
        } else {
          // Not enough data for a full object, wait for next chunk
          scannerIdx = start + 1; // avoid infinite loop if malformed
          break;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
