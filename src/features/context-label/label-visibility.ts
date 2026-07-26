// ──────────────────────────────────────────────
// ブロック種別ごとに「ブロックラベルとして選べるコアラベル」を決める
//
// ラベルの付与 UI は 2 箇所ある:
//   - LabelDropdownPortal（# 追加フロー、ui.tsx）
//   - ProvPanel のラベル変更（バッジ → 変更、prov-indicator.tsx）
// 両者で同じフィルタを使うため、判定ロジックをここに一元化する。
//
// ルール（schema v5 以降）:
//   - 見出し: section / phase（procedure / plan / result）
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
 * 指定 blockId のブロックが step コンテナの中にあるかを DOM から判定する。
 * step の中では、計画/結果を「モード帯」として本文ブロックに付けられる
 * （帯の開始マーカー = plan / result ラベル。次の区切りまでがその帯）。
 */
export function isInsideStepBlock(blockId: string): boolean {
  if (typeof document === "undefined") return false;
  const wrapper =
    document.querySelector(`[data-id="${blockId}"]`) ??
    document.querySelector(`[data-prov-label-anchor="${blockId}"]`)?.closest("[data-id]");
  if (!wrapper) return false;
  // 自分自身が step の場合は「中」ではない
  if (wrapper.querySelector(':scope > .bn-block > .react-renderer.node-step')) return false;
  return !!wrapper.parentElement?.closest(
    '.bn-block:has(> .react-renderer.node-step)',
  );
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
  // step の中の本文ブロックには phase（計画/結果）だけ付けられる。
  // これがモード帯の開始マーカーになる（section = 工程は step 自体が担うので出さない）。
  const insideStep = !heading && isInsideStepBlock(blockId);
  const allowedScopes = heading
    ? new Set(["section", "phase"])
    : insideStep
      ? new Set(["phase"])
      : new Set<string>();
  return CORE_LABELS.filter((label) => {
    if (allowedScopes.has(LABEL_SCOPE[label])) return true;
    // テーブルは構造テーブルとして entity 系ラベルをブロックラベルで付与できる
    if (table && TABLE_BLOCK_LABELS.includes(label)) return true;
    // 既存の inline-type ラベルが付いている場合は、外せるように現在のラベルだけ残す
    if (currentLabel === label) return true;
    return false;
  });
}
