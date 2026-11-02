// ドキュメント差分計算
// 前回保存と現在の状態を比較して RevisionSummary を生成する

import type { RevisionSummary, BlockContentDiff } from "./types";
import type { GraphiumPage } from "../../lib/document-types";
import { blockToPlainText } from "../prov-generator/plain-text";

/** contentDiff の text を 1 ブロックあたりこの字数で切る（表・calc は巨大になり得るため） */
export const CONTENT_DIFF_MAX_CHARS = 2000;

/** 上限を超えた text は切って末尾に「…」を付ける */
function clipText(text: string): string {
  return text.length > CONTENT_DIFF_MAX_CHARS ? `${text.slice(0, CONTENT_DIFF_MAX_CHARS)}…` : text;
}

/** ブロックのテキスト内容を抽出（表・数式・リンクも平文になる。長いものは切る） */
function blockTextContent(block: any): string {
  return clipText(blockToPlainText(block));
}

/** BlockNote が既定値として持つ props（比較から除く） */
const DEFAULT_PROPS: Record<string, unknown> = {
  textColor: "default",
  backgroundColor: "default",
  textAlignment: "left",
  colspan: 1,
  rowspan: 1,
};

/** キー順を揃えた JSON 化（オブジェクトのキー順の違いを吸収する） */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * props から未設定・既定値を除く。
 * dropFalsy: inline content 用。後から足された prop（inlineImage の width など）は
 * 旧データに無く、BlockNote が読み込み後に既定値（""・0・false）を補うため、falsy を落として比べる
 */
function normalizeProps(props: unknown, dropFalsy = false): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!props || typeof props !== "object") return out;
  for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
    if (v === undefined || v === null) continue;
    if (dropFalsy && (v === "" || v === 0 || v === false)) continue;
    if (k in DEFAULT_PROPS && DEFAULT_PROPS[k] === v) continue;
    out[k] = v;
  }
  return out;
}

/** styles から偽値と tableRowIdentity（保存ごとに再採番）を除く */
function normalizeStyles(styles: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!styles || typeof styles !== "object") return out;
  for (const [k, v] of Object.entries(styles as Record<string, unknown>)) {
    if (k === "tableRowIdentity") continue;
    if (v === undefined || v === null || v === false || v === "") continue;
    out[k] = v;
  }
  return out;
}

/** inline content を正規化（空 text を捨て、同一 styles の隣接 text を結合） */
function canonicalInline(content: unknown): unknown[] {
  if (typeof content === "string") content = [{ type: "text", text: content, styles: {} }];
  if (!Array.isArray(content)) return [];
  const out: any[] = [];
  for (const raw of content) {
    if (!raw || typeof raw !== "object") continue;
    const it = raw as Record<string, any>;
    if (it.type === "inlineMath") {
      out.push({ type: "inlineMath", props: normalizeProps(it.props, true) });
    } else if (it.type === "link" || Array.isArray(it.content)) {
      out.push({
        type: it.type ?? "link",
        href: it.href ?? "",
        content: canonicalInline(it.content),
      });
    } else if (typeof it.text === "string") {
      if (it.text === "") continue;
      const styles = normalizeStyles(it.styles);
      const last = out[out.length - 1];
      if (last && last.type === "text" && stableStringify(last.styles) === stableStringify(styles)) {
        last.text += it.text;
      } else {
        out.push({ type: "text", text: it.text, styles });
      }
    } else {
      out.push({ type: it.type ?? "unknown", props: normalizeProps(it.props, true) });
    }
  }
  return out;
}

/** 表セル（inline 配列 / { type: "tableCell", content, props } の両方）を正規化 */
function canonicalCell(cell: unknown): unknown {
  if (Array.isArray(cell) || typeof cell === "string") {
    return { content: canonicalInline(cell), props: {} };
  }
  if (cell && typeof cell === "object") {
    const c = cell as Record<string, any>;
    return { content: canonicalInline(c.content), props: normalizeProps(c.props) };
  }
  return { content: [], props: {} };
}

/** ブロックの content を正規化した比較用の値にする */
function canonicalContent(content: unknown): unknown {
  if (Array.isArray(content) || typeof content === "string") return canonicalInline(content);
  if (content && typeof content === "object") {
    const c = content as Record<string, any>;
    if (Array.isArray(c.rows)) {
      const out: Record<string, unknown> = {
        type: "tableContent",
        rows: c.rows.map((row: any) => ({
          cells: (Array.isArray(row?.cells) ? row.cells : []).map(canonicalCell),
        })),
      };
      // 既定値（幅が全部未設定・ヘッダー行 0）は無視する
      if (Array.isArray(c.columnWidths) && c.columnWidths.some((w: unknown) => w != null)) {
        out.columnWidths = c.columnWidths;
      }
      if (c.headerRows) out.headerRows = c.headerRows;
      if (c.headerCols) out.headerCols = c.headerCols;
      return out;
    }
  }
  return null;
}

/** ブロックの内容を比較するためのキー生成（type + 正規化 content + 既定値を除いた props） */
function blockContentKey(block: any): string {
  return stableStringify({
    type: block.type,
    content: canonicalContent(block.content),
    props: normalizeProps(block.props),
  });
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
  prevPage: GraphiumPage | null,
  currentPage: GraphiumPage,
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
      const before = blockTextContent(prevBlock);
      const after = blockTextContent(block);
      // 書式・属性だけの変更（テキスト同一）は blocksModified にだけ数える
      if (before !== after) {
        contentDiff.push({ blockId: id, type: "modify", before, after });
      }
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
  const prevProvIds = new Set(prevPage.provLinks.map((l) => l.id));
  const currentProvIds = new Set(currentPage.provLinks.map((l) => l.id));
  const prevKnowledgeIds = new Set(prevPage.knowledgeLinks.map((l) => l.id));
  const currentKnowledgeIds = new Set(currentPage.knowledgeLinks.map((l) => l.id));

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
export async function computePageHash(page: GraphiumPage): Promise<string> {
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
