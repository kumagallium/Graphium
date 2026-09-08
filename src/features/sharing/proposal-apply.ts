// 「変更の提案」を元の作者の手元ノートへ取り込む（純関数・React 非依存）。仕様 §25b A。
//
// 何をするか:
//   8a の差分エンジン（proposal-diff）が出した項目のうち、選ばれた id だけを
//   mine（作者の現在の本文）へ適用し、新しい GraphiumDocument を返す。
//   mine は一切変更しない（構造化クローンの上で組み立てる）。
//
// 何をしないか:
//   - pages[1..] は触らない（比べていないので取り込みようがない）。skipped に理由が入る
//   - knowledgeLinks / noteLinks（提案者ローカルの id）/ highlights（範囲がずれる）は運ばない
//   - 実エディタへの反映・来歴の記録・保存は呼び出し側（note-app）の仕事
//
// 表の扱い:
//   セルの書き換えは先頭セルの tableRowIdentity（行の永続 id）を壊さない。
//   列の増減で先頭セルが入れ替わったときは identity を新しい先頭セルへ移す。
//   columnWidths / headerRows などは `{ ...content, rows }` で持ち越す。

import type { GraphiumDocument } from "../../lib/document-types";
import type { BlockLink } from "../../lib/block-link-types";
import { TABLE_ROW_IDENTITY_STYLE } from "../../lib/table-row-identity";
import {
  readTableSnapshot,
  type BlockChange,
  type ProposalDiff,
  type TableCellChange,
  type TableSnapshot,
} from "./proposal-diff";

// ──────────────────────────────────────────────
// 型
// ──────────────────────────────────────────────

export type ApplyProposalChangesInput = {
  /** 元のノートの現在の本文（作者側）。この関数は書き換えない */
  mine: GraphiumDocument;
  /** 提案の本文 */
  theirs: GraphiumDocument;
  /** computeProposalDiff の結果 */
  diff: ProposalDiff;
  /** 取り込む項目の id（BlockChange.id / TableCellChange.id / "title"） */
  selected: ReadonlySet<string>;
};

export type ApplyProposalChangesResult = {
  /** 取り込み後の本文（mine とは別物） */
  doc: GraphiumDocument;
  /** 実際に適用できた項目の数 */
  applied: number;
  /**
   * 適用できなかった理由。
   *   "multiple-pages"        … 2 ページ目以降があるので 1 ページ目だけ扱った
   *   "not-found:<項目 id>"    … 対象のブロックが手元に見つからなかった
   *   "table-unreadable:<id>" … 表として読めなかった
   */
  skipped: string[];
};

// ──────────────────────────────────────────────
// 木の操作（すべてクローンの上で行う）
// ──────────────────────────────────────────────

/** レイアウトの器。差分エンジンと同じく項目にはせず、位置決めの手がかりにもしない */
const LAYOUT_BLOCK_TYPES = new Set(["columnList", "column"]);

function clone<T>(value: T): T {
  return structuredClone(value);
}

type Found = { list: any[]; index: number };

/** 木をたどってブロックを探す（親配列と位置つき） */
function findBlock(blocks: any[], id: string): Found | null {
  if (!id) return null;
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (!block || typeof block !== "object") continue;
    if (block.id === id) return { list: blocks, index: i };
    if (Array.isArray(block.children)) {
      const found = findBlock(block.children, id);
      if (found) return found;
    }
  }
  return null;
}

function hasBlock(blocks: any[], id: string): boolean {
  return findBlock(blocks, id) !== null;
}

/** 文書順のブロック id 一覧（レイアウトの器は飛ばして中身だけ） */
function flattenIds(blocks: any[]): string[] {
  const out: string[] = [];
  const visit = (list: any[]): void => {
    for (const block of list ?? []) {
      if (!block || typeof block !== "object") continue;
      const type = typeof block.type === "string" ? block.type : "";
      if (!LAYOUT_BLOCK_TYPES.has(type) && typeof block.id === "string" && block.id) {
        out.push(block.id);
      }
      if (Array.isArray(block.children)) visit(block.children);
    }
  };
  visit(blocks ?? []);
  return out;
}

// ──────────────────────────────────────────────
// 表
// ──────────────────────────────────────────────

/** インラインに載った行 identity を読む（link の入れ子も見る） */
function readInlineIdentity(inlines: any[]): string | undefined {
  for (const inline of inlines ?? []) {
    const value = inline?.styles?.[TABLE_ROW_IDENTITY_STYLE];
    if (typeof value === "string" && value) return value;
    if (inline?.type === "link" && Array.isArray(inline.content)) {
      const nested = readInlineIdentity(inline.content);
      if (nested) return nested;
    }
  }
  return undefined;
}

