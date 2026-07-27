// inlineAttribute style 値のフォーマット拡張
// Phase F (2026-05-01): Parameter の親 Entity 明示指定をサポート
//
// 値の文法:
//   - "ent_attr_xxx"                    旧形式（最寄り Entity 推論）
//   - "ent_attr_xxx@ent_material_yyy"   親 Entity を明示指定
//   - "ent_attr_xxx@activity"           親 Activity に直結（同ブロック Entity 推論をスキップ）
//
// ParseAttributeId / FormatAttributeId で透過的に扱い、
// 既存データ（旧形式）は parentEntityId === null として読み出される。

export const PARENT_ACTIVITY_MARKER = "activity";

export type AttributeBinding = {
  entityId: string;
  /**
   * 明示指定された親:
   *   - 文字列 "activity" : 親 Activity に直結
   *   - 文字列 (ent_xxx)  : 同ブロック内の他 Entity を指定
   *   - null              : 明示指定なし（最寄り推論）
   */
  parentEntityId: string | null;
};

export function parseAttributeBinding(value: string): AttributeBinding {
  if (!value) return { entityId: "", parentEntityId: null };
  const at = value.indexOf("@");
  if (at < 0) {
    return { entityId: value, parentEntityId: null };
  }
  return {
    entityId: value.slice(0, at),
    parentEntityId: value.slice(at + 1) || null,
  };
}

export function formatAttributeBinding(binding: AttributeBinding): string {
  if (!binding.parentEntityId) return binding.entityId;
  return `${binding.entityId}@${binding.parentEntityId}`;
}

import { STYLE_TO_LABEL, type InlineLabel } from "./style-label-map";

/**
 * 同一ブロック内の Entity 系（material/tool/output）ハイライトを列挙する。
 * Parameter (attribute) の親候補ピッカー用。
 */
export type SameBlockEntity = {
  entityId: string;
  label: InlineLabel; // material/tool/output いずれか
  text: string;
};

export function collectSameBlockEntities(
  blocks: any[],
  blockId: string,
): SameBlockEntity[] {
  return collectEntitiesWithContext(blocks).filter((e) => e.blockId === blockId);
}

/**
 * ドキュメント内のすべての Entity 系ハイライト（material/tool/output）を、
 * ブロック ID + 直近見出しテキストとともに列挙する。
 * Parameter binding picker の「他ブロックも候補」用。
 */
export type EntityWithContext = SameBlockEntity & {
  /** 代表ブロック ID（最初の出現） */
  blockId: string;
  /** 代表ブロックの H1>H2>H3 パンくずパス */
  headingPath: string[];
  /** 代表ブロックのスコープ ID（procedure 配下でない場合は null） */
  scopeId: string | null;
  /** 同 entityId のすべての出現ブロック ID（merge / 複数 mark 対応） */
  allBlockIds: Set<string>;
  /** 同 entityId のすべての出現スコープ ID（procedure 配下でなければ null） */
  allScopeIds: Set<string | null>;
};

