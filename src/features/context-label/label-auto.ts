// ──────────────────────────────────────────────
// ラベル自動設定ロジック
//
// 1. 箇条書きで Enter → 次行に同じラベルを継承
// 2. ラベル付き箇条書きをインデント → [属性] に変更
// ──────────────────────────────────────────────

import type { LabelStore } from "./store";

// 継承対象のラベル（箇条書きで Enter した時に次行にコピーするラベル）
const INHERITABLE_LABELS = new Set([
  "[使用したもの]",
  "[結果]",
  "[属性]",
]);

// インデント時に [属性] に変換するラベル
const INDENT_TO_ATTRIBUTE_LABELS = new Set([
  "[使用したもの]",
  "[結果]",
]);

/**
 * エディタの変更を監視してラベルの自動設定を行う。
 * editor.onChange のタイミングで呼び出す。
 *
 * 戻り値: cleanup 関数（不要）
 */
export function setupLabelAutoAssign(
  editor: any,
  labelStore: LabelStore
) {
  // 前回のブロック構成を記録（新規ブロック検出用）
  let prevBlockIds = new Set<string>();
  // 前回のインデントレベルを記録
  let prevIndents = new Map<string, number>();

  function getBlockIndent(block: any): number {
    // BlockNote の nestingLevel を取得（親ブロックの深さ）
    // document 上のブロックは flat なので、children の深さで判定
    return 0; // BlockNote v0.x ではネストはブロックの children として表現
  }

  /**
   * エディタの全ブロックをフラットに走査する
   */
  function flattenBlocks(blocks: any[], depth = 0): { block: any; depth: number }[] {
    const result: { block: any; depth: number }[] = [];
    for (const block of blocks) {
      result.push({ block, depth });
      if (block.children?.length) {
        result.push(...flattenBlocks(block.children, depth + 1));
      }
    }
    return result;
  }

  function onDocChange() {
    const allBlocks = flattenBlocks(editor.document);
    const currentBlockIds = new Set(allBlocks.map((b) => b.block.id));
    const currentIndents = new Map<string, number>();
    allBlocks.forEach((b) => currentIndents.set(b.block.id, b.depth));

    // 1. 新規ブロックの検出 → ラベル継承
    for (let i = 0; i < allBlocks.length; i++) {
      const { block, depth } = allBlocks[i];
      if (prevBlockIds.has(block.id)) continue; // 既存ブロック
      if (labelStore.labels.has(block.id)) continue; // 既にラベルあり

      // 箇条書き系のブロックのみ対象
      if (block.type !== "bulletListItem" && block.type !== "numberedListItem") continue;

      // 直前のブロック（同じ深さ）を探す
      const prev = findPrevSiblingAt(allBlocks, i, depth);
      if (!prev) continue;

      const prevLabel = labelStore.labels.get(prev.block.id);
      if (prevLabel && INHERITABLE_LABELS.has(prevLabel)) {
        labelStore.setLabel(block.id, prevLabel);
      }
    }

    // 2. インデント変更の検出 → [属性] に変換
    for (const { block, depth } of allBlocks) {
      const prevDepth = prevIndents.get(block.id);
      if (prevDepth === undefined) continue; // 新規ブロック（上で処理済み）
      if (depth <= prevDepth) continue; // インデント増加なし

      const currentLabel = labelStore.labels.get(block.id);
      if (currentLabel && INDENT_TO_ATTRIBUTE_LABELS.has(currentLabel)) {
        labelStore.setLabel(block.id, "[属性]");
      }
    }

    prevBlockIds = currentBlockIds;
    prevIndents = currentIndents;
  }

  // 初期状態を記録
  const allBlocks = flattenBlocks(editor.document);
  prevBlockIds = new Set(allBlocks.map((b) => b.block.id));
  allBlocks.forEach((b) => prevIndents.set(b.block.id, b.depth));

  return onDocChange;
}

/**
 * allBlocks 配列で index の手前にある同じ depth のブロックを探す
 */
function findPrevSiblingAt(
  allBlocks: { block: any; depth: number }[],
  index: number,
  depth: number
): { block: any; depth: number } | null {
  for (let i = index - 1; i >= 0; i--) {
    if (allBlocks[i].depth === depth) return allBlocks[i];
    if (allBlocks[i].depth < depth) return null; // 親に到達 → 兄弟なし
  }
  return null;
}
