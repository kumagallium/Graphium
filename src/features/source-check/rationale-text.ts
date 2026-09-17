// 出典照合（Source check, v1） — LLM を呼ばない verdict（source-missing / 応答欠落）の
// rationale 文言。SourceCheckEntry.rationale は「UI 言語」で 1〜2 文と定義されているため、
// サーバー側 fallbackRationale（source-check.ts）と対になる文言をクライアント側にも持つ。

import type { SourceMissingReason } from "../../lib/document-types";

const MISSING_REASON_JA: Record<SourceMissingReason, string> = {
  deleted: "出典がゴミ箱に入っている、または見つからないため原文を取り出せなかった。",
  "no-reference": "出典（AI チャット）が元の会話への参照キーを持っていないため原文を取り出せなかった。",
  unreadable: "出典の原文を読み出せなかった（URL の再取得や PDF・Word の抽出に失敗した）。",
  "unsupported-kind": "出典が原文照合に対応していない種別のため判定できなかった。",
  empty: "出典の原文が空だったため判定できなかった。",
  "ai-answer": "⌘K の回答から作った知見のため、回答そのものは残っておらず照合できなかった。",
  "not-recorded": "出典の記録が無いため照合できなかった。",
};

const MISSING_REASON_EN: Record<SourceMissingReason, string> = {
  deleted: "The source could not be found (it may be in the trash).",
  "no-reference": "The source (an AI chat) has no reference key back to the original conversation.",
  unreadable: "Could not read the source text (re-fetching the URL or extracting the PDF/Word file failed).",
  "unsupported-kind": "This source kind is not supported for source checking.",
  empty: "The source text was empty.",
  "ai-answer": "This claim was made from a Cmd-K answer, and the answer itself was not kept, so it could not be checked.",
  "not-recorded": "No source was recorded, so it could not be checked.",
};

/** verdict: "source-missing" のときの rationale（UI 言語） */
export function missingReasonRationale(reason: SourceMissingReason, language: string): string {
  return (language === "ja" ? MISSING_REASON_JA : MISSING_REASON_EN)[reason];
}

/** LLM 応答にこの知見が含まれていなかったとき（サーバー側 fallbackRationale と対） */
export function missingResponseRationale(language: string): string {
  return language === "ja"
    ? "判定が返らなかった（LLM の出力にこの知見が含まれていなかった）。"
    : "The model did not return a verdict for this claim.";
}
