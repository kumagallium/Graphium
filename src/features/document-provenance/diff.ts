// ドキュメント差分計算
// 前回保存と現在の状態を比較して RevisionSummary を生成する

import type { RevisionSummary } from "./types";
import type { ProvNotePage } from "../../lib/google-drive";

/** ブロックの内容をハッシュ的に比較するためのキー生成 */
function blockContentKey(block: any): string {
  // テキストブロックの場合は content を文字列化
  const content = Array.isArray(block.content)
    ? block.content.map((c: any) => c.text ?? "").join("")
    : "";
  const props = block.props ? JSON.stringify(block.props) : "";
  return `${block.type}:${content}:${props}`;
}

/** フラット化されたブロック ID セットを取得 */
function collectBlockIds(blocks: any[]): Map<string, any> {
  const map = new Map<string, any>();
  for (const block of blocks) {
    map.set(block.id, block);
    if (block.children && Array.isArray(block.children)) {
      for (const [id, child] of collectBlockIds(block.children)) {
        map.set(id, child);
      }
    }
  }
  return map;
}

/** 2つのページ状態を比較して RevisionSummary を生成 */
export function computeRevisionSummary(
  prevPage: ProvNotePage | null,
  currentPage: ProvNotePage,
): RevisionSummary {
  if (!prevPage) {
    // 初回保存: 全ブロックが新規
    const currentBlocks = collectBlockIds(currentPage.blocks);
    return {
      blocksAdded: currentBlocks.size,
      blocksRemoved: 0,
      blocksModified: 0,
      labelsChanged: Object.keys(currentPage.labels),
      provLinksAdded: currentPage.provLinks.length,
      provLinksRemoved: 0,
      knowledgeLinksAdded: currentPage.knowledgeLinks.length,
      knowledgeLinksRemoved: 0,
    };
  }

  // ブロック差分
  const prevBlocks = collectBlockIds(prevPage.blocks);
  const currentBlocks = collectBlockIds(currentPage.blocks);

  let blocksAdded = 0;
  let blocksRemoved = 0;
  let blocksModified = 0;

  for (const [id, block] of currentBlocks) {
    const prevBlock = prevBlocks.get(id);
    if (!prevBlock) {
      blocksAdded++;
    } else if (blockContentKey(block) !== blockContentKey(prevBlock)) {
      blocksModified++;
    }
  }

  for (const id of prevBlocks.keys()) {
    if (!currentBlocks.has(id)) {
      blocksRemoved++;
    }
  }

  // ラベル差分
  const labelsChanged: string[] = [];
  const prevLabels = prevPage.labels;
  const currentLabels = currentPage.labels;
  const allLabelBlockIds = new Set([
    ...Object.keys(prevLabels),
    ...Object.keys(currentLabels),
  ]);
  for (const blockId of allLabelBlockIds) {
    if (prevLabels[blockId] !== currentLabels[blockId]) {
      labelsChanged.push(currentLabels[blockId] ?? prevLabels[blockId]);
    }
  }

  // リンク差分
  const prevProvIds = new Set(prevPage.provLinks.map((l: any) => l.id));
  const currentProvIds = new Set(currentPage.provLinks.map((l: any) => l.id));
  const prevKnowledgeIds = new Set(prevPage.knowledgeLinks.map((l: any) => l.id));
  const currentKnowledgeIds = new Set(currentPage.knowledgeLinks.map((l: any) => l.id));

  let provLinksAdded = 0;
  let provLinksRemoved = 0;
  let knowledgeLinksAdded = 0;
  let knowledgeLinksRemoved = 0;

  for (const id of currentProvIds) {
    if (!prevProvIds.has(id)) provLinksAdded++;
  }
  for (const id of prevProvIds) {
    if (!currentProvIds.has(id)) provLinksRemoved++;
  }
  for (const id of currentKnowledgeIds) {
    if (!prevKnowledgeIds.has(id)) knowledgeLinksAdded++;
  }
  for (const id of prevKnowledgeIds) {
    if (!currentKnowledgeIds.has(id)) knowledgeLinksRemoved++;
  }

  return {
    blocksAdded,
    blocksRemoved,
    blocksModified,
    labelsChanged: [...new Set(labelsChanged)],
    provLinksAdded,
    provLinksRemoved,
    knowledgeLinksAdded,
    knowledgeLinksRemoved,
  };
}

/** RevisionSummary が「変更なし」かどうかを判定 */
export function isEmptySummary(summary: RevisionSummary): boolean {
  return (
    summary.blocksAdded === 0 &&
    summary.blocksRemoved === 0 &&
    summary.blocksModified === 0 &&
    summary.labelsChanged.length === 0 &&
    summary.provLinksAdded === 0 &&
    summary.provLinksRemoved === 0 &&
    summary.knowledgeLinksAdded === 0 &&
    summary.knowledgeLinksRemoved === 0
  );
}