function cellContent(cell: any): any[] | null {
  if (Array.isArray(cell)) return cell;
  if (cell?.type === "tableCell" && Array.isArray(cell.content)) return cell.content;
  return null;
}

function readCellIdentity(cell: any): string | undefined {
  return readInlineIdentity(cellContent(cell) ?? []);
}

/** その行のどこかのセルに載っている identity（列の増減で先頭がずれた場合の拾い直し） */
function readRowIdentityAnywhere(row: any): string | undefined {
  for (const cell of row?.cells ?? []) {
    const found = readCellIdentity(cell);
    if (found) return found;
  }
  return undefined;
}

/**
 * セルの形（tableCell / 旧 inline 配列）と行 identity を保ったまま、テキストだけ差し替える。
 * calc の withCellText は styles を捨てるので先頭セルには使えない（identity が消える）。
 */
function withCellText(cell: any, text: string, identity?: string): any {
  const keep = identity ?? readCellIdentity(cell);
  const styles = keep ? { [TABLE_ROW_IDENTITY_STYLE]: keep } : {};
  const content = text === "" ? [] : [{ type: "text", text, styles }];
  if (Array.isArray(cell)) return content;
  if (cell && typeof cell === "object" && cell.type === "tableCell") return { ...cell, content };
  return { type: "tableCell", props: {}, content };
}

function emptyCell(): any {
  return { type: "tableCell", props: {}, content: [] };
}

function tableRows(block: any): any[] {
  return Array.isArray(block?.content?.rows) ? block.content.rows : [];
}

/** rows だけ差し替えた表ブロック（columnWidths / headerRows などはそのまま持ち越す） */
function withRows(block: any, rows: any[], columnWidths?: any[]): any {
  const content: Record<string, any> = { ...(block.content ?? {}), rows };
  if (columnWidths) content.columnWidths = columnWidths;
  return { ...block, content };
}

/** 列を足し引きした後、行 identity が先頭セルに載った状態へ戻す */
function restoreRowIdentities(rows: any[]): any[] {
  return rows.map((row, index) => {
    if (index === 0 || !Array.isArray(row?.cells) || row.cells.length === 0) return row;
    const identity = readRowIdentityAnywhere(row);
    if (!identity || readCellIdentity(row.cells[0]) === identity) return row;
    const first = row.cells[0];
    const content = cellContent(first) ?? [];
    if (content.length === 0) return row;
    const next = content.map((inline: any) =>
      inline && typeof inline === "object" && inline.type !== "link"
        ? { ...inline, styles: { ...(inline.styles ?? {}), [TABLE_ROW_IDENTITY_STYLE]: identity } }
        : inline,
    );
    const cells = [...row.cells];
    cells[0] = Array.isArray(first) ? next : { ...first, content: next };
    return { ...row, cells };
  });
}

function columnWidthsOf(block: any): any[] | undefined {
  const widths = block?.content?.columnWidths;
  return Array.isArray(widths) ? [...widths] : undefined;
}

/**
 * 表のセル項目を適用する。位置は毎回いまの表から引き直すので、
 * 行や列の増減が混ざっても互いにずれない。
 */
