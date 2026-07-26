// ──────────────────────────────────────────────
// ブロック種別ごとに「ブロックラベルとして選べるコアラベル」を決める
//
// ラベルの付与 UI は 2 箇所ある:
//   - LabelDropdownPortal（ui.tsx）
//   - ProvPanel のラベル変更（バッジ → 変更、prov-indicator.tsx）
// 両者で同じフィルタを使うため、判定ロジックをここに一元化する。
//
// ルール:
//   - section / phase（procedure / plan / result）の新規付与は無い。
//     工程は step ブロックが表し、計画/結果は撤回した（旧ノートのみ legacy）。
//   - テーブル: material / tool / output（構造テーブルとして列=属性キー・行=Entity に展開）
//             + attribute（パラメータテーブルとして列=key・値を手順/親 Entity の params に展開）
//   - その他の本文ブロック: コアラベルなし（entity 系はインラインハイライト経路で付与）
//   - いずれの場合も、既に付いている現在のラベルは外せるよう残す
// ──────────────────────────────────────────────

import { CORE_LABELS, LABEL_SCOPE, type CoreLabel } from "./labels";

/**
 * 指定 blockId のブロックが見出し（heading）かを DOM から判定する。
 * BlockNote は h1-h6 を heading ブロック種別として描画するので、
 * data-id 属性のラッパー内に h1-h6 タグがあれば heading とみなす。
 */
export function isHeadingBlock(blockId: string): boolean {
  if (typeof document === "undefined") return false;
  const wrapper =
    document.querySelector(`[data-id="${blockId}"]`) ??
    document.querySelector(`[data-prov-label-anchor="${blockId}"]`)?.closest("[data-id]");
  if (!wrapper) return false;
  return !!wrapper.querySelector("h1, h2, h3, h4, h5, h6");
}

/**
 * 指定 blockId のブロックがテーブルかを DOM から判定する。
 * BlockNote のテーブルブロックはラッパー内に <table> を描画する。
 */
export function isTableBlock(blockId: string): boolean {
  if (typeof document === "undefined") return false;
  const wrapper =
    document.querySelector(`[data-id="${blockId}"]`) ??
    document.querySelector(`[data-prov-label-anchor="${blockId}"]`)?.closest("[data-id]");
  if (!wrapper) return false;
  return !!wrapper.querySelector("table");
}

/**
 * テーブルにブロックラベルとして付与できるラベル。
 * - material / tool / output: generator が parseStructuredTable で
 *   「列見出し=属性キー / 行=Entity」に展開する（構造テーブル）。
 * - attribute: generator が parseParameterTable で「列見出し=key / データ行=値」を
 *   手順（Activity）または親 Entity の params に展開する（パラメータテーブル）。
 */
export const TABLE_BLOCK_LABELS: CoreLabel[] = ["material", "tool", "output", "attribute"];

/**
 * 指定ブロックでブロックラベルとして選択できるコアラベルを返す。
 */
export function getVisibleCoreLabels(
  blockId: string,
  currentLabel: string | undefined,
): CoreLabel[] {
  const heading = isHeadingBlock(blockId);
  const table = !heading && isTableBlock(blockId);
  // section / phase をここから新規に付ける導線は無い（工程は step ブロックが表す。
  // 計画/結果の帯は検討の上で撤回した）。既存ラベルは currentLabel 経由で外せる。
  const allowedScopes = new Set<string>();
  return CORE_LABELS.filter((label) => {
    if (allowedScopes.has(LABEL_SCOPE[label])) return true;
    // テーブルは構造テーブルとして entity 系ラベルをブロックラベルで付与できる
    if (table && TABLE_BLOCK_LABELS.includes(label)) return true;
    // 既存の inline-type ラベルが付いている場合は、外せるように現在のラベルだけ残す
    if (currentLabel === label) return true;
    return false;
  });
}
