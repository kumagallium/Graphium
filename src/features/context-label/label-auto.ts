// ──────────────────────────────────────────────
// ラベル自動設定ロジック
//
// 1. 箇条書きで Enter → 次行に同じラベルを継承
// 2. ラベル付き箇条書きをインデント → [属性] に変更
// 3. ブロック削除時 → 孤立ラベルをクリーンアップ
// ──────────────────────────────────────────────

import type { LabelStore } from "./store";
import type { LinkStore } from "../block-link/store";

// 継承対象のラベル（箇条書きで Enter → 空の次行にもコピーするラベル）
const INHERITABLE_LABELS = new Set([
  "material",
  "tool",
  "result",
  "attribute",
]);

// 分割時のみ継承するラベル（Enter でブロックが分割され、新ブロックにコンテンツがある場合のみ）
const SPLIT_ONLY_LABELS = new Set([
  "procedure",
]);

// インデント時に attribute に変換するラベル
const INDENT_TO_ATTRIBUTE_LABELS = new Set([
  "material",
  "tool",
  "result",
]);

/**
 * エディタの変更を監視してラベルの自動設定を行う。
 * editor.onChange のタイミングで呼び出す。
 *
 * 戻り値: cleanup 関数（不要）
 */
export function setupLabelAutoAssign(
  editor: any,
  labelStore: LabelStore,
  linkStore?: LinkStore,
) {
  // 前回のブロック構成を記録（新規ブロック検出用）
  let prevBlockIds = new Set<string>();
  // 前回のインデントレベルを記録
  let prevIndents = new Map<string, number>();
  // 前回のブロック内容を記録（先頭 Enter 検出用）
  let prevContents = new Map<string, boolean>(); // blockId → hasContent

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
    const currentContents = new Map<string, boolean>();
    allBlocks.forEach((b) => {
      currentIndents.set(b.block.id, b.depth);
      currentContents.set(b.block.id, blockHasContent(b.block));
    });

    // 0. 先頭 Enter 検出 → ラベル転送
    //    ラベル付きブロックが空になり、直後に新ブロック（コンテンツあり）がある場合、
    //    ラベルを空ブロックから新ブロックに移す
    for (let i = 0; i < allBlocks.length; i++) {
      const { block } = allBlocks[i];
      // 既存ブロック & ラベル付き & 以前はコンテンツがあったが今は空
      if (
        prevBlockIds.has(block.id) &&
        labelStore.labels.has(block.id) &&
        prevContents.get(block.id) &&
        !blockHasContent(block)
      ) {
        // 直後の新ブロックを探す
        const next = allBlocks[i + 1];
        if (next && !prevBlockIds.has(next.block.id) && blockHasContent(next.block)) {
          const label = labelStore.labels.get(block.id)!;
          const attrs = labelStore.attributes.get(block.id);
          labelStore.setLabel(block.id, null);
          labelStore.setLabel(next.block.id, label);
          if (attrs) {
            labelStore.setAttributes(next.block.id, attrs);
          }
          // リンクも新ブロックに転送
          linkStore?.transferLinks(block.id, next.block.id);
        }
      }
    }

    // 1. 新規ブロックの検出 → ラベル継承
    for (let i = 0; i < allBlocks.length; i++) {
      const { block, depth } = allBlocks[i];
      if (prevBlockIds.has(block.id)) continue; // 既存ブロック
      if (labelStore.labels.has(block.id)) continue; // 既にラベルあり

      // 箇条書き・段落・見出しブロックを対象
      if (
        block.type !== "bulletListItem" &&
        block.type !== "numberedListItem" &&
        block.type !== "paragraph" &&
        block.type !== "heading"
      ) continue;

      // 直前のブロック（同じ深さ）を探す
      const prev = findPrevSiblingAt(allBlocks, i, depth);
      if (!prev) continue;

      const prevLabel = labelStore.labels.get(prev.block.id);
      if (!prevLabel) continue;

      if (INHERITABLE_LABELS.has(prevLabel)) {
        // 箇条書きラベル: 空行でも継承（Enter で次行を追加するフロー）
        labelStore.setLabel(block.id, prevLabel);
      } else if (SPLIT_ONLY_LABELS.has(prevLabel) && blockHasContent(block)) {
        // 見出しラベル: 分割時（新ブロックにコンテンツあり）のみ継承
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
        labelStore.setLabel(block.id, "attribute");
      }
    }

    // 3. 削除されたブロックのラベル・リンクをクリーンアップ
    for (const blockId of prevBlockIds) {
      if (!currentBlockIds.has(blockId)) {
        if (labelStore.labels.has(blockId)) {
          labelStore.setLabel(blockId, null);
        }
        // 削除ブロックに関連するリンクも除去（孤立リンク防止）
        linkStore?.removeLinksForBlock(blockId);
      }
    }

    prevBlockIds = currentBlockIds;
    prevIndents = currentIndents;
    prevContents = currentContents;
  }

  // 初期状態を記録
  const allBlocks = flattenBlocks(editor.document);
  prevBlockIds = new Set(allBlocks.map((b) => b.block.id));
  allBlocks.forEach((b) => {
    prevIndents.set(b.block.id, b.depth);
    prevContents.set(b.block.id, blockHasContent(b.block));
  });

  return onDocChange;
}

/**
 * ブロックがテキストコンテンツを持つかどうかを判定する
 */
function blockHasContent(block: any): boolean {
  // BlockNote のブロックは content 配列にインラインコンテンツを持つ
  if (!block.content) return false;
  if (Array.isArray(block.content)) {
    return block.content.some((c: any) => c.text?.trim());
  }
  return false;
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
