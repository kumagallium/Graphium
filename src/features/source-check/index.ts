// 出典照合（Source check, v1） — クライアント側の公開 API。
// 仕様: 知見（claim）の出典（derivedFromNotes）を原文照合し、wikiMeta.sourceCheck に記録する。
// 世界照合（world-grounding）と対になる別レーン。UI（実行ボタン・一覧列等）はスコープ外。

export {
  resolveSourceText,
  type ResolveSourceTextDeps,
  type ResolveSourceTextResult,
  type ResolvedSourceText,
  type UnresolvedSourceText,
  type SourceTextBlock,
} from "./resolve-source-text";
export { planSourceCheck, type PlanSourceCheckClaim, type SourceCheckGroup, type SourceCheckPlan } from "./plan";
export {
  runSourceCheck,
  type RunSourceCheckClaim,
  type RunSourceCheckParams,
  type RunSourceCheckResult,
  type SourceCheckLogger,
} from "./run";
export { attachSourceCheck } from "./attach";
export { aggregateVerdict } from "./aggregate";
export { computeClaimHash } from "./claim-hash";
export { findBlockIdForQuote } from "./quote-match";
export {
  callCheckSourcesApi,
  SourceCheckDegradedError,
  type CheckSourcesApiClaim,
  type CheckSourcesApiSource,
  type CheckSourcesApiResult,
  type CheckSourcesApiResultItem,
} from "./api";
export { saveSourceCheckResult, saveSourceCheckResults, type SaveSourceCheckDeps } from "./save";
