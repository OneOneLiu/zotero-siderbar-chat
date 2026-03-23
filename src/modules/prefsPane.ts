import { config } from "../../package.json";

export function registerPreferencePane() {
  Zotero.PreferencePanes.register({
    pluginID: config.addonID,
    src: "chrome://GeminiChat/content/preferences.xhtml",
    label: "Zotero Research Copilot",
    image: "chrome://GeminiChat/content/icons/favicon.png",
  });
}

