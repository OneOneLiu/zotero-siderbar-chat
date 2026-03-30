import { config } from "../../package.json";

export function registerPreferencePane() {
  Zotero.PreferencePanes.register({
    pluginID: config.addonID,
    src: "chrome://ResearchCopilot/content/preferences.xhtml",
    label: config.uiName,
    image: "chrome://ResearchCopilot/content/icons/favicon.png",
  });
}

