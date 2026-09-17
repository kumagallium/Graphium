// 出典照合（Source check, v1.1）の自動実行（opt-in / 既定 OFF / イベント駆動 / 直列 +
// デバウンス）。use-auto-grounding.ts（自動 world-grounding）と同じ作りにする。
//
// - 固定タイマーのポーリングではなく、wikiMetas（全 wiki サマリ）の変化に反応する。
// - 対象は kind が claim / topic で、まだ出典照合の結果（WikiMetaSummary.sourceCheckVerdict）
//   が無く、dismissed でないもの。sourceCheckVerdict は結果が付くと必ず現れるフィールドで、
//   dismissed はその内側にしか存在しないため、「結果が無い」判定だけで両方をカバーできる。
// - 本文を書き換える取り込み（merge / rewrite / トピック再構成）は
//   attachSourceCheck(doc, undefined) で sourceCheck を消すので、再び対象になる。
// - 実行は runOne（use-source-check.ts）を使う。runOne は 1 件実行・手動一括実行と
//   同じ排他ガード（runningRef）を共有するため、ここでは「busy なら何もしない」で
//   直列化するだけでよい（衝突時に壊すことはない）。

import { useEffect, useRef } from "react";
import type { WikiKind, WikiMetaSummary } from "../../lib/document-types";

/** 自動出典照合の対象 kind。summary / atom / synthesis は対象外。 */
const AUTO_SOURCE_CHECK_KINDS: ReadonlySet<WikiKind> = new Set<WikiKind>(["claim", "topic"]);

/**
 * まだ出典照合していない（sourceCheckVerdict が無い）知見・トピックのうち、
 * 最初の 1 件の wikiId を返す。無ければ null。純関数なのでテストしやすい。
 *
 * - claim / topic 以外は対象外
 * - sourceCheckVerdict があるものは「照合済み」とみなしスキップする
 *   （dismissed はこのフィールドの内側にしか無いため、これだけで両方カバーできる）
 * - skip 集合に含まれる id はスキップ（このセッションでハード失敗した id。ホットループ防止）
 */
export function pickNextUncheckedSource(
  wikiMetas: Map<string, WikiMetaSummary>,
  skip?: ReadonlySet<string>,
): string | null {
  for (const [wikiId, meta] of wikiMetas) {
    if (!AUTO_SOURCE_CHECK_KINDS.has(meta.kind)) continue;
    if (meta.sourceCheckVerdict) continue;
    if (skip?.has(wikiId)) continue;
    return wikiId;
  }
  return null;
}

/**
 * イベント駆動の自動出典照合。
 * enabled の間、wikiMetas / busy の変化に反応して未照合を 1 件だけ照合する。
 *
 * - 作成・更新直後に wikiMetas が変わる → 短いデバウンス後に 1 件照合
 * - busy（手動の 1 件照合・一括照合、または既にこのフックで in-flight）なら何もしない
 *   （runOne 自体も同じ排他ガードを共有するので、二重に衝突することは無い）
 * - 照合成功なら sourceCheckVerdict が付くので自然にスキップされる（恒久）。
 *   ハード失敗（checkOne が reject）した id だけ failedRef に積み、同一セッションでは
 *   再試行しない（ホットループ防止）。
 */
export function useAutoSourceCheck(params: {
  enabled: boolean;
  /** 全 wiki サマリ。変化（新規作成 / sourceCheckVerdict 付与・消去）が再評価のトリガになる。 */
  wikiMetas: Map<string, WikiMetaSummary>;
  /** 既に出典照合が実行中か（手動 1 件・一括・このフック自身のいずれか） */
  busy: boolean;
  /** 1 件を照合する（use-source-check.ts の runOne を渡す想定） */
  checkOne: (wikiId: string) => Promise<void>;
  /** 一括作成を coalesce するデバウンス（ms）。既定 1.5s。 */
  debounceMs?: number;
}): void {
  const { enabled, wikiMetas, busy, checkOne, debounceMs = 1500 } = params;

  const checkRef = useRef(checkOne);
  checkRef.current = checkOne;
  // ハード失敗（reject）した id だけ記録（ホットループ防止）。成功は sourceCheckVerdict で自然スキップ。
  const failedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled || busy) return;
    const next = pickNextUncheckedSource(wikiMetas, failedRef.current);
    if (!next) return;
    const id = setTimeout(() => {
      void checkRef.current(next).catch(() => {
        failedRef.current.add(next);
      });
    }, debounceMs);
    return () => clearTimeout(id);
  }, [enabled, busy, wikiMetas, debounceMs]);
}
