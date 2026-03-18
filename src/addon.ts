import { config } from "../package.json";
import { registerPreferencePane } from "./modules/prefsPane";
import { registerReaderPane, registerSidebarButton } from "./modules/readerPane";
import { registerContextMenu } from "./modules/contextMenu";

export type ChatMessage = {
  role: "user" | "model" | "system";
  text: string;
  at: number;
  meta?: {
    duration?: number;
  };
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
};

class Addon {
  public data: {
    config: typeof config;
    paneKey: string;
    sessions: Record<string, ChatMessage[]>;
    noteIDs: Record<string, number>;
    contextItems: Record<string, Zotero.Item[]>;
    busy: Record<string, boolean>;
  };

  constructor() {
    this.data = {
      config,
      paneKey: "",
      sessions: {},
      noteIDs: {},
      contextItems: {},
      busy: {},
    };
  }

  public async onload(): Promise<void> {
    Zotero.debug(`[${config.addonName}] Initializing...`);
    await Promise.all([
      Zotero.initializationPromise,
      Zotero.unlockPromise,
      Zotero.uiReadyPromise,
    ]);

    // Load locale for existing windows
    Zotero.getMainWindows().forEach((win) => {
      this.onMainWindowLoad(win);
    });

    registerPreferencePane();
    this.data.paneKey = registerReaderPane(this);
    registerSidebarButton(() => this.data.paneKey);

    Zotero.debug(`[${config.addonName}] Ready`);
  }

  public onMainWindowLoad(win: Window) {
    registerContextMenu(win, this);
  }

  public getSession(key: string): ChatMessage[] {
    if (!this.data.sessions[key]) {
      this.data.sessions[key] = [];
    }
    return this.data.sessions[key];
  }

  public pushMessage(key: string, message: ChatMessage) {
    const session = this.getSession(key);
    session.push(message);
  }

  public setBusy(key: string, value: boolean) {
    this.data.busy[key] = value;
  }

  public getNoteID(key: string): number | undefined {
    return this.data.noteIDs[key];
  }

  public setNoteID(key: string, id: number) {
    this.data.noteIDs[key] = id;
  }

  public isBusy(key: string): boolean {
    return !!this.data.busy[key];
  }

  public getContextItems(key: string): Zotero.Item[] {
    if (!this.data.contextItems[key]) {
      this.data.contextItems[key] = [];
    }
    return this.data.contextItems[key];
  }

  public addContextItem(key: string, item: Zotero.Item) {
    const items = this.getContextItems(key);
    if (!items.find((i) => i.id === item.id)) {
      items.push(item);
    }
  }

  public removeContextItem(key: string, itemID: number) {
    const items = this.getContextItems(key);
    this.data.contextItems[key] = items.filter((i) => i.id !== itemID);
  }

  public clearContextItems(key: string) {
    this.data.contextItems[key] = [];
  }
}

export default Addon;

