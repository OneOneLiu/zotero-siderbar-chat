import { config } from "../../package.json";

export function registerPreferencePane() {
  Zotero.PreferencePanes.register({
    pluginID: config.addonID,
    src: "chrome://SidebarChat/content/preferences.xhtml",
    label: "Zotero Research Copilot",
    image: "chrome://SidebarChat/content/icons/favicon.png",
  });
}

