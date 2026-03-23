// ──────────────────────────────────────────────
// 暗黙的リンク: スコープ選択 → 新ページ作成時の自動リンク
//
// コンテキストスコープから新ページを作成した場合、
// 元スコープと新ページの間に derived_from リンクを
// created_by: 'system' で自動生成する
// ──────────────────────────────────────────────

import type { BlockLink, LinkType } from "./link-types";

/**
 * スコープから新ページ作成時に生成すべき自動リンクのパラメータを返す
 */
export function createAutoLinkParams(params: {
  /** 派生元のブロックID（スコープの見出しブロック） */
  sourceBlockId: string;
  /** 新ページの最初のブロックID（リンク先） */
  targetBlockId: string;
  /** 新ページのページID */
  targetPageId: string;
}): {
  sourceBlockId: string;
  targetBlockId: string;
  type: LinkType;
  createdBy: "system";
  targetPageId: string;
} {
  return {
    sourceBlockId: params.sourceBlockId,
    targetBlockId: params.targetBlockId,
    type: "derived_from",
    createdBy: "system",
    targetPageId: params.targetPageId,
  };
}
