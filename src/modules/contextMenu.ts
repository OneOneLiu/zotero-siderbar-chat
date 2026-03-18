import { config } from "../../package.json";
import Addon from "../addon";

const MENU_ID = "gemini-chat-multi-paper-analysis";

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
  Zotero.debug("[GeminiChat] Context menu item registered.");
}

export function unregisterContextMenu(win: Window) {
  const doc = win.document;
  if (!doc) return;
  const item = doc.getElementById(MENU_ID);
  if (item) item.remove();
  const sep = doc.getElementById(`${MENU_ID}-separator`);
  if (sep) sep.remove();
}
