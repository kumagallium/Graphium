// ドキュメント差分計算
// 前回保存と現在の状態を比較して RevisionSummary を生成する

import type { RevisionSummary, BlockContentDiff } from "./types";
import type { ProvNotePage } from "../../lib/google-drive";

/** ブロックのテキスト内容を抽出 */
function blockTextContent(block: any): string {
  return Array.isArray(block.content)
    ? block.content.map((c: any) => c.text ?? "").join("")
    : "";
}

/** ブロックの内容をハッシュ的に比較するためのキー生成 */
function blockContentKey(block: any): string {
  const content = blockTextContent(block);
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
    const addedBlockIds = [...currentBlocks.keys()];
    const contentDiff: BlockContentDiff[] = [];
    for (const [id, block] of currentBlocks) {
      const text = blockTextContent(block);
      if (text) contentDiff.push({ blockId: id, type: "add", after: text });
    }
    return {
      blocksAdded: currentBlocks.size,
      blocksRemoved: 0,
      blocksModified: 0,
      addedBlockIds,
      removedBlockIds: [],
      modifiedBlockIds: [],
      contentDiff: contentDiff.length > 0 ? contentDiff : undefined,
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

  const addedBlockIds: string[] = [];
  const removedBlockIds: string[] = [];
  const modifiedBlockIds: string[] = [];
  const contentDiff: BlockContentDiff[] = [];

  for (const [id, block] of currentBlocks) {
    const prevBlock = prevBlocks.get(id);
    if (!prevBlock) {
      addedBlockIds.push(id);
      const text = blockTextContent(block);
      if (text) contentDiff.push({ blockId: id, type: "add", after: text });
    } else if (blockContentKey(block) !== blockContentKey(prevBlock)) {
      modifiedBlockIds.push(id);
      contentDiff.push({
        blockId: id,
        type: "modify",
        before: blockTextContent(prevBlock),
        after: blockTextContent(block),
      });
    }
  }

  for (const id of prevBlocks.keys()) {
    if (!currentBlocks.has(id)) {
      removedBlockIds.push(id);
      const text = blockTextContent(prevBlocks.get(id)!);
      if (text) contentDiff.push({ blockId: id, type: "remove", before: text });
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
    blocksAdded: addedBlockIds.length,
    blocksRemoved: removedBlockIds.length,
    blocksModified: modifiedBlockIds.length,
    addedBlockIds: addedBlockIds.length > 0 ? addedBlockIds : undefined,
    removedBlockIds: removedBlockIds.length > 0 ? removedBlockIds : undefined,
    modifiedBlockIds: modifiedBlockIds.length > 0 ? modifiedBlockIds : undefined,
    contentDiff: contentDiff.length > 0 ? contentDiff : undefined,
    labelsChanged: [...new Set(labelsChanged)],
    provLinksAdded,
    provLinksRemoved,
    knowledgeLinksAdded,
    knowledgeLinksRemoved,
  };
}

/** ページ全体の SHA-256 ハッシュを計算（改ざん検知用） */
export async function computePageHash(page: ProvNotePage): Promise<string> {
  const text = JSON.stringify({
    blocks: page.blocks,
    labels: page.labels,
    provLinks: page.provLinks,
    knowledgeLinks: page.knowledgeLinks,
  });
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
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
