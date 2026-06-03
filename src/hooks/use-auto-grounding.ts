// 自動 world-grounding（opt-in / 既定 OFF / イベント駆動 / 直列 + レート制限）。
//
// 方針（会話 2026-06-02 / world-grounding 実験）:
// - 既存の "user-triggered only" を覆すので設定トグルで明示 opt-in（既定 OFF）。
// - 固定タイマーのポーリングではなく、wikiMetas（全 wiki サマリ）の変化に反応する
//   = 実質「洞察・知見が追加されたタイミング」で動く。作成サイトは複数あるが、
//   全経路が最終的に wikiMetas を更新するので、ここ 1 箇所で全部拾える + バックログも拾う。
// - 1 件照合 → checkedAt 付与 → wikiMetas 更新 → 次の未照合… と自己連鎖でドレイン。
//   直列（busy 中はスキップ）+ デバウンス（atomize の一括作成を coalesce）でバースト平準化。
// - 照合自体は既存 handleWorldCheckWiki(id, "background") を再利用（KB-first / ミス時 LLM）。

import { useEffect, useRef } from "react";
import type { WikiKind, WikiMetaSummary } from "../lib/document-types";

/** 自動照合の対象 kind。summary は対象外、synthesis（撤退済み）も除外。 */
const AUTO_GROUND_KINDS: ReadonlySet<WikiKind> = new Set<WikiKind>([
  "claim",
  "atom",
]);

/**
 * まだ世界照合していない（checkedAt が無い）洞察・知見のうち、最初の 1 件の wikiId を返す。
 * 無ければ null。純関数なのでテストしやすい。
 *
 * - summary / synthesis は対象外
 * - groundingValidity.checkedAt があるものは「照合済み」とみなしスキップ
 *   （マッチなし照合も checkedAt を持つので、無限に再照合しない）
 * - groundingValidity.dismissed があるものはユーザーが手動でクリアした印なのでスキップ
 *   （「手動で消した＝自動で付け直してほしくない」を尊重。手動照合では付け直せる）
 * - skip 集合に含まれる id はスキップ（このセッションで「ハード失敗」した id =
 *   保存例外などで checkedAt が付かなかったもの。ホットループ防止）
 */
export function pickNextUngrounded(
  wikiMetas: Map<string, WikiMetaSummary>,
  skip?: ReadonlySet<string>,
): string | null {
  for (const [wikiId, meta] of wikiMetas) {
    if (!AUTO_GROUND_KINDS.has(meta.kind)) continue;
    if (meta.groundingValidity?.checkedAt) continue;
    if (meta.groundingValidity?.dismissed) continue;
    if (skip?.has(wikiId)) continue;
    return wikiId;
  }
  return null;
}

/**
 * イベント駆動の自動 grounding。
 * enabled の間、wikiMetas / busy の変化に反応して未照合を 1 件だけ照合する。
 *
 * - 作成直後に wikiMetas が変わる → 短いデバウンス後に 1 件照合（≒ 追加タイミング駆動）
 * - busy（既に 1 件 in-flight）なら何もしない（直列化）
 * - 照合成功なら checkedAt が付くので自然にスキップされる（恒久）。
 *   ハード失敗（groundOne が reject = 保存例外等で checkedAt が付かない）した id だけ
 *   failedRef に積み、同一セッションでは再試行しない（ホットループ防止）。
 *   → 再生成で grounding が消えた id は failedRef に無いので、ちゃんと再照合される。
 */
export function useAutoGrounding(params: {
  enabled: boolean;
  /** 全 wiki サマリ。変化（新規作成 / checkedAt 付与）が再評価のトリガになる。 */
  wikiMetas: Map<string, WikiMetaSummary>;
  /** 既に 1 件照合中か（直列化のため） */
  busy: boolean;
  /** 1 件を照合する（既存 handleWorldCheckWiki を background trigger で呼ぶ） */
  groundOne: (wikiId: string) => Promise<void>;
  /** 一括作成を coalesce するデバウンス（ms）。既定 1.5s。 */
  debounceMs?: number;
}): void {
  const { enabled, wikiMetas, busy, groundOne, debounceMs = 1500 } = params;

  const groundRef = useRef(groundOne);
  groundRef.current = groundOne;
  // ハード失敗（reject）した id だけ記録（ホットループ防止）。成功は checkedAt で自然スキップ。
  const failedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled || busy) return;
    const next = pickNextUngrounded(wikiMetas, failedRef.current);
    if (!next) return;
    const id = setTimeout(() => {
      // 成功時は何も積まない（checkedAt 付与でスキップ）。reject 時だけ failed に積む。
      void groundRef.current(next).catch(() => {
        failedRef.current.add(next);
      });
    }, debounceMs);
    return () => clearTimeout(id);
  }, [enabled, busy, wikiMetas, debounceMs]);
}
