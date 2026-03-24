import type { RagIndex } from "./ragIndex";

export interface PaperInfo {
  id: number;
  title: string;
}

export interface ChatMsg {
  role: "user" | "model" | "system";
  text: string;
}

/** Mutable session shared by analysis iframe and reader sidebar (bound via bindChatContext). */
export interface ChatContext {
  papers: PaperInfo[];
  chatHistory: ChatMsg[];
  analysisDoc: string;
  questionUnderstandingDoc: string;
  savedNoteId: number | null;
  savedAttachmentId?: number;
  ragIndices: Map<number, RagIndex>;
  standaloneMode: boolean;
  standaloneCollectionInfo: { id?: number; name?: string };
  sessionCreatedAt: string;
}

export function createEmptyChatContext(): ChatContext {
  return {
    papers: [],
    chatHistory: [],
    analysisDoc: "",
    questionUnderstandingDoc: "",
    savedNoteId: null,
    savedAttachmentId: undefined,
    ragIndices: new Map(),
    standaloneMode: false,
    standaloneCollectionInfo: {},
    sessionCreatedAt: "",
  };
}
