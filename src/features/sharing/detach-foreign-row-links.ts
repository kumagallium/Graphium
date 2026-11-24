// 共有ノートの写しを作るとき、表の行のつながり（tableMeta.noteLinks）のうち、
// この端末に無いノートを指しているものを外す。
//
// なぜ要るか:
//   行のつながりは、共有した人の手元のノート id で入っている。写しを作った人の端末には
//   そのノートが無いので、行は「つながっている」ように見えるのに開けず、自分のノートを
//   行から作ることもできない（作る入口はつながっていない行にしか出ない）。
//   共有された計画を写して、行から自分の記録を始める流れが、ここで止まっていた。
//
// 何をするか:
//   - 表の注釈から、この端末に無いノートへのつながりを外す
//   - その行の先頭セルの「@名前」（青い文字）を、ただの「名前」に戻す。行の id
//     （tableRowIdentity）とセルのほかの書式は残す
//   - 文書の noteLinks からも、外したノートへの線を外す
//   - この端末にあるノートへのつながり（自分の共有ノートを自分で写したとき）は残す
//
// 元の共有エントリには触れない。返すのは新しい doc（引数は変更しない）。

import type { GraphiumDocument, GraphiumPage, TableMeta } from "../../lib/document-types";
import { migrateTableMeta } from "../table-meta/migration";

const stripAt = (name: string) => {
  const trimmed = name.trim();
  return trimmed.startsWith("@") ? trimmed.slice(1).trim() : trimmed;
};

function cellInlines(cell: any): any[] | null {
  if (Array.isArray(cell)) return cell;
  if (cell?.type === "tableCell" && Array.isArray(cell.content)) return cell.content;
  return null;
}

function inlineText(inlines: any[]): string {
  return inlines
    .map((c) => (c?.type === "text" && typeof c.text === "string" ? c.text : ""))
    .join("")
    .trim();
}

/** 先頭セルの「@名前」を「名前」に戻す（青い文字も解く）。変わらなければ元のセル */
function unmentionCell(cell: any): any {
  const inlines = cellInlines(cell);
  if (!inlines) return cell;
  let atRemoved = false;
  const next = inlines.map((inline) => {
    if (inline?.type !== "text" || typeof inline.text !== "string") return inline;
    let text = inline.text;
    if (!atRemoved) {
      const trimmedStart = text.replace(/^\s+/, "");
      if (trimmedStart.startsWith("@")) {
        text = trimmedStart.slice(1);
        atRemoved = true;
      } else if (trimmedStart.length > 0) {
        // 先頭の文字が "@" でないセルは書き換えない
        atRemoved = true;
      }
    }
    const styles = { ...(inline.styles ?? {}) };
    if (styles.textColor === "blue") delete styles.textColor;
    return { ...inline, text, styles };
  });
  return Array.isArray(cell) ? next : { ...cell, content: next };
}

function mapTableBlocks(blocks: any[], fn: (block: any) => any): any[] {
  let changed = false;
  const next = (blocks ?? []).map((block) => {
    let out = block;
    if (block?.type === "table" && typeof block.id === "string") out = fn(block);
    if (Array.isArray(out?.children) && out.children.length > 0) {
      const children = mapTableBlocks(out.children, fn);
      if (children !== out.children) out = { ...out, children };
    }
    if (out !== block) changed = true;
    return out;
  });
  return changed ? next : blocks;
}

/**
 * この端末に無いノートを指す行のつながりを外した doc を返す。
 * 外すものが無ければ、受け取った doc をそのまま返す。
 */
export function detachForeignRowLinks(
  doc: GraphiumDocument,
  isLocalNote: (noteId: string) => boolean,
): GraphiumDocument {
  const removedIds = new Set<string>();
  let pagesChanged = false;

  const pages = (doc.pages ?? []).map((page): GraphiumPage => {
    const metas = migrateTableMeta(page);
    if (!metas) return page;

    // 表ごとに、外す行名（"@" を外した名前）を集める
    const removedNames = new Map<string, Set<string>>();
    const nextMetas: Record<string, TableMeta> = {};
    let metaChanged = false;
    for (const [blockId, meta] of Object.entries(metas)) {
      const links = meta.noteLinks;
      if (!links || Object.keys(links).length === 0) {
        nextMetas[blockId] = meta;
        continue;
      }
      const kept: Record<string, string> = {};
      const names = new Set<string>();
      for (const [name, noteId] of Object.entries(links)) {
        if (isLocalNote(noteId)) {
          kept[name] = noteId;
        } else {
          names.add(stripAt(name));
          removedIds.add(noteId);
        }
      }
      if (names.size === 0) {
        nextMetas[blockId] = meta;
        continue;
      }
      // 同じ名前が残すつながりにもあれば（"名前" と "@名前" の二重キー）、その行は触らない
      for (const name of Object.keys(kept)) names.delete(stripAt(name));
      metaChanged = true;
      removedNames.set(blockId, names);
      const { noteLinks: _dropped, ...rest } = meta;
      nextMetas[blockId] = Object.keys(kept).length > 0 ? { ...rest, noteLinks: kept } : rest;
    }
    if (!metaChanged) return page;
    pagesChanged = true;

    const blocks = mapTableBlocks(page.blocks ?? [], (block) => {
      const names = removedNames.get(block.id);
      const rows: any[] = block.content?.rows ?? [];
      if (!names || names.size === 0 || rows.length <= 1) return block;
      let rowChanged = false;
      const nextRows = rows.map((row, i) => {
        if (i === 0) return row;
        const cells: any[] = row?.cells ?? [];
        const first = cells[0];
        const text = inlineText(cellInlines(first) ?? []);
        if (!text.startsWith("@") || !names.has(stripAt(text))) return row;
        rowChanged = true;
        return { ...row, cells: [unmentionCell(first), ...cells.slice(1)] };
      });
      return rowChanged ? { ...block, content: { ...block.content, rows: nextRows } } : block;
    });

    return { ...page, blocks, tableMeta: nextMetas };
  });

  if (!pagesChanged) return doc;

  const noteLinks = Array.isArray(doc.noteLinks)
    ? doc.noteLinks.filter((link) => !removedIds.has(link.targetNoteId))
    : doc.noteLinks;
  return {
    ...doc,
    pages,
    ...(Array.isArray(doc.noteLinks) && noteLinks!.length !== doc.noteLinks.length ? { noteLinks } : {}),
  };
}
