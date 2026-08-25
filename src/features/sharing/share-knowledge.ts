// Knowledge（Wiki）ページを team-shared storage に書き出す。
//
// share-note.ts と同じコピー semantics:
// - personal 側の Wiki は消さない（snapshot コピー）
// - Share 済み（doc.sharedRef あり）の再 Share は同じ id に上書き（minor 改訂）
// - body は GraphiumDocument の JSON シリアライズ（wikiMeta 込みで完全復元できる）
//
// ノートとの違い:
// - entry type は "knowledge" 1 本。内部分類（summary / claim / atom / synthesis）は
//   extra.wikiKind に持たせる。WikiKind は流動的な分類なので共有フォーマットの
//   語彙（フォルダ構造）には焼き込まない（前方互換、詳細は shared/types.ts）
// - derivedFromNotes 等のローカル ID は body にそのまま残る（コピー semantics）。
//   受け手の環境で解決できない問題は fork 側（fork-knowledge.ts）でリセットして吸収する

import type { GraphiumDocument } from "../../lib/document-types";
import {
  shareGraphiumDocument,
  type ShareNoteOptions,
  type ShareNoteResult,
} from "./share-note";

export type ShareKnowledgeOptions = ShareNoteOptions;
export type ShareKnowledgeResult = ShareNoteResult;

/**
 * Knowledge ページを shared に書き出し、`sharedRef` 付きの新しい
 * GraphiumDocument を返す。呼び出し側で戻り値の doc を saveWikiFile すること。
 */
export async function shareKnowledge(
  doc: GraphiumDocument,
  options: ShareKnowledgeOptions,
): Promise<ShareKnowledgeResult> {
  const wikiKind = doc.wikiMeta?.kind;
  if (!wikiKind) {
    return {
      ok: false,
      error: "Not a knowledge page (wikiMeta is missing)",
    };
  }
  return shareGraphiumDocument(doc, "knowledge", { wikiKind }, options);
}
