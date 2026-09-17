// 出典照合（Source check, v1.1） — ⌘K Composer の回答から作った知見の判定。
//
// buildVerbSuggestionDocument（src/features/composer/verb-suggestion-doc.ts）で作った知見は
// generatedBy.sessionId が "verb-suggestion-" で始まる。derivedFromNotes は「回答を出した
// ノート」であって回答そのものは残っていないため、ノート本文と照合すると誤って
// 「見当たらない」判定になる。この関数はその知見を検出し、呼び出し側が LLM を呼ばずに
// source-missing / "ai-answer" として記録できるようにする（1-c）。

import type { GraphiumDocument } from "../../lib/document-types";

const VERB_SUGGESTION_SESSION_PREFIX = "verb-suggestion-";

/** doc が ⌘K の回答から「知見にする」で作った知見（claim）かどうか */
export function isAiAnswerClaim(doc: GraphiumDocument): boolean {
  const sessionId = doc.generatedBy?.sessionId;
  return typeof sessionId === "string" && sessionId.startsWith(VERB_SUGGESTION_SESSION_PREFIX);
}