export function collectEntitiesWithContext(
  blocks: any[],
  labels?: Map<string, string>,
): EntityWithContext[] {
  const out: EntityWithContext[] = [];
  const seen = new Map<string, EntityWithContext>();

  // 見出しレベル別スタック（[H1, H2, H3]）。各レベルの最新テキストを保持
  const headingStack: string[] = [];
  // 直近の procedure-label 付きブロック ID（= スコープキー）
  let currentScopeId: string | null = null;

  const isHeadingBlock = (b: any): boolean =>
    b?.type === "heading" && Array.isArray(b.content);

  const headingLevelOf = (b: any): number => {
    const lv = Number(b?.props?.level ?? 0);
    return Number.isFinite(lv) && lv >= 1 && lv <= 6 ? lv : 1;
  };

  const headingTextOf = (b: any): string => {
    const parts: string[] = [];
    const walk = (c: any) => {
      if (!c) return;
      if (typeof c === "string") parts.push(c);
      else if (c.type === "text" && typeof c.text === "string") parts.push(c.text);
      else if (Array.isArray(c.content)) c.content.forEach(walk);
    };
    if (Array.isArray(b.content)) b.content.forEach(walk);
    return parts.join("").trim();
  };

  const updateHeadingStack = (b: any) => {
    const lv = headingLevelOf(b);
    const text = headingTextOf(b);
    // lv-1 まで保持して、lv 位置に新しいテキスト、深い側はクリア
    headingStack.length = lv - 1;
    headingStack[lv - 1] = text;
  };

  const visitContent = (
    blockId: string,
    headingPath: string[],
    content: any[],
  ) => {
    for (const c of content) {
      if (c?.type === "text" && c.styles) {
        for (const styleKey of Object.keys(STYLE_TO_LABEL)) {
          if (styleKey === "inlineAttribute") continue;
          const v = c.styles[styleKey];
          if (typeof v !== "string" || !v) continue;
          const label = STYLE_TO_LABEL[styleKey] as InlineLabel;
          const text = typeof c.text === "string" ? c.text : "";
          const existing = seen.get(v);
          if (existing) {
            existing.text += text;
            existing.allBlockIds.add(blockId);
            existing.allScopeIds.add(currentScopeId);
          } else {
            const entry: EntityWithContext = {
              entityId: v,
              label,
              text,
              blockId,
              headingPath: [...headingPath],
              scopeId: currentScopeId,
              allBlockIds: new Set([blockId]),
              allScopeIds: new Set([currentScopeId]),
            };
            seen.set(v, entry);
            out.push(entry);
          }
        }
      } else if (c?.type === "link" && Array.isArray(c.content)) {
        visitContent(blockId, headingPath, c.content);
      }
    }
  };

  const visit = (bs: any[]) => {
    for (const b of bs) {
      if (isHeadingBlock(b)) {
        updateHeadingStack(b);
      }
      // step コンテナ、または（legacy）procedure ラベル付きブロックでスコープ更新。
      // 入れ子 step は最内が勝つ（後勝ち上書き = generator の stepOwner と同じ意味論）
      if (b?.type === "step" && b.id) {
        currentScopeId = b.id;
      } else if (b?.id && labels?.get(b.id) === "procedure") {
        currentScopeId = b.id;
      }
      if (b?.id && Array.isArray(b.content)) {
        const path = headingStack.filter(Boolean);
        visitContent(b.id, path, b.content);
      }
      if (Array.isArray(b?.children)) visit(b.children);
    }
  };

  visit(blocks);
  return out;
}

/**
 * 指定ブロックの procedure-scopeId と headingPath を返す。
 * ブロック自身が entity を持たないケース（attribute だけのブロック等）でもスコープを取得できる。
 */
export function getBlockScope(
  blocks: any[],
  labels: Map<string, string> | undefined,
  blockId: string,
): { scopeId: string | null; headingPath: string[] } | null {
  let result: { scopeId: string | null; headingPath: string[] } | null = null;
  let currentScopeId: string | null = null;
  const headingStack: string[] = [];

  const isHeadingBlock = (b: any): boolean =>
    b?.type === "heading" && Array.isArray(b.content);
  const headingLevelOf = (b: any): number => {
    const lv = Number(b?.props?.level ?? 0);
    return Number.isFinite(lv) && lv >= 1 && lv <= 6 ? lv : 1;
  };
  const headingTextOf = (b: any): string => {
    const parts: string[] = [];
    const walk = (c: any) => {
      if (!c) return;
      if (typeof c === "string") parts.push(c);
      else if (c.type === "text" && typeof c.text === "string") parts.push(c.text);
      else if (Array.isArray(c.content)) c.content.forEach(walk);
    };
    if (Array.isArray(b.content)) b.content.forEach(walk);
    return parts.join("").trim();
  };

  const visit = (bs: any[]) => {
    for (const b of bs) {
      if (result) return;
      if (isHeadingBlock(b)) {
        const lv = headingLevelOf(b);
        headingStack.length = lv - 1;
        headingStack[lv - 1] = headingTextOf(b);
      }
      if (b?.type === "step" && b.id) {
        currentScopeId = b.id;
      } else if (b?.id && labels?.get(b.id) === "procedure") {
        currentScopeId = b.id;
      }
      if (b?.id === blockId) {
        result = {
          scopeId: currentScopeId,
          headingPath: headingStack.filter(Boolean),
        };
        return;
      }
      if (Array.isArray(b?.children)) visit(b.children);
    }
  };
  visit(blocks);
  return result;
}

