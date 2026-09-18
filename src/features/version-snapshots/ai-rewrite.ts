// AI がナレッジページ（Wiki ドキュメント）の本文を書き換える直前に、
// 書き換え前の内容を版（スナップショット）として残すためのチョークポイント。
//
// 対象を絞る理由（決定 2026-09-18）:
// - スナップショットは本文を丸ごと保存するため、AI の改訂のたびに全ページで
//   取ると保存量が積み上がり、人が残した版も埋もれる
// - 「AI が作ったまま人が触っていないページ」は、AI がいつでも作り直せる
//   （そもそも「戻したい人の版」が存在しない）ので取る必要がない
// → 人が一度でも編集した来歴があるページに限って取る（hasHumanEditHistory）
//
// 呼び出し元: use-file-manager.ts の handleSaveWikiFile（Wiki 保存の唯一の
// チョークポイント）。topic-stage.ts / rewriteAndMerge / regenerateWikiById は
// すべてここを通るので、個別に仕込む必要はない。

import type { GraphiumDocument } from "../../lib/document-types";
import type { StorageProvider } from "../../lib/storage/types";
import type { EditActivityType } from "../document-provenance/types";
import { hasHumanEditHistory } from "../document-provenance/tracker";
import { takeSnapshot } from "./snapshot-store";

/**
 * 「本文を書き換える」AI 操作の activityType。
 * 新規生成（wiki_ingest / wiki_atomize）と、本文を変えない操作（wiki_reinforce）は含めない
 * — 書き換え対象の既存本文が無い/変わらないため、直前の版を残す意味がない。
 */
const AI_REWRITE_ACTIVITY_TYPES: ReadonlySet<EditActivityType> = new Set([
  "wiki_merge",
  "wiki_cross_update",
  "wiki_dedup_merge",
  "wiki_regenerate",
]);

/** activityType が「既存ページの本文を AI が書き換える」操作かどうか */
export function isAiRewriteActivity(
  activityType: EditActivityType | undefined,
): activityType is EditActivityType {
  return !!activityType && AI_REWRITE_ACTIVITY_TYPES.has(activityType);
}

/**
 * AI がナレッジページの本文を書き換える直前に、書き換え前の内容を版として残す。
 *
 * - `current`（書き換え前にキャッシュ済みの doc）が無い＝新規作成なので取らない
 * - activityType が書き換え系でなければ取らない（新規生成・reinforce 等）
 * - 人が編集した来歴が無いページでは取らない（AI が作ったまま人が触っていない）
 * - 直前の版と本文ハッシュが同じなら takeSnapshot 自身が "unchanged" を返し、増えない
 *
 * 例外は握りつぶして呼び出し元の保存を止めない（版が残せなくても本編の保存は続行する）。
 */
export async function snapshotBeforeAiRewrite(
  provider: StorageProvider,
  wikiId: string,
  current: GraphiumDocument | undefined,
  activityType: EditActivityType | undefined,
  label: string,
): Promise<void> {
  if (!current) return;
  if (!isAiRewriteActivity(activityType)) return;
  if (!hasHumanEditHistory(current.documentProvenance)) return;
  if (!provider.writeAppData || !provider.readAppData) return;
  try {
    await takeSnapshot(provider, wikiId, current, label, "ai_rewrite");
  } catch (e) {
    console.error("AI 書き換え前の版の作成に失敗:", e);
  }
}