function applyTableCellChanges(
  mineBlock: any,
  theirsBlock: any,
  changes: TableCellChange[],
  selected: ReadonlySet<string>,
): { block: any; applied: string[]; skipped: string[] } {
  const applied: string[] = [];
  const skipped: string[] = [];
  const mineSnap = readTableSnapshot(mineBlock);
  const theirsSnap = readTableSnapshot(theirsBlock);
  if (!mineSnap || !theirsSnap) {
    for (const change of changes) {
      if (selected.has(change.id)) skipped.push(`table-unreadable:${change.id}`);
    }
    return { block: mineBlock, applied, skipped };
  }

  let work = mineBlock;

  /** いまの表での列位置（key → 0 始まりの列番号） */
  const workColumnIndex = (snap: TableSnapshot, key: string): number =>
    snap.columns.findIndex((column) => column.key === key);
  /** いまの表でのデータ行位置（key → 0 始まりのデータ行番号） */
  const workRowIndex = (snap: TableSnapshot, key: string): number =>
    snap.rows.findIndex((row) => row.key === key);

  for (const change of changes) {
    if (!selected.has(change.id)) continue;
    const snap = readTableSnapshot(work);
    if (!snap) {
      skipped.push(`table-unreadable:${change.id}`);
      continue;
    }
    const rows = tableRows(work);

    if (change.kind === "cellModified") {
      const rowKey = theirsSnap.rows[change.rowIndex]?.key;
      const columnKey = theirsSnap.columns[change.columnIndex]?.key;
      const r = rowKey ? workRowIndex(snap, rowKey) : -1;
      const c = columnKey ? workColumnIndex(snap, columnKey) : -1;
      if (r < 0 || c < 0) {
        skipped.push(`not-found:${change.id}`);
        continue;
      }
      const raw = rows[r + 1];
      const cells = [...(raw?.cells ?? [])];
      while (cells.length <= c) cells.push(emptyCell());
      cells[c] = withCellText(cells[c], change.after);
      const next = [...rows];
      next[r + 1] = { ...raw, cells };
      work = withRows(work, next);
      applied.push(change.id);
      continue;
    }

    if (change.kind === "rowAdded") {
      const source = theirsSnap.rows[change.rowIndex];
      const rawRow = tableRows(theirsBlock)[change.rowIndex + 1];
      if (!source || !rawRow) {
        skipped.push(`not-found:${change.id}`);
        continue;
      }
      if (workRowIndex(snap, source.key) >= 0) {
        // すでに同じ行がある（別の項目で入った）ので何もしない
        applied.push(change.id);
        continue;
      }
      // 提案側の列順を手元の列順へ組み替える。手元にしかない列は空セル
      const cells = snap.columns.map((column) => {
        const at = theirsSnap.columns.findIndex((c) => c.key === column.key);
        return at >= 0 ? clone(rawRow.cells?.[at] ?? emptyCell()) : emptyCell();
      });
      const newRow = { ...clone(rawRow), cells };
      // 提案側で 1 つ前にあった行の後ろへ。無ければ先頭 / 末尾
      const prevKey = theirsSnap.rows[change.rowIndex - 1]?.key;
      const prevAt = prevKey ? workRowIndex(snap, prevKey) : -1;
      const at = prevAt >= 0 ? prevAt + 2 : change.rowIndex === 0 ? 1 : rows.length;
      const next = [...rows];
      next.splice(at, 0, newRow);
      work = withRows(work, next);
      applied.push(change.id);
      continue;
    }

    if (change.kind === "rowRemoved") {
      const rowKey = mineSnap.rows[change.rowIndex]?.key;
      const r = rowKey ? workRowIndex(snap, rowKey) : -1;
      if (r < 0) {
        skipped.push(`not-found:${change.id}`);
        continue;
      }
      const next = [...rows];
      next.splice(r + 1, 1);
      work = withRows(work, next);
      applied.push(change.id);
      continue;
    }

    if (change.kind === "columnAdded") {
      const source = theirsSnap.columns[change.columnIndex];
      if (!source) {
        skipped.push(`not-found:${change.id}`);
        continue;
      }
      if (workColumnIndex(snap, source.key) >= 0) {
        applied.push(change.id);
        continue;
      }
      const prevKey = theirsSnap.columns[change.columnIndex - 1]?.key;
      const prevAt = prevKey ? workColumnIndex(snap, prevKey) : -1;
      const at = prevAt >= 0 ? prevAt + 1 : change.columnIndex === 0 ? 0 : snap.columns.length;
      const theirsRows = tableRows(theirsBlock);
      const next = rows.map((row, index) => {
        const cells = [...(row?.cells ?? [])];
        while (cells.length < snap.columns.length) cells.push(emptyCell());
        let cell: any = emptyCell();
        if (index === 0) {
          cell = clone(theirsRows[0]?.cells?.[source.index] ?? emptyCell());
        } else {
          const rowKey = snap.rows[index - 1]?.key;
          const theirsRowIndex = rowKey
            ? theirsSnap.rows.findIndex((candidate) => candidate.key === rowKey)
            : -1;
          if (theirsRowIndex >= 0) {
            cell = clone(theirsRows[theirsRowIndex + 1]?.cells?.[source.index] ?? emptyCell());
          }
        }
        cells.splice(at, 0, cell);
        return { ...row, cells };
      });
      const widths = columnWidthsOf(work);
      if (widths) widths.splice(at, 0, undefined);
      work = withRows(work, restoreRowIdentities(next), widths);
      applied.push(change.id);
      continue;
    }

    if (change.kind !== "columnRemoved") continue;
    const columnKey = mineSnap.columns[change.columnIndex]?.key;
    const c = columnKey ? workColumnIndex(snap, columnKey) : -1;
    if (c < 0) {
      skipped.push(`not-found:${change.id}`);
      continue;
    }
    const next = rows.map((row) => {
      const cells = [...(row?.cells ?? [])];
      if (c < cells.length) cells.splice(c, 1);
      return { ...row, cells };
    });
    const widths = columnWidthsOf(work);
    if (widths && c < widths.length) widths.splice(c, 1);
    work = withRows(work, restoreRowIdentities(next), widths);
    applied.push(change.id);
  }

  return { block: work, applied, skipped };
}

