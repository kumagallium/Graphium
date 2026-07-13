export { WikiListView } from "./WikiListView";
export { WikiLogView } from "./WikiLogView";
export { WikiLintView } from "./WikiLintView";
export { WikiBanner, WikiContextDrawer } from "./WikiBanner";
export { KnowledgeStatusChip } from "./KnowledgeStatusChip";
export {
  IngestToast,
  type IngestToastState,
  type IngestToastItem,
  type IngestStage,
  type IngestStageStatus,
} from "./IngestToast";
export {
  ingestNote, ingestFromUrl, ingestFromChat, ingestFromPdf, ingestFromDocx, ingestFromMultiSource,
  extractPlainTextFromDoc,
  type MultiSourcePart,
  buildWikiDocument, mergeIntoWikiDocument, rewriteAndMerge,
  promoteClaimStatusIfCorroborated,
  embedWikiSections, markEditedSections,
  // 横断更新
  fetchCrossUpdateProposals, applyCrossUpdate, extractWikiDetail, extractBodyPreview,
  // Lint（自動実行用）
  lintWikis, buildWikiSnapshots,
  // 構造化インデックス
  buildWikiIndex, formatWikiIndexForLLM,
  type WikiIndexEntry,
  // Claim snapshot 構築（Atomizer / Cmd-K Composer など downstream consumer 共通）
  buildClaimSnapshots, MAX_SNAPSHOTS_PER_RUN,
  // Atom（実験的）
  atomizeConcepts, buildAtomDocument,
  // Discovery 共通: embedding ベース重複検出
  dedupCandidatesByEmbedding,
  // インライン引用リンク
  buildNoteIndex,
} from "./wiki-service";
export type { ClaimSnapshot } from "../../server/services/wiki-types";
export { retrieveWikiContext, setWikiTitleMap } from "./retriever";
export {
  type AtomCandidate,
  tokenize, jaccard, cosine, similarity,
  getDocEmbedding,
  pickFarthestSeeds, buildClusterSlice, pickClusterCount,
  rankCandidatesByRelevance, type RelevanceFeature,
} from "./sampling";
export { wikiLog } from "./wiki-log";
export type { WikiLogEntry, WikiLogEventType } from "./wiki-log";
