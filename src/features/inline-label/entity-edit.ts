// インライン Entity（material / tool / output / attribute）の span を
// entityId 指定で書き換える・外すユーティリティ。
//
// グラフ側（手順フロービュー）の編集はここを通る: グラフは blocks+links の
// 投影なので、「チップのリネーム」は本文 span のテキスト置換、「チップの削除」は
// 本文 span のラベル解除（または専用行の削除）としてドキュメントに書き込む。
//
// - リネーム: 同 entityId の span を全ブロックで探し、ブロック内の最初の
//   piece を新テキストに置換、同ブロック内の残り piece は削除（分割 mark の統合）。
//   entityId は維持されるので、PROV 上は同じ Entity のラベル変更になる。
// - 削除: その span がブロックの唯一の中身（専用行 — グラフから追加した形）なら
//   ブロックごと削除。文章の一部なら mark だけ外してテキストは壊さない。

import { parseAttributeBinding } from "./attribute-binding";

const ENTITY_STYLE_KEYS = [
  "inlineMaterial",
  "inlineTool",
  "inlineOutput",
  "inlineAttribute",
] as const;

type EntityStyleKey = (typeof ENTITY_STYLE_KEYS)[number];

/** この text inline の styles が指定 entityId の Entity 系 mark を持つか（持つならキーを返す） */
function matchStyleKey(styles: Record<string, unknown> | undefined, entityId: string): EntityStyleKey | null {
  if (!styles) return null;
  for (const key of ENTITY_STYLE_KEYS) {
    const v = styles[key];
    if (typeof v !== "string" || !v) continue;
    const id = key === "inlineAttribute" ? parseAttributeBinding(v).entityId : v;
    if (id === entityId) return key;
  }
  return null;
}

/** content（inline 配列）に指定 entityId の span が含まれるか */
function contentHasEntity(content: any[], entityId: string): boolean {
  for (const c of content ?? []) {
    if (c?.type === "text" && matchStyleKey(c.styles, entityId)) return true;
    if (c?.type === "link" && Array.isArray(c.content) && contentHasEntity(c.content, entityId)) return true;
  }
  return false;
}

/**
 * 指定 entityId の span テキストを newText に置き換える。
 * 対象ブロックが複数ある場合（merge 済み Entity）はすべて置き換える。
 * @returns 書き換えたブロック数
 */
export function renameInlineEntity(editor: any, entityId: string, newText: string): number {
  if (!editor || !entityId || !newText.trim()) return 0;
  let touched = 0;

  const rewrite = (content: any[]): { next: any[]; mutated: boolean } => {
    let mutated = false;
    let replacedHere = false;
    const next: any[] = [];
    for (const c of content) {
      if (c?.type === "text" && matchStyleKey(c.styles, entityId)) {
        if (!replacedHere) {
          next.push({ ...c, text: newText });
          replacedHere = true;
          mutated = mutated || c.text !== newText;
        } else {
          // 分割 mark（太字などで span が割れたもの）は最初の piece に統合する
          mutated = true;
        }
        continue;
      }
      if (c?.type === "link" && Array.isArray(c.content)) {
        const inner = rewrite(c.content);
        if (inner.mutated) {
          mutated = true;
          next.push({ ...c, content: inner.next });
          continue;
        }
      }
      next.push(c);
    }
    return { next, mutated };
  };

  const visit = (blocks: any[]) => {
    for (const b of blocks ?? []) {
      if (b?.id && Array.isArray(b.content) && contentHasEntity(b.content, entityId)) {
        const { next, mutated } = rewrite(b.content);
        if (mutated) {
          try {
            editor.updateBlock(b.id, { content: next });
            touched += 1;
          } catch {
            /* 消えたブロック等は無視 */
          }
        }
      }
      if (Array.isArray(b?.children)) visit(b.children);
    }
  };

  visit(editor.document ?? []);
  return touched;
}

/**
 * 指定 entityId の span を本文から外す。
 * - span がブロックの唯一の中身（専用行）: ブロックごと削除
 * - 文章の一部: mark だけ解除してテキストは残す
 * @returns { removedBlocks, unstyled } 削除したブロック数 / mark を外したブロック数
 */
