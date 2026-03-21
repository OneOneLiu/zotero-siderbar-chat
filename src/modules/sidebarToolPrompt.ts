/**
 * Sidebar chat: inject the same style of tool descriptions as the analysis / tool window,
 * without importing multiPaperChatCore (keeps main bundle small).
 * Models only see this as plain text — no tool execution in the reader sidebar.
 */

import { config } from "../../package.json";

const PFX = config.prefsPrefix;

const ALL_TOOL_NAMES = [
  "load_paper_fulltext", "rag_deep_search", "get_paper_metadata",
  "get_item_notes", "get_item_annotations",
  "list_collections", "list_collection_items", "search_library",
  "get_items_by_tag", "list_tags",
  "get_item_collections", "get_related_items", "get_item_details",
  "get_collection_tag_stats", "get_collection_stats", "get_recent_items",
  "remove_paper", "add_paper_to_analysis", "rebuild_paper_rag",
] as const;

export function getEnabledToolNamesForSidebar(): Set<string> {
  try {
    const raw = Zotero.Prefs.get(`${PFX}.enabledTools`, true) as string;
    if (raw) {
      const saved = new Set(JSON.parse(raw) as string[]);
      for (const t of ALL_TOOL_NAMES) {
        if (!saved.has(t)) saved.add(t);
      }
      return saved;
    }
  } catch {
    /* ignore */
  }
  return new Set(ALL_TOOL_NAMES);
}

function loadUserPreferenceTools(): { name: string; description: string }[] {
  try {
    const raw = Zotero.Prefs.get(`${PFX}.userPreferences`, true) as string;
    if (!raw) return [];
    const arr = JSON.parse(raw) as { id: string; description: string }[];
    return Array.isArray(arr)
      ? arr.map((p) => ({ name: `pref_${p.id}`, description: p.description || "" }))
      : [];
  } catch {
    return [];
  }
}

/** Mirrors multiPaperChatCore.buildToolContextPrompt structure; paper_index refers to attached PDFs below. */
export function buildSidebarToolContextPrompt(paperTitles: string[]): string {
  const enabled = getEnabledToolNamesForSidebar();
  const prefTools = loadUserPreferenceTools();

  let ctx = `## Available tools (Zotero plugin)\n`;
  ctx += `In this **reader sidebar**, tools are **not executed automatically**; answer using the attached document text below. `;
  ctx += `The list below matches the multi-paper analysis window so you know what the user can do elsewhere in Zotero.\n\n`;

  if (paperTitles.length > 0) {
    const paperLines = paperTitles.map((t, i) => `  ${i + 1}. "${t}"`).join("\n");
    ctx += `Attached PDFs in this message (paper_index is 1-based when using the analysis window):\n${paperLines}\n\n`;
  } else {
    ctx += `No PDF attached to this message. In the analysis window, the user can use search_library / list_collection_items / add_paper_to_analysis to load papers.\n\n`;
  }

  const analysisTools: string[] = [];
  const libraryTools: string[] = [];
  const mgmtTools: string[] = [];

  if (enabled.has("load_paper_fulltext")) analysisTools.push("load_paper_fulltext(paper_index) — load paper full text for detailed reading");
  if (enabled.has("rag_deep_search")) analysisTools.push("rag_deep_search(query, paper_index?) — keyword search in papers, omit paper_index to search all");
  if (enabled.has("get_paper_metadata")) analysisTools.push("get_paper_metadata(paper_index) — authors, year, journal, DOI, abstract");
  if (enabled.has("get_item_notes")) analysisTools.push("get_item_notes(paper_index) — user-created notes attached to paper");
  if (enabled.has("get_item_annotations")) analysisTools.push("get_item_annotations(paper_index) — PDF highlights and annotations with page numbers");
  if (enabled.has("get_item_collections")) analysisTools.push("get_item_collections(paper_index) — which collections this paper belongs to");
  if (enabled.has("get_related_items")) analysisTools.push("get_related_items(paper_index) — Zotero-linked related items");

  if (enabled.has("list_collections")) libraryTools.push("list_collections() — list Zotero collection hierarchy");
  if (enabled.has("list_collection_items")) libraryTools.push("list_collection_items(collection_id or collection_name) — list items in a collection");
  if (enabled.has("search_library")) libraryTools.push("search_library(query, limit?) — search library by title/author/year");
  if (enabled.has("get_items_by_tag")) libraryTools.push("get_items_by_tag(tag) — find items by exact tag name");
  if (enabled.has("list_tags")) libraryTools.push("list_tags(filter?) — list all tags with item counts");
  if (enabled.has("get_item_details")) libraryTools.push("get_item_details(item_id) — full metadata for any item by ID");
  if (enabled.has("get_collection_tag_stats")) libraryTools.push("get_collection_tag_stats(collection_id?, collection_name?, limit?) — tag frequency in a collection");
  if (enabled.has("get_collection_stats")) libraryTools.push("get_collection_stats(collection_id?, collection_name?) — summary stats for a collection");
  if (enabled.has("get_recent_items")) libraryTools.push("get_recent_items(days?, limit?) — recently added items");

  if (enabled.has("remove_paper")) mgmtTools.push("remove_paper(paper_index) — remove paper from analysis session");
  if (enabled.has("add_paper_to_analysis")) mgmtTools.push("add_paper_to_analysis(item_id) — add Zotero item by ID, builds RAG");
  if (enabled.has("rebuild_paper_rag")) mgmtTools.push("rebuild_paper_rag(paper_index) — rebuild search index");

  if (analysisTools.length) ctx += "**Paper tools:**\n" + analysisTools.map((t) => `- ${t}`).join("\n") + "\n";
  if (libraryTools.length) ctx += "**Library tools:**\n" + libraryTools.map((t) => `- ${t}`).join("\n") + "\n";
  if (mgmtTools.length) ctx += "**Management tools:**\n" + mgmtTools.map((t) => `- ${t}`).join("\n") + "\n";

  if (prefTools.length > 0) {
    ctx += "\n**User response preferences** (analysis window): if a topic matches, the dedicated assistant can load these style guides.\n";
    for (const pt of prefTools) {
      ctx += `- ${pt.name}() — ${pt.description}\n`;
    }
  }

  return ctx.trimEnd();
}
