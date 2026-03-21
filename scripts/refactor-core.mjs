import fs from "fs";
const p = "src/modules/multiPaperChatCore.ts";
let s = fs.readFileSync(p, "utf8");
s = s.replaceAll('from "../modules/ragIndex"', 'from "./ragIndex"');
s = s.replaceAll('from "../modules/ragSearch"', 'from "./ragSearch"');

const pairs = [
  ["chatHistory.length", "C.chatHistory.length"],
  ["chatHistory.push", "C.chatHistory.push"],
  ["chatHistory.filter", "C.chatHistory.filter"],
  ["chatHistory.find", "C.chatHistory.find"],
  ["chatHistory.forEach", "C.chatHistory.forEach"],
  ["chatHistory =", "C.chatHistory ="],
  ["chatHistory[", "C.chatHistory["],
  ["analysisDoc =", "C.analysisDoc ="],
  ["questionUnderstandingDoc =", "C.questionUnderstandingDoc ="],
];
for (const [a, b] of pairs) s = s.split(a).join(b);

// savedNoteId — avoid replacing C.savedNoteId twice
s = s.replace(/\bsavedNoteId\b/g, "C.savedNoteId");

s = s.split("C.C.savedNoteId").join("C.savedNoteId");

const ragPairs = [
  ["ragIndices.has", "C.ragIndices.has"],
  ["ragIndices.get", "C.ragIndices.get"],
  ["ragIndices.set", "C.ragIndices.set"],
  ["ragIndices.delete", "C.ragIndices.delete"],
];
for (const [a, b] of ragPairs) s = s.split(a).join(b);
s = s.split("C.C.ragIndices.").join("C.ragIndices.");

s = s.replace(/\bstandaloneMode\b/g, "C.standaloneMode");
s = s.split("C.C.standaloneMode").join("C.standaloneMode");

s = s.replace(/\bstandaloneCollectionInfo\b/g, "C.standaloneCollectionInfo");
s = s.split("C.C.standaloneCollectionInfo").join("C.standaloneCollectionInfo");

s = s.replace(/\bsessionCreatedAt\b/g, "C.sessionCreatedAt");
s = s.split("C.C.sessionCreatedAt").join("C.sessionCreatedAt");

// analysisDoc / questionUnderstandingDoc remaining refs (not assignment)
s = s.replace(/\banalysisDoc\b/g, "C.analysisDoc");
s = s.split("C.C.analysisDoc").join("C.analysisDoc");
s = s.replace(/\bquestionUnderstandingDoc\b/g, "C.questionUnderstandingDoc");
s = s.split("C.C.questionUnderstandingDoc").join("C.questionUnderstandingDoc");

const paperPairs = [
  ["papers.forEach", "C.papers.forEach"],
  ["papers.filter", "C.papers.filter"],
  ["papers.find", "C.papers.find"],
  ["papers.some", "C.papers.some"],
  ["papers.map", "C.papers.map"],
  ["papers.push", "C.papers.push"],
  ["papers.splice", "C.papers.splice"],
  ["papers.length", "C.papers.length"],
  ["papers[", "C.papers["],
  ["papers =", "C.papers ="],
  ["of papers", "of C.papers"],
  ["(papers)", "(C.papers)"],
  ["(papers,", "(C.papers,"],
];
for (const [a, b] of paperPairs) s = s.split(a).join(b);
s = s.split("C.C.papers.").join("C.papers.");
s = s.split("C.C.papers[").join("C.papers[");

// chatHistory bare reference in map/filter chains
s = s.replace(/\bchatHistory\b/g, "C.chatHistory");
s = s.split("C.C.chatHistory").join("C.chatHistory");

fs.writeFileSync(p, s);
console.log("refactor-core done");