// ──────────────────────────────────────────────
// 本体
// ──────────────────────────────────────────────

/** 元側のブロック id（id 以外で対応付いたときは mineBlockId が入っている） */
function mineIdOf(change: BlockChange): string {
  return change.mineBlockId || change.blockId;
}

/**
 * 選んだ項目だけを手元の本文へ取り込む。純関数で、mine は変更しない。
 */
export function applyProposalChanges(
  input: ApplyProposalChangesInput,
): ApplyProposalChangesResult {
  const { mine, theirs, diff, selected } = input;
  const skipped: string[] = [];
  let applied = 0;

  if ((mine.pages?.length ?? 0) > 1 || (theirs.pages?.length ?? 0) > 1) {
    skipped.push("multiple-pages");
  }

  const minePage = mine.pages?.[0];
  const theirsPage = theirs.pages?.[0];
  if (!minePage) return { doc: mine, applied: 0, skipped };

  const blocks: any[] = clone(minePage.blocks ?? []);
  const theirsBlocks: any[] = theirsPage?.blocks ?? [];
  const theirsOrder = flattenIds(theirsBlocks);
  const theirsOrderIndex = new Map(theirsOrder.map((id, index) => [id, index]));

  // 提案側 id → 手元 id（id 以外で対応付いたブロックの読み替え表）
  const theirsToMine = new Map<string, string>();
  for (const change of diff.blocks) {
    if (change.mineBlockId && change.kind !== "removed") {
      theirsToMine.set(change.blockId, change.mineBlockId);
    }
  }
  const localIdOf = (theirsId: string): string => theirsToMine.get(theirsId) ?? theirsId;

  /** 提案側で手前にあったブロックのうち、手元にもあるものを遡って探す */
  const insertionAnchor = (theirsId: string): { afterId: string | null; atHead: boolean } => {
    const at = theirsOrderIndex.get(theirsId);
    if (at === undefined || at === 0) return { afterId: null, atHead: at === 0 };
    for (let i = at - 1; i >= 0; i -= 1) {
      const candidate = localIdOf(theirsOrder[i]);
      if (hasBlock(blocks, candidate)) return { afterId: candidate, atHead: false };
    }
    return { afterId: null, atHead: false };
  };

  const placeBlock = (theirsId: string, block: any): void => {
    const { afterId, atHead } = insertionAnchor(theirsId);
    if (afterId) {
      const found = findBlock(blocks, afterId);
      if (found) {
        found.list.splice(found.index + 1, 0, block);
        return;
      }
    }
    if (atHead) blocks.unshift(block);
    else blocks.push(block);
  };

  // 取り込んだブロックの対応（提案側 id → 手元 id）。ラベル / provLinks を写す範囲になる
  const adopted = new Map<string, string>();
  const removedIds = new Set<string>();

  // 1) 削除 — 先に外しておくと、後の位置決めが提案側の並びに素直に従う
  for (const change of diff.blocks) {
    if (change.kind !== "removed" || !selected.has(change.id)) continue;
    const found = findBlock(blocks, change.blockId);
    if (!found) {
      skipped.push(`not-found:${change.id}`);
      continue;
    }
    for (const id of flattenIds([found.list[found.index]])) removedIds.add(id);
    found.list.splice(found.index, 1);
    applied += 1;
  }

  // 2) 中身の差し替え（modified / table）
  for (const change of diff.blocks) {
    if (change.kind !== "modified" && change.kind !== "table") continue;
    const mineId = mineIdOf(change);
    const theirsBlock = findBlock(theirsBlocks, change.blockId);
    const found = findBlock(blocks, mineId);
    const wholeSelected = selected.has(change.id);
    const cellIds = (change.cells ?? []).filter((cell) => selected.has(cell.id));
    if (!wholeSelected && cellIds.length === 0) continue;
    if (!found || !theirsBlock) {
      skipped.push(`not-found:${change.id}`);
      continue;
    }
    const source = theirsBlock.list[theirsBlock.index];
    const current = found.list[found.index];

    if (wholeSelected) {
      // 提案側の中身で丸ごと置き換える。id と子ブロックは手元のまま
      // （子は差分の別項目として扱われるので、ここで持ち込むと二重になる）
      found.list[found.index] =
        change.kind === "table"
          ? withRows(current, clone(tableRows(source)))
          : { ...clone(source), id: current.id, children: current.children ?? [] };
      adopted.set(change.blockId, mineId);
      applied += 1;
      continue;
    }

    // 表のセル項目だけを選んだとき
    const result = applyTableCellChanges(current, source, change.cells ?? [], selected);
    found.list[found.index] = { ...result.block, id: current.id };
    skipped.push(...result.skipped);
    applied += result.applied.length;
    if (result.applied.length > 0) adopted.set(change.blockId, mineId);
  }

  // 3) 追加と並び替え — 提案側の文書順に処理すると、直前のブロックが先に置かれる
  const placements = diff.blocks
    .filter((change) => change.kind === "added" || change.kind === "moved")
    .filter((change) => selected.has(change.id))
    .sort(
      (a, b) =>
        (theirsOrderIndex.get(a.blockId) ?? Number.MAX_SAFE_INTEGER) -
        (theirsOrderIndex.get(b.blockId) ?? Number.MAX_SAFE_INTEGER),
    );

  for (const change of placements) {
    if (change.kind === "added") {
      if (hasBlock(blocks, change.blockId)) {
        // 親ごと取り込まれた子ブロック。すでに入っているので数だけ数える
        adopted.set(change.blockId, change.blockId);
        applied += 1;
        continue;
      }
      const source = findBlock(theirsBlocks, change.blockId);
      if (!source) {
        skipped.push(`not-found:${change.id}`);
        continue;
      }
      placeBlock(change.blockId, clone(source.list[source.index]));
      adopted.set(change.blockId, change.blockId);
      applied += 1;
      continue;
    }

    // moved: いったん外して、提案側の位置へ入れ直す
    const mineId = mineIdOf(change);
    const found = findBlock(blocks, mineId);
    if (!found) {
      skipped.push(`not-found:${change.id}`);
      continue;
    }
    const [block] = found.list.splice(found.index, 1);
    placeBlock(change.blockId, block);
    adopted.set(change.blockId, mineId);
    applied += 1;
  }

  // 4) ラベルと provLinks を、取り込んだブロックの分だけ写す
  const labels: Record<string, string> = { ...(minePage.labels ?? {}) };
  const theirsLabels = theirsPage?.labels ?? {};
  for (const [theirsId, mineId] of adopted) {
    const label = theirsLabels[theirsId];
    if (typeof label === "string") labels[mineId] = label;
  }
  for (const id of removedIds) delete labels[id];

  const alive = (link: BlockLink): boolean =>
    !removedIds.has(link.sourceBlockId) && !removedIds.has(link.targetBlockId);
  const provById = new Map<string, BlockLink>();
  for (const link of minePage.provLinks ?? []) {
    if (alive(link)) provById.set(link.id, link);
  }
  for (const link of theirsPage?.provLinks ?? []) {
    const source = adopted.get(link.sourceBlockId);
    if (!source) continue;
    const target = adopted.get(link.targetBlockId) ?? link.targetBlockId;
    if (!hasBlock(blocks, target)) continue; // 行き先が手元に無いリンクは運ばない
    provById.set(link.id, { ...clone(link), sourceBlockId: source, targetBlockId: target });
  }

  const knowledgeLinks = (minePage.knowledgeLinks ?? []).filter(alive);

  // 5) 題名
  let title = mine.title;
  if (diff.title && selected.has(diff.title.id)) {
    title = diff.title.after ?? "";
    applied += 1;
  }

  const pages = [...(mine.pages ?? [])];
  pages[0] = { ...minePage, blocks, labels, provLinks: [...provById.values()], knowledgeLinks };

  return { doc: { ...mine, title, pages }, applied, skipped };
}

// ──────────────────────────────────────────────
// 取り込み済みの提案（share-note が封筒に載せる）
// ──────────────────────────────────────────────

const ADOPTED_SOURCE_PREFIX = "shared:";

/**
 * documentProvenance の proposal_adopt アクティビティから、取り込んだ提案の
 * 共有エントリ id を集める（重複は除き、記録された順を保つ）。
 */
export function collectAdoptedProposals(doc: GraphiumDocument | null | undefined): string[] {
  const activities = doc?.documentProvenance?.activities ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const activity of activities) {
    if (activity?.type !== "proposal_adopt") continue;
    for (const source of activity.used ?? []) {
      if (typeof source !== "string" || !source.startsWith(ADOPTED_SOURCE_PREFIX)) continue;
      const id = source.slice(ADOPTED_SOURCE_PREFIX.length);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
