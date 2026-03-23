// ──────────────────────────────────────────────
// テンプレートからの変更diff記録
//
// テンプレート（元の状態）と現在の状態を比較し、
// 差分を構造的に記録する
// ──────────────────────────────────────────────

import type { PageTemplate } from "./types";

// diff の種別
export type DiffType =
  | "block-added"      // ブロックが追加された
  | "block-removed"    // ブロックが削除された
  | "block-modified"   // ブロックの内容が変更された
  | "label-added"      // ラベルが付与された
  | "label-removed"    // ラベルが外された
  | "label-changed"    // ラベルが変更された
  | "attr-changed";    // 連動属性が変更された

export type DiffEntry = {
  type: DiffType;
  blockId: string;
  detail: string;
};

/**
 * テンプレートと現在の状態を比較してdiffを生成
 */
export function computeDiff(
  template: PageTemplate,
  current: {
    blocks: any[];
    labels: [string, string][];
    attributes: [string, any][];
  }
): DiffEntry[] {
  const diffs: DiffEntry[] = [];

  // ブロックIDセットを作成
  const templateBlockIds = new Set(template.blocks.map((b: any) => b.id));
  const currentBlockIds = new Set(current.blocks.map((b: any) => b.id));

  // 追加されたブロック
  for (const block of current.blocks) {
    if (!templateBlockIds.has(block.id)) {
      diffs.push({
        type: "block-added",
        blockId: block.id,
        detail: `ブロック追加: ${block.type}`,
      });
    }
  }

  // 削除されたブロック
  for (const block of template.blocks) {
    if (!currentBlockIds.has(block.id)) {
      diffs.push({
        type: "block-removed",
        blockId: block.id,
        detail: `ブロック削除: ${block.type}`,
      });
    }
  }

  // 変更されたブロック（内容比較）
  const templateBlockMap = new Map(template.blocks.map((b: any) => [b.id, b]));
  for (const block of current.blocks) {
    const orig = templateBlockMap.get(block.id);
    if (orig && JSON.stringify(orig) !== JSON.stringify(block)) {
      diffs.push({
        type: "block-modified",
        blockId: block.id,
        detail: `ブロック変更: ${block.type}`,
      });
    }
  }

  // ラベルの差分
  const templateLabels = new Map(template.labels);
  const currentLabels = new Map(current.labels);

  for (const [blockId, label] of currentLabels) {
    const origLabel = templateLabels.get(blockId);
    if (!origLabel) {
      diffs.push({ type: "label-added", blockId, detail: `ラベル付与: ${label}` });
    } else if (origLabel !== label) {
      diffs.push({ type: "label-changed", blockId, detail: `ラベル変更: ${origLabel} → ${label}` });
    }
  }
  for (const [blockId, label] of templateLabels) {
    if (!currentLabels.has(blockId)) {
      diffs.push({ type: "label-removed", blockId, detail: `ラベル解除: ${label}` });
    }
  }

  // 属性の差分
  const templateAttrs = new Map(template.attributes.map(([k, v]) => [k, JSON.stringify(v)]));
  const currentAttrs = new Map(current.attributes.map(([k, v]) => [k, JSON.stringify(v)]));

  for (const [blockId, attrJson] of currentAttrs) {
    const origJson = templateAttrs.get(blockId);
    if (origJson && origJson !== attrJson) {
      diffs.push({ type: "attr-changed", blockId, detail: "連動属性が変更された" });
    }
  }

  return diffs;
}