/**
 * 指定 attribute (entityId) の親 binding を書き換える。
 * - parentEntityId === null: 明示指定を解除（最寄り推論に戻す）
 * - parentEntityId === "activity": 親 Activity 直結
 * - parentEntityId === "ent_xxx": 同ブロック Entity を指定
 */
export function setAttributeParent(
  editor: any,
  attributeEntityId: string,
  parentEntityId: string | null,
): number {
  if (!editor || !attributeEntityId) return 0;
  let touched = 0;

  const rewriteContent = (content: any[]): any[] | null => {
    let mutated = false;
    const next = content.map((c: any) => {
      if (c?.type === "text" && c.styles) {
        const v = c.styles.inlineAttribute;
        if (typeof v === "string" && v) {
          const b = parseAttributeBinding(v);
          if (b.entityId === attributeEntityId) {
            const newVal = formatAttributeBinding({
              entityId: b.entityId,
              parentEntityId,
            });
            if (newVal !== v) {
              mutated = true;
              return {
                ...c,
                styles: { ...c.styles, inlineAttribute: newVal },
              };
            }
          }
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

  const visit = (blocks: any[]) => {
    for (const b of blocks) {
      if (b?.id && Array.isArray(b.content)) {
        const next = rewriteContent(b.content);
        if (next) {
          try {
            editor.updateBlock(b.id, { content: next });
            touched += 1;
          } catch {
            /* ignore */
          }
        }
      }
      if (Array.isArray(b?.children)) visit(b.children);
    }
  };

  visit(editor.document);
  return touched;
}

/**
 * 指定 entityId を持つ attribute がどのブロックに属するかを返す（最初の 1 件）。
 * picker で同ブロック候補を絞るときに使う。
 */
export function findAttributeBlockId(
  blocks: any[],
  attributeEntityId: string,
): string | null {
  let found: string | null = null;
  const visitContent = (blockId: string, content: any[]): boolean => {
    for (const c of content) {
      if (c?.type === "text" && c.styles) {
        const v = c.styles.inlineAttribute;
        if (typeof v === "string" && v) {
          const b = parseAttributeBinding(v);
          if (b.entityId === attributeEntityId) {
            found = blockId;
            return true;
          }
        }
      } else if (c?.type === "link" && Array.isArray(c.content)) {
        if (visitContent(blockId, c.content)) return true;
      }
    }
    return false;
  };
  const visit = (bs: any[]) => {
    for (const b of bs) {
      if (found) return;
      if (b?.id && Array.isArray(b.content)) {
        if (visitContent(b.id, b.content)) return;
      }
      if (Array.isArray(b?.children)) visit(b.children);
    }
  };
  visit(blocks);
  return found;
}

/**
 * 指定 attribute の現在の binding を取得（最初の 1 件）。
 */
export function getAttributeBinding(
  blocks: any[],
  attributeEntityId: string,
): AttributeBinding | null {
  let found: AttributeBinding | null = null;
  const visitContent = (content: any[]): boolean => {
    for (const c of content) {
      if (c?.type === "text" && c.styles) {
        const v = c.styles.inlineAttribute;
        if (typeof v === "string" && v) {
          const b = parseAttributeBinding(v);
          if (b.entityId === attributeEntityId) {
            found = b;
            return true;
          }
        }
      } else if (c?.type === "link" && Array.isArray(c.content)) {
        if (visitContent(c.content)) return true;
      }
    }
    return false;
  };
  const visit = (bs: any[]) => {
    for (const b of bs) {
      if (found) return;
      if (Array.isArray(b?.content)) {
        if (visitContent(b.content)) return;
      }
      if (Array.isArray(b?.children)) visit(b.children);
    }
  };
  visit(blocks);
  return found;
}