export function removeInlineEntity(
  editor: any,
  entityId: string,
): { removedBlocks: number; unstyled: number } {
  if (!editor || !entityId) return { removedBlocks: 0, unstyled: 0 };
  const toRemove: string[] = [];
  const toUnstyle: { id: string; content: any[] }[] = [];

  /** ブロックの中身が「該当 span + 空白」だけか（= グラフから追加した専用行か） */
  const isDedicatedRow = (b: any): boolean => {
    if (b?.type !== "paragraph" || !Array.isArray(b.content)) return false;
    if ((b.children ?? []).length > 0) return false;
    let hasEntity = false;
    for (const c of b.content) {
      if (c?.type === "text") {
        if (matchStyleKey(c.styles, entityId)) {
          hasEntity = true;
        } else if (typeof c.text === "string" && c.text.trim() !== "") {
          return false; // ラベル外のテキストがある = 文章の一部
        }
      } else {
        return false; // link 等が混在
      }
    }
    return hasEntity;
  };

  const stripStyles = (content: any[]): { next: any[]; mutated: boolean } => {
    let mutated = false;
    const next = content.map((c: any) => {
      if (c?.type === "text") {
        const key = matchStyleKey(c.styles, entityId);
        if (key) {
          mutated = true;
          const styles = { ...c.styles };
          delete styles[key];
          return { ...c, styles };
        }
      } else if (c?.type === "link" && Array.isArray(c.content)) {
        const inner = stripStyles(c.content);
        if (inner.mutated) {
          mutated = true;
          return { ...c, content: inner.next };
        }
      }
      return c;
    });
    return { next, mutated };
  };

  const visit = (blocks: any[]) => {
    for (const b of blocks ?? []) {
      if (b?.id && Array.isArray(b.content) && contentHasEntity(b.content, entityId)) {
        if (isDedicatedRow(b)) {
          toRemove.push(b.id);
        } else {
          const { next, mutated } = stripStyles(b.content);
          if (mutated) toUnstyle.push({ id: b.id, content: next });
        }
      }
      if (Array.isArray(b?.children)) visit(b.children);
    }
  };

  visit(editor.document ?? []);

  for (const u of toUnstyle) {
    try {
      editor.updateBlock(u.id, { content: u.content });
    } catch {
      /* ignore */
    }
  }
  if (toRemove.length > 0) {
    try {
      editor.removeBlocks(toRemove);
    } catch {
      /* ignore */
    }
  }
  return { removedBlocks: toRemove.length, unstyled: toUnstyle.length };
}

/**
 * 親 Entity（parentEntityId の span）に従属する attribute を本文に合成する。
 * 親 span を持つ最初のブロックの直後に、明示 binding（`<newId>@<parent>`）付きの
 * 専用行を挿入する — 最寄り推論に頼らないので置き場所の自由度が高く、
 * グラフ側（Entity ノードの「+ 属性」）からの追加に使う。
 * @returns 追加した attribute の entityId（親が見つからなければ null）
 */
export function addDependentAttribute(
  editor: any,
  parentEntityId: string,
  text: string,
  makeId: () => string,
): string | null {
  const trimmed = text.trim();
  if (!editor || !parentEntityId || !trimmed) return null;

  // 親 entityId の span を持つ最初のブロックを探す
  let hostId: string | null = null;
  const visit = (blocks: any[]) => {
    for (const b of blocks ?? []) {
      if (hostId) return;
      if (b?.id && Array.isArray(b.content) && contentHasEntity(b.content, parentEntityId)) {
        hostId = b.id;
        return;
      }
      if (Array.isArray(b?.children)) visit(b.children);
    }
  };
  visit(editor.document ?? []);
  if (!hostId) return null;

  const attrId = makeId();
  try {
    editor.insertBlocks(
      [
        {
          type: "paragraph",
          content: [
            { type: "text", text: trimmed, styles: { inlineAttribute: `${attrId}@${parentEntityId}` } },
          ],
        },
      ],
      hostId,
      "after",
    );
  } catch {
    return null;
  }
  return attrId;
}
