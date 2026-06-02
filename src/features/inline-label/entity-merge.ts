// ──────────────────────────────────────────────
// 同一 Entity merge ユーティリティ（Phase F-α, 2026-05-01）
//
// コピペで再発番された entityId を「他のハイライトと同一視」するための
// 薄いリライト処理。データモデル変更なし — entityId 値を rewrite するだけ。
//
// 設計参照: docs/internal/provenance-layer-design.md §8.10
// ──────────────────────────────────────────────

import { STYLE_TO_LABEL, type InlineLabel } from "./style-label-map";
import {
  parseAttributeBinding,
  formatAttributeBinding,
} from "./attribute-binding";

// InlineLabel の正準定義は style-label-map.ts。既存の import 互換のため re-export する。
export type { InlineLabel };

/** ドキュメント内に存在するインラインハイライトの 1 出現 */
export type HighlightOccurrence = {
  /** 含まれるブロック ID */
  blockId: string;
  /** style key (inlineMaterial 等) → label */
  label: InlineLabel;
  /** entityId（同一性キー） */
  entityId: string;
  /** ハイライトされたテキスト（連結） */
  text: string;
};

const STYLE_KEYS = Object.keys(STYLE_TO_LABEL);

/**
 * editor.document を再帰的に走査し、すべてのインラインハイライトを列挙する。
 * 同 entityId が複数 inline に分かれていても別レコードとして返す（呼び出し側で集約）。
 */
export function collectHighlights(blocks: any[]): HighlightOccurrence[] {
  const out: HighlightOccurrence[] = [];

  const visitContent = (blockId: string, content: any[]) => {
    for (const c of content) {
      if (c?.type === "text" && c.styles) {
        for (const styleKey of STYLE_KEYS) {
          const raw = c.styles[styleKey];
          if (typeof raw === "string" && raw) {
            const label = STYLE_TO_LABEL[styleKey] as InlineLabel;
            // attribute は entityId@parent の複合キー。entityId 部分のみ匹配キーに使う
            const entityId =
              label === "attribute"
                ? parseAttributeBinding(raw).entityId
                : raw;
            if (!entityId) continue;
            out.push({
              blockId,
              label,
              entityId,
              text: typeof c.text === "string" ? c.text : "",
            });
          }
        }
      } else if (c?.type === "link" && Array.isArray(c.content)) {
        visitContent(blockId, c.content);
      }
    }
  };

  const visit = (bs: any[]) => {
    for (const b of bs) {
      if (b?.id && Array.isArray(b.content)) {
        visitContent(b.id, b.content);
      }
      if (Array.isArray(b?.children) && b.children.length > 0) {
        visit(b.children);
      }
    }
  };

  visit(blocks);
  return out;
}

/** 同 (label, entityId) を 1 行にまとめた候補表示用エントリ */
export type MergeCandidate = {
  label: InlineLabel;
  entityId: string;
  /** ハイライトテキストの一覧（重複あり、改行 0） */
  texts: string[];
  /** 出現ブロック数 */
  blockCount: number;
};

/**
 * 同 label の他 entityId を集約した候補リストを返す（自分自身は除外）。
 */
export function buildMergeCandidates(
  blocks: any[],
  sourceLabel: InlineLabel,
  sourceEntityId: string,
): MergeCandidate[] {
  const all = collectHighlights(blocks);
  const grouped = new Map<string, MergeCandidate>();
  for (const h of all) {
    if (h.label !== sourceLabel) continue;
    if (h.entityId === sourceEntityId) continue;
    const key = h.entityId;
    let entry = grouped.get(key);
    if (!entry) {
      entry = {
        label: h.label,
        entityId: h.entityId,
        texts: [],
        blockCount: 0,
      };
      grouped.set(key, entry);
    }
    if (h.text && !entry.texts.includes(h.text)) {
      entry.texts.push(h.text);
    }
    entry.blockCount += 1;
  }
  // テキストが揃っているものを優先表示
  return [...grouped.values()].sort((a, b) => {
    if (a.texts[0] && b.texts[0]) return a.texts[0].localeCompare(b.texts[0]);
    return 0;
  });
}

/**
 * `sourceEntityId` を `targetEntityId` に書き換える。
 * label が一致する style key のみ rewrite する（誤って別 label に飛ばないように）。
 *
 * - editor.updateBlock(id, { content }) でブロック単位に反映
 * - children 再帰
 */
export function mergeEntityIds(
  editor: any,
  sourceLabel: InlineLabel,
  sourceEntityId: string,
  targetEntityId: string,
): number {
  if (!editor || !sourceEntityId || !targetEntityId) return 0;
  if (sourceEntityId === targetEntityId) return 0;

  const targetStyleKey = `inline${sourceLabel[0].toUpperCase()}${sourceLabel.slice(1)}`;

  let touched = 0;

  /** styles マップ全体を見て、必要な書き換えがあれば new styles を返す */
  const rewriteStyles = (
    styles: Record<string, unknown>,
  ): Record<string, unknown> | null => {
    let mutated = false;
    const next: Record<string, unknown> = { ...styles };

    // 1) sourceLabel の entityId 一致 → target に書き換え
    const v = next[targetStyleKey];
    if (typeof v === "string" && v) {
      // attribute の場合は複合キー
      if (sourceLabel === "attribute") {
        const b = parseAttributeBinding(v);
        if (b.entityId === sourceEntityId) {
          next[targetStyleKey] = formatAttributeBinding({
            entityId: targetEntityId,
            parentEntityId: b.parentEntityId,
          });
          mutated = true;
        }
      } else if (v === sourceEntityId) {
        next[targetStyleKey] = targetEntityId;
        mutated = true;
      }
    }

    // 2) inlineAttribute の親 entity 参照が source を指していたら target に追従させる
    //    （sourceLabel は entity 系のみ — attribute 自身が親参照に出ることは無い）
    if (sourceLabel !== "attribute") {
      const a = next.inlineAttribute;
      if (typeof a === "string" && a) {
        const b = parseAttributeBinding(a);
        if (b.parentEntityId === sourceEntityId) {
          next.inlineAttribute = formatAttributeBinding({
            entityId: b.entityId,
            parentEntityId: targetEntityId,
          });
          mutated = true;
        }
      }
    }

    return mutated ? next : null;
  };

  const rewriteContent = (content: any[]): any[] | null => {
    let mutated = false;
    const next = content.map((c: any) => {
      if (c?.type === "text" && c.styles) {
        const ns = rewriteStyles(c.styles);
        if (ns) {
          mutated = true;
          return { ...c, styles: ns };
        }
      } else if (c?.type === "link" && Array.isArray(c.content)) {
        const innerNext = rewriteContent(c.content);
        if (innerNext) {
          mutated = true;
          return { ...c, content: innerNext };
        }
      }
      return c;
    });
    return mutated ? next : null;
  };

  const visit = (blocks: any[]): void => {
    for (const block of blocks) {
      if (block?.id && Array.isArray(block.content)) {
        const next = rewriteContent(block.content);
        if (next) {
          try {
            editor.updateBlock(block.id, { content: next });
            touched += 1;
          } catch {
            // ブロックが既に消えているケース等は無視
          }
        }
      }
      if (Array.isArray(block?.children) && block.children.length > 0) {
        visit(block.children);
      }
    }
  };

  visit(editor.document);
  return touched;
}
