// ──────────────────────────────────────────────
// 構造化テーブル行の永続 identity
// ──────────────────────────────────────────────

import type { GraphiumDocument } from "./document-types";

export const TABLE_ROW_IDENTITY_STYLE = "tableRowIdentity";

/** 構造化テーブルの行に割り当てる永続 ID を生成する */
export function makeTableRowIdentity(): string {
  return `row_${Math.random().toString(36).slice(2, 12)}`;
}

function cellContent(cell: any): any[] | null {
  if (Array.isArray(cell)) return cell;
  if (cell?.type === "tableCell" && Array.isArray(cell.content)) return cell.content;
  return null;
}

function inlineText(inlines: any[]): string {
  return inlines
    .map((inline) => {
      if (typeof inline === "string") return inline;
      if (inline?.type === "text") return typeof inline.text === "string" ? inline.text : "";
      if (inline?.type === "link") {
        const label = inlineText(Array.isArray(inline.content) ? inline.content : []);
        return label || (typeof inline.href === "string" ? inline.href : "");
      }
      if (inline?.type === "image" && typeof inline.props?.url === "string") {
        return inline.props.url;
      }
      // インライン画像はファイル名をその行の名前として扱う。空文字を返すと
      // 「画像だけのセル」が無名になり、行が Entity として立たなくなる
      if (inline?.type === "inlineImage" && typeof inline.props?.name === "string") {
        return inline.props.name;
      }
      return "";
    })
    .join("");
}

/** PROV generator と同じ規則でテーブルセルの表示名を読む */
export function extractTableCellText(cell: any): string {
  return inlineText(cellContent(cell) ?? []).trim();
}

function inlineRowIdentity(inlines: any[]): string | undefined {
  for (const inline of inlines) {
    const value = inline?.styles?.[TABLE_ROW_IDENTITY_STYLE];
    if (typeof value === "string" && value) return value;
    if (inline?.type === "link" && Array.isArray(inline.content)) {
      const nested = inlineRowIdentity(inline.content);
      if (nested) return nested;
    }
  }
  return undefined;
}

function rowIdentity(cell: any): string | undefined {
  return inlineRowIdentity(cellContent(cell) ?? []);
}

function withIdentityInlines(inlines: any[], identity: string): [any[], boolean] {
  let changed = false;
  const next = inlines.map((inline) => {
    if (inline?.type === "text") {
      if (inline.styles?.[TABLE_ROW_IDENTITY_STYLE] === identity) return inline;
      changed = true;
      return {
        ...inline,
        styles: { ...(inline.styles ?? {}), [TABLE_ROW_IDENTITY_STYLE]: identity },
      };
    }
    if (inline?.type === "link" && Array.isArray(inline.content)) {
      const [content, nestedChanged] = withIdentityInlines(inline.content, identity);
      if (nestedChanged) {
        changed = true;
        return { ...inline, content };
      }
      if (inline.styles?.[TABLE_ROW_IDENTITY_STYLE] === identity) return inline;
      changed = true;
      return {
        ...inline,
        styles: { ...(inline.styles ?? {}), [TABLE_ROW_IDENTITY_STYLE]: identity },
      };
    }
    if (inline?.type === "image") {
      if (inline.styles?.[TABLE_ROW_IDENTITY_STYLE] === identity) return inline;
      changed = true;
      return {
        ...inline,
        styles: { ...(inline.styles ?? {}), [TABLE_ROW_IDENTITY_STYLE]: identity },
      };
    }
    return inline;
  });
  return [next, changed];
}

function withRowIdentity(cell: any, identity: string): any {
  const content = cellContent(cell);
  if (!content) return cell;
  const [nextContent, changed] = withIdentityInlines(content, identity);
  if (!changed) return cell;
  if (Array.isArray(cell)) return nextContent;
  return { ...cell, content: nextContent };
}

/**
 * 保存するドキュメントの全テーブル行へ identity を補う。
 *
 * 先頭セルが空の行とヘッダーは、まだ実体の Entity ではないので対象外にする。
 * コピーにより同じ identity が複製された場合は、文書順で後の行だけを採番し直す。
 */
export function normalizeTableRowIdentities(doc: GraphiumDocument): GraphiumDocument {
  const used = new Set<string>();
  const nextIdentity = () => {
    let identity = makeTableRowIdentity();
    while (used.has(identity)) identity = makeTableRowIdentity();
    return identity;
  };

  const normalizeBlock = (block: any): any => {
    let nextChildren = block.children;
    if (Array.isArray(block.children)) {
      const children = block.children.map(normalizeBlock);
      if (children.some((child: any, index: number) => child !== block.children[index])) nextChildren = children;
    }

    let nextContent = block.content;
    if (block.type === "table" && Array.isArray(block.content?.rows)) {
      const rows = block.content.rows.map((row: any, index: number) => {
        if (index === 0 || !Array.isArray(row?.cells) || !extractTableCellText(row.cells[0])) return row;
        const existing = rowIdentity(row.cells[0]);
        const identity = existing && !used.has(existing) ? existing : nextIdentity();
        used.add(identity);
        const firstCell = withRowIdentity(row.cells[0], identity);
        if (firstCell === row.cells[0]) return row;
        return { ...row, cells: [firstCell, ...row.cells.slice(1)] };
      });
      if (rows.some((row: any, index: number) => row !== block.content.rows[index])) {
        nextContent = { ...block.content, rows };
      }
    }

    if (nextChildren === block.children && nextContent === block.content) return block;
    return { ...block, ...(nextChildren !== block.children ? { children: nextChildren } : {}), ...(nextContent !== block.content ? { content: nextContent } : {}) };
  };

  const pages = doc.pages.map((page) => {
    const blocks = (page.blocks ?? []).map(normalizeBlock);
    return blocks.some((block, index) => block !== page.blocks[index]) ? { ...page, blocks } : page;
  });
  return pages.some((page, index) => page !== doc.pages[index]) ? { ...doc, pages } : doc;
}

/**
 * 保存直前の正規化を BlockNote 側にも反映し、次回保存で同じ identity を維持する。
 * 戻り値は今回の保存にそのまま使える正規化済み blocks。
 */
export function syncTableRowIdentitiesToEditor(editor: {
  document?: any[];
  updateBlock: (id: string, patch: { content: any }) => unknown;
}): any[] {
  const currentBlocks = editor.document ?? [];
  const normalizedDoc = normalizeTableRowIdentities({
    version: 6,
    title: "",
    pages: [{
      id: "identity-normalization",
      title: "",
      blocks: currentBlocks,
      labels: {},
      provLinks: [],
      knowledgeLinks: [],
    }],
    createdAt: "",
    modifiedAt: "",
  });
  const normalizedBlocks = normalizedDoc.pages[0].blocks;

  const syncBlocks = (before: any[], after: any[]) => {
    for (let index = 0; index < after.length; index += 1) {
      const previous = before[index];
      const next = after[index];
      if (!previous || !next) continue;
      if (previous.type === "table" && previous.content !== next.content) {
        editor.updateBlock(previous.id, { content: next.content });
      }
      if (Array.isArray(previous.children) && Array.isArray(next.children)) {
        syncBlocks(previous.children, next.children);
      }
    }
  };
  syncBlocks(currentBlocks, normalizedBlocks);
  return normalizedBlocks;
}
