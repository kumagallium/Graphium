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
  extractBodyPreview,
  extractTopicOneLiner, formatTopicRefForIndex, consolidateTopics, retargetClaimTopicId,
  // Lint（自動実行用）
  lintWikis, buildWikiSnapshots,
  // 機械的な自動アーカイブ（LLM 不要）
  detectAutoArchivable, type AutoArchiveCandidate,
  // 構造化インデックス
  buildWikiIndex, formatWikiIndexForLLM,
  type WikiIndexEntry,
  // Claim snapshot 構築（Atomizer / Cmd-K Composer など downstream consumer 共通）
  buildClaimSnapshots, MAX_SNAPSHOTS_PER_RUN,
  // Atom（実験的）
  atomizeConcepts, buildAtomDocument, reinforceAtomWithClaims, filterSelfFromDerivedFromClaims,
  // Discovery 共通: embedding ベース重複検出（候補探し）+ LLM 判定（同じ/矛盾/別物）
  dedupCandidatesByEmbedding, partitionCandidatesByEmbedding,
  judgeAtomDuplicates, resolveAtomDuplicates,
  type AtomDuplicateVerdict, type AtomDuplicateJudgeVerdict, type AtomDuplicateResolution,
  // インライン引用リンク
  buildNoteIndex,
  // Topic（話題）
  normalizeTopicTitle, matchTopicsByTitle, resolveTopicsForClaim,
  linkClaimAndTopic, unlinkClaimFromTopic,
  composeTopicBody, buildTopicDocument, rebuildTopicDocument,
  type ExistingTopicRef, type TopicMatch, type TopicComposeClaim,
} from "./wiki-service";
export type { ClaimSnapshot } from "../../server/services/wiki-types";
export { retrieveWikiContext, setWikiTitleMap } from "./retriever";
export {
  type AtomCandidate,
  tokenize, jaccard, cosine, similarity,
  getDocEmbedding,
  buildClusterSlice, planCoverageSeeds, type CoveragePlan,
  rankCandidatesByRelevance, type RelevanceFeature,
} from "./sampling";
export { wikiLog } from "./wiki-log";
export type { WikiLogEntry, WikiLogEventType } from "./wiki-log";
export {
  saveLintBadgeSummary, markLintOpened, getLintBadgeState, shouldShowLintBadge,
  type LintBadgeSummary,
} from "./wiki-lint-badge";
export { runTopicStage, consolidateExistingTopics, planExistingTopicMerges, applyTopicMerges, mergeTopicsExplicit } from "./topic-stage";
export type {
  TopicStageClaimInput, TopicStageResult, TopicStageDeps,
  ExistingTopicForMerge, ConsolidateExistingTopicsResult, ConsolidateExistingTopicsDeps,
} from "./topic-stage";
