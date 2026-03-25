import "./utils/abortPolyfill";
import { BasicTool } from "zotero-plugin-toolkit";
import Addon from "./addon";
import { config } from "../package.json";

// @ts-ignore
declare const _globalThis: any;

const basicTool = new BasicTool();

// @ts-ignore - Plugin instance is not typed
if (!basicTool.getGlobal("Zotero")[config.addonInstance]) {
  _globalThis.addon = new Addon();

  Zotero.debug(`[${config.addonName}] Loaded. Instance: ${config.addonInstance}`);

  // Register to Zotero object
  // @ts-ignore
  Zotero[config.addonInstance] = _globalThis.addon;

  if (_globalThis.addon.onload) {
    _globalThis.addon.onload();
  }
}

