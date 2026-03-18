import { config } from "../../package.json";
import Addon from "../addon";
import { buildRagIndexForItem, hasRagIndex } from "./ragIndex";

const MENU_ID = "gemini-chat-multi-paper-analysis";
const RAG_MENU_ID = "gemini-chat-build-rag-index";

function findPdfAttachment(item: Zotero.Item): Zotero.Item | null {
  if (item.isAttachment() && item.attachmentContentType === "application/pdf") {
    return item;
  }
  if (item.isRegularItem()) {
    const attachmentIDs = item.getAttachments();
    for (const id of attachmentIDs) {
      const att = Zotero.Items.get(id);
      if (att && !att.isNote() && att.attachmentContentType === "application/pdf") {
        return att;
      }
    }
  }
  return null;
}

export function registerContextMenu(win: Window, addon: Addon) {
  const doc = win.document;
  if (!doc) return;

  const menu = doc.getElementById("zotero-itemmenu");
  if (!menu) {
    Zotero.debug("[GeminiChat] zotero-itemmenu not found, skipping context menu.");
    return;
  }

  if (doc.getElementById(MENU_ID)) return;

  const separator = doc.createXULElement("menuseparator");
  separator.id = `${MENU_ID}-separator`;
  menu.appendChild(separator);

  const menuItem = doc.createXULElement("menuitem");
  menuItem.id = MENU_ID;
  menuItem.setAttribute("label", "AI Multi-paper Analysis");
  menuItem.setAttribute("class", "menuitem-iconic");

  menuItem.addEventListener("command", () => {
    try {
      const zoteroPane = (win as any).ZoteroPane || Zotero.getActiveZoteroPane();
      if (!zoteroPane) return;

      const selectedItems: Zotero.Item[] = zoteroPane.getSelectedItems();
      if (!selectedItems || selectedItems.length === 0) {
        (win as any).alert("Please select at least one item.");
        return;
      }

      const papers: { id: number; title: string }[] = [];
      for (const item of selectedItems) {
        const pdf = findPdfAttachment(item);
        if (pdf) {
          const title = item.getField("title") ||
            pdf.parentItem?.getField("title") ||
            pdf.getField("title") ||
            "Untitled";
          papers.push({ id: item.id, title: String(title) });
        }
      }

      if (papers.length === 0) {
        (win as any).alert("No PDF attachments found in the selected items.");
        return;
      }

      const dataStr = encodeURIComponent(JSON.stringify(papers));

      win.openDialog(
        `chrome://${config.addonRef}/content/analysisDialog.xhtml`,
        "gemini-multi-paper-analysis",
        "chrome,centerscreen,resizable,width=900,height=700",
        dataStr,
      );

    } catch (e) {
      Zotero.debug(`[GeminiChat] Context menu handler error: ${e}`);
    }
  });

  menu.appendChild(menuItem);

  if (!doc.getElementById(RAG_MENU_ID)) {
    const ragItem = doc.createXULElement("menuitem");
    ragItem.id = RAG_MENU_ID;
    ragItem.setAttribute("label", "Build RAG Index");
    ragItem.setAttribute("class", "menuitem-iconic");

    ragItem.addEventListener("command", async () => {
      try {
        const zoteroPane = (win as any).ZoteroPane || Zotero.getActiveZoteroPane();
        if (!zoteroPane) return;

        const selectedItems: Zotero.Item[] = zoteroPane.getSelectedItems();
        if (!selectedItems || selectedItems.length === 0) {
          (win as any).alert("Please select at least one item.");
          return;
        }

        const items: Zotero.Item[] = [];
        for (const item of selectedItems) {
          const pdf = findPdfAttachment(item);
          if (pdf) items.push(item);
        }

        if (items.length === 0) {
          (win as any).alert("No PDF attachments found in the selected items.");
          return;
        }

        const total = items.length;
        let built = 0;
        let skipped = 0;
        let failed = 0;

        for (const item of items) {
          const title = String(item.getField("title") || "Untitled");
          try {
            const already = await hasRagIndex(item.id);
            if (already) {
              skipped++;
            } else {
              await buildRagIndexForItem(item);
              built++;
            }
          } catch (e: any) {
            failed++;
            Zotero.debug(`[GeminiChat] RAG index build failed for ${title}: ${e}`);
          }
        }

        let msg = `RAG Index Complete\n\n`;
        msg += `Total: ${total} paper(s)\n`;
        if (built > 0) msg += `New indices built: ${built}\n`;
        if (skipped > 0) msg += `Already indexed (skipped): ${skipped}\n`;
        if (failed > 0) msg += `Failed: ${failed}\n`;
        msg += `\nRAG indices are stored locally and will be reused automatically in multi-paper analysis.`;

        (win as any).alert(msg);

      } catch (e) {
        Zotero.debug(`[GeminiChat] RAG build handler error: ${e}`);
      }
    });

    menu.appendChild(ragItem);
  }

  Zotero.debug("[GeminiChat] Context menu items registered.");
}

export function unregisterContextMenu(win: Window) {
  const doc = win.document;
  if (!doc) return;
  for (const id of [MENU_ID, RAG_MENU_ID, `${MENU_ID}-separator`]) {
    const el = doc.getElementById(id);
    if (el) el.remove();
  }
}
