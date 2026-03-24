import { config } from "../../package.json";

export function registerPreferencePane() {
  Zotero.PreferencePanes.register({
    pluginID: config.addonID,
    src: "chrome://SidebarChat/content/preferences.xhtml",
    label: config.uiName,
    image: "chrome://SidebarChat/content/icons/favicon.png",
  });
}

