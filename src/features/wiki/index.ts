export { WikiListView } from "./WikiListView";
export { WikiLogView } from "./WikiLogView";
export { WikiLintView } from "./WikiLintView";
export { WikiBanner } from "./WikiBanner";
export { KnowledgeStatusChip } from "./KnowledgeStatusChip";
export { IngestToast, type IngestToastState, type IngestToastItem } from "./IngestToast";
export {
  ingestNote, ingestFromUrl, ingestFromChat, ingestFromPdf, ingestFromMultiSource,
  extractPlainTextFromDoc,
  type MultiSourcePart,
  buildWikiDocument, mergeIntoWikiDocument, rewriteAndMerge,
  embedWikiSections, markEditedSections,
  // 横断更新
  fetchCrossUpdateProposals, applyCrossUpdate, extractWikiDetail, extractBodyPreview,
  // Lint（自動実行用）
  lintWikis, buildWikiSnapshots,
  // 構造化インデックス
  buildWikiIndex, formatWikiIndexForLLM,
  type WikiIndexEntry,
  // Synthesis
  fetchSynthesisCandidates, buildSynthesisDocument, buildConceptSnapshots,
  // Atom（実験的）
  atomizeConcepts, buildAtomDocument,
  // Discovery 共通: embedding ベース重複検出
  dedupCandidatesByEmbedding,
  // インライン引用リンク
  buildNoteIndex,
} from "./wiki-service";
export { retrieveWikiContext, setWikiTitleMap } from "./retriever";
export { wikiLog } from "./wiki-log";
export type { WikiLogEntry, WikiLogEventType } from "./wiki-log";
