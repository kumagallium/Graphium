// 出典照合（Source check, v1.1） — クライアント側の公開 API。
// 仕様: 知見（claim）とトピック（topic）の出典を原文照合し、wikiMeta.sourceCheck に記録する。
// 世界照合（world-grounding）と対になる別レーン。UI（実行ボタン・一覧列等）はスコープ外。

export {
  resolveSourceText,
  type ResolveSourceTextDeps,
  type ResolveSourceTextResult,
  type ResolvedSourceText,
  type UnresolvedSourceText,
  type SourceTextBlock,
} from "./resolve-source-text";
export {
  planSourceCheck,
  type PlanSourceCheckStatement,
  type SourceCheckGroup,
  type SourceCheckKnownMissing,
  type SourceCheckPlan,
} from "./plan";
export {
  runSourceCheck,
  type RunSourceCheckParams,
  type RunSourceCheckResult,
  type SourceCheckLogger,
} from "./run";
export { attachSourceCheck } from "./attach";
export { aggregateDocumentVerdict, aggregateVerdict } from "./aggregate";
export { computeClaimHash } from "./claim-hash";
export { findBlockIdForQuote } from "./quote-match";
export { extractTopicStatements, type TopicStatement } from "./topic-statements";
export { isAiAnswerClaim } from "./ai-answer";
export {
  buildSourceCheckStatements,
  type SourceCheckTarget,
} from "./build-statements";
export {
  callCheckSourcesApi,
  SourceCheckDegradedError,
  type CheckSourcesApiClaim,
  type CheckSourcesApiSource,
  type CheckSourcesApiResult,
  type CheckSourcesApiResultItem,
} from "./api";
export { saveSourceCheckResult, saveSourceCheckResults, type SaveSourceCheckDeps } from "./save";
export { pickNextUncheckedSource, useAutoSourceCheck } from "./use-auto-source-check";
export {
  buildNeedsReviewList,
  isNeedsReviewVerdict,
  NEEDS_REVIEW_VERDICT_ORDER,
  type NeedsReviewEntry,
  type NeedsReviewVerdict,
} from "./needs-review";
