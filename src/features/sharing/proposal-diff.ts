// 「変更の提案」の差分エンジン（純関数・React 非依存）。仕様 §25 B。
//
// 何を比べるか:
//   - 題名と pages[0] のブロックだけ。ページが 2 枚以上あるノートは比べきれないので
//     unsupported に理由を残し、1 ページ目だけを比べる
//   - 読まないもの（＝比較から外れるもの）: sharedRef / forkedFrom / templateFrom /
//     documentProvenance / chats / noteContexts / createdAt / modifiedAt
//   - 題名は末尾の " (forked)" を 1 回だけ落として比べる（fork の既定名を差分にしない）
//   - 媒体ブロックの props.url は比べない。共有側は shared-blob: に置き換わるので必ず
//     違う値になるため。alt / caption / name などその他の props は比べる
//   - ページ側の注釈（labels / provLinks / knowledgeLinks / tableMeta）は 8a では見ない
//
// どう対応付けるか（ブロック）:
//   children 込みで平坦化してから、(1) id 一致 → (2) 種類 + 正規化テキスト一致 →
//   (3) 残りを追加 / 削除、の順に対応付ける。(2) があるので「段落を分割して id が
//   変わった」程度では別物にならない。並びだけ変わったものは moved。
//   columnList / column はレイアウトの器なので項目にせず、中身だけを見る。
//
// 3 者比較:
//   base（fork した時点の版）があるときは、各項目に by を付ける。
//     theirs = base から提案者だけが変えた（＝取り込み候補）
//     mine   = base から作者だけが変えた（表示のみ）
//     both   = 両方が変えて中身が食い違う（競合）
//   base が無いときは 2 者比較に格下げし、全項目 unknown にする。

import type { GraphiumDocument } from "../../lib/document-types";
import { extractInlineText } from "../../mcp/note-text";
import { normalizeText } from "../lexical-search/tokenizer";
import { readTableData } from "../table-meta/table-cells";
import { TABLE_ROW_IDENTITY_STYLE } from "../../lib/table-row-identity";
import { blockToReadableText, MEDIA_BLOCK_TYPES } from "./proposal-block-text";

// ──────────────────────────────────────────────
// 型
// ──────────────────────────────────────────────

/** その変更が誰の側から来たか。base が無いときは全部 unknown。 */
export type ProposalChangeBy = "theirs" | "mine" | "both" | "unknown";

/** 1 項目の変更（題名など、before / after が 1 対で足りるもの）。 */
export type Change<T> = {
  by: ProposalChangeBy;
  /** 元のノート（作者）側の値 */
  before?: T;
  /** 提案側の値 */
  after?: T;
  /** 基準版の値（base があるときだけ） */
  base?: T;
};

/** 差分として扱えなかったものの理由。UI 側で文言に割り当てる。 */
export type ProposalUnsupportedReason = "multiple-pages";

export type BlockChangeKind = "added" | "removed" | "modified" | "moved" | "table";

/** 表ブロックの中の、セル単位の内訳。 */
export type TableCellChange =
  | {
      kind: "cellModified";
      by: ProposalChangeBy;
      /** 行の見出し（先頭セルの文字列。空なら UI 側で行番号を出す） */
      rowLabel: string;
      /** 行の並び（提案側優先。提案側に無ければ元側） */
      rowIndex: number;
      /** 列の見出し（ヘッダ文字列。空なら UI 側で列番号を出す） */
      column: string;
      columnIndex: number;
      before: string;
      after: string;
    }
  | {
      kind: "rowAdded" | "rowRemoved";
      by: ProposalChangeBy;
      rowLabel: string;
      rowIndex: number;
      /** その行の値（列の並び順） */
      cells: string[];
    }
  | {
      kind: "columnAdded" | "columnRemoved";
      by: ProposalChangeBy;
      column: string;
      columnIndex: number;
      /** その列の値（行の並び順） */
      cells: string[];
    };

/** ブロック 1 個ぶんの変更。 */
export type BlockChange = {
  kind: BlockChangeKind;
  by: ProposalChangeBy;
  /** 提案側のブロック id（削除は元側の id） */
  blockId: string;
  /** 元のノート側のブロック id。id 以外で対応付いたときは blockId と別値になる */
  mineBlockId?: string;
  /** ブロックの種類（提案側優先） */
  blockType: string;
  /** 表示用テキスト: 元のノート側 */
  before: string;
  /** 表示用テキスト: 提案側 */
  after: string;
  /** 表示用テキスト: 基準版（base があり、そのブロックが基準版にもあるとき） */
  base?: string;
  /** 読めるテキストは同じで props だけが変わった（chart / calc など設定の変更） */
  propsOnly?: boolean;
  /** 中身に加えて並びも変わった（kind が modified / table のときの付随情報） */
  moved?: boolean;
  /** 表ブロックのセル単位の内訳（kind === "table"） */
  cells?: TableCellChange[];
};

export type ProposalDiff = {
  /** 題名の変更（無ければ undefined） */
  title?: Change<string>;
  /** ブロックの変更。並びは提案側の文書順（削除は元側の直前ブロックの後ろ） */
  blocks: BlockChange[];
  /** 比べきれなかったものの理由 */
  unsupported: ProposalUnsupportedReason[];
};

export type ProposalDiffInput = {
  /** 基準版（fork した時点の本文）。無ければ 2 者比較になる */
  base?: GraphiumDocument | null;
  /** 元のノートの現在の本文（作者側） */
  mine: GraphiumDocument;
  /** 提案の本文 */
  theirs: GraphiumDocument;
};

/** 一覧の見出しに出すための集計。 */
export type ProposalDiffSummary = {
  total: number;
  added: number;
  removed: number;
  modified: number;
  moved: number;
  /** 表ブロックの件数（セル項目の数ではない） */
  tables: number;
  byTheirs: number;
  byMine: number;
  byBoth: number;
  byUnknown: number;
};

// ──────────────────────────────────────────────
// 小さな道具
// ──────────────────────────────────────────────

const FORK_TITLE_SUFFIX = " (forked)";

/** 題名の末尾の " (forked)" を 1 回だけ落とす（fork の既定名を差分にしないため） */
export function stripForkSuffix(title: string): string {
  return title.endsWith(FORK_TITLE_SUFFIX)
    ? title.slice(0, title.length - FORK_TITLE_SUFFIX.length)
    : title;
}

/** レイアウトの器。項目にはせず中身だけを見る */
const LAYOUT_BLOCK_TYPES = new Set(["columnList", "column"]);

/** キー順に依存しない JSON 化（props の書き順の違いを差分にしないため） */
function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
    .join(",")}}`;
}

/** props の署名。媒体ブロックの url だけ外す */
function propsSignature(block: Record<string, any>): string {
  const props = block.props;
  if (!props || typeof props !== "object") return "";
  const skipUrl = MEDIA_BLOCK_TYPES.has(block.type);
  const entries = Object.keys(props)
    .filter((key) => !(skipUrl && key === "url"))
    .sort()
    .map((key) => [key, props[key]] as const);
  return stableStringify(entries);
}

/** 対応付け用の素のテキスト（表はセルを並べたもの） */
function blockPlainText(block: Record<string, any>): string {
  if (block.type === "table") {
    const data = readTableData(block);
    if (!data) return "";
    return [data.header, ...data.rows].map((row) => row.join("\t")).join("\n");
  }
  return extractInlineText(block.content);
}

/** 中身が変わったかを判定するための署名（子ブロックは含めない） */
function blockSignature(block: Record<string, any>): string {
  const type = typeof block.type === "string" ? block.type : "";
  if (type === "table") {
    const data = readTableData(block);
    return stableStringify([type, data?.header ?? [], data?.rows ?? [], propsSignature(block)]);
  }
  const content = block.content;
  // content が配列でないブロック（独自の入れ物を持つもの）は中身も署名に入れる
  const extra = content && typeof content === "object" && !Array.isArray(content) ? content : null;
  return stableStringify([type, extractInlineText(content), extra, propsSignature(block)]);
}

// ──────────────────────────────────────────────
// ブロックの平坦化と対応付け
// ──────────────────────────────────────────────

type FlatBlock = {
  id: string;
  type: string;
  block: Record<string, any>;
  /** 平坦化した並び順（0 始まり） */
  order: number;
  /** 種類 + 正規化テキスト。空テキストのときは空文字（対応付けに使わない） */
  textKey: string;
  /** 中身の署名 */
  signature: string;
  /** 直前のブロックの識別子。並びが動いたのがどちら側かの手がかりにする */
  prevKey: string;
};

/** pages[0] のブロックを children 込みで平坦化する */
function flattenBlocks(blocks: any[]): FlatBlock[] {
  const out: FlatBlock[] = [];
  let prevKey = "";
  const visit = (list: any[]): void => {
    for (const raw of list ?? []) {
      if (!raw || typeof raw !== "object") continue;
      const block = raw as Record<string, any>;
      const type = typeof block.type === "string" ? block.type : "";
      if (!LAYOUT_BLOCK_TYPES.has(type)) {
        const plain = normalizeText(blockPlainText(block)).trim();
        const textKey = plain ? `${type} ${plain}` : "";
        const id = typeof block.id === "string" ? block.id : "";
        out.push({
          id,
          type,
          block,
          order: out.length,
          textKey,
          signature: blockSignature(block),
          prevKey,
        });
        prevKey = id || textKey;
      }
      if (Array.isArray(block.children) && block.children.length > 0) visit(block.children);
    }
  };
  visit(blocks ?? []);
  return out;
}

function firstPageBlocks(doc: GraphiumDocument | null | undefined): any[] {
  return doc?.pages?.[0]?.blocks ?? [];
}

/** キー → まだ使っていない要素の待ち行列 */
function queueBy(items: FlatBlock[], key: (item: FlatBlock) => string): Map<string, FlatBlock[]> {
  const map = new Map<string, FlatBlock[]>();
  for (const item of items) {
    const k = key(item);
    if (!k) continue;
    const queue = map.get(k);
    if (queue) queue.push(item);
    else map.set(k, [item]);
  }
  return map;
}

function popFrom(map: Map<string, FlatBlock[]>, key: string): FlatBlock | undefined {
  if (!key) return undefined;
  const queue = map.get(key);
  if (!queue || queue.length === 0) return undefined;
  return queue.shift();
}

type BlockGroup = { base?: FlatBlock; mine?: FlatBlock; theirs?: FlatBlock };

/** 元側と提案側を (1) id → (2) 種類 + 正規化テキスト → (3) 残り の順で対応付ける */
function alignBlocks(mine: FlatBlock[], theirs: FlatBlock[]): BlockGroup[] {
  const pairedMine = new Set<FlatBlock>();
  const paired = new Map<FlatBlock, FlatBlock>();

  const mineById = queueBy(mine, (b) => b.id);
  for (const t of theirs) {
    const m = popFrom(mineById, t.id);
    if (m) {
      paired.set(t, m);
      pairedMine.add(m);
    }
  }

  const mineByText = queueBy(
    mine.filter((m) => !pairedMine.has(m)),
    (b) => b.textKey,
  );
  for (const t of theirs) {
    if (paired.has(t)) continue;
    const m = popFrom(mineByText, t.textKey);
    if (m) {
      paired.set(t, m);
      pairedMine.add(m);
    }
  }

  const groups: BlockGroup[] = [];
  for (const t of theirs) groups.push({ theirs: t, mine: paired.get(t) });
  for (const m of mine) if (!pairedMine.has(m)) groups.push({ mine: m });
  return groups;
}

/** 基準版を各組に結び付ける（id → 種類 + 正規化テキスト の順） */
function attachBase(groups: BlockGroup[], base: FlatBlock[]): void {
  const byId = queueBy(base, (b) => b.id);
  for (const group of groups) {
    const found = popFrom(byId, group.theirs?.id ?? "") ?? popFrom(byId, group.mine?.id ?? "");
    if (found) group.base = found;
  }
  const used = new Set(groups.map((g) => g.base).filter((b): b is FlatBlock => Boolean(b)));
  const byText = queueBy(
    base.filter((b) => !used.has(b)),
    (b) => b.textKey,
  );
  for (const group of groups) {
    if (group.base) continue;
    const found =
      popFrom(byText, group.theirs?.textKey ?? "") ?? popFrom(byText, group.mine?.textKey ?? "");
    if (found) group.base = found;
  }
}

/** 最長増加部分列に残る位置（＝並びが動いていないとみなすブロック） */
function stablePositions(seq: number[]): Set<number> {
  const tails: number[] = [];
  const prev: number[] = new Array(seq.length).fill(-1);
  for (let i = 0; i < seq.length; i += 1) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]] < seq[i]) lo = mid + 1;
      else hi = mid;
    }
    prev[i] = lo > 0 ? tails[lo - 1] : -1;
    if (lo === tails.length) tails.push(i);
    else tails[lo] = i;
  }
  const keep = new Set<number>();
  let cur = tails.length > 0 ? tails[tails.length - 1] : -1;
  while (cur >= 0) {
    keep.add(cur);
    cur = prev[cur];
  }
  return keep;
}

// ──────────────────────────────────────────────
// 3 者分類
// ──────────────────────────────────────────────

/**
 * base からの動きで「誰が変えたか」を決める。値が undefined なら「そこに無い」の意味。
 * base が無いときは判定できないので unknown。
 */
function classifyChange(
  hasBase: boolean,
  base: string | undefined,
  mine: string | undefined,
  theirs: string | undefined,
): ProposalChangeBy {
  if (!hasBase) return "unknown";
  const changedMine = base !== mine;
  const changedTheirs = base !== theirs;
  if (changedTheirs && !changedMine) return "theirs";
  if (changedMine && !changedTheirs) return "mine";
  if (changedMine && changedTheirs) return "both";
  return "unknown";
}

// ──────────────────────────────────────────────
// 表（セル単位）
// ──────────────────────────────────────────────

type TableColumn = { key: string; name: string; index: number };
type TableRow = { key: string; label: string; index: number; cells: Map<string, string> };
type TableSnapshot = {
  columns: TableColumn[];
  rows: TableRow[];
  columnByKey: Map<string, TableColumn>;
  rowByKey: Map<string, TableRow>;
};

/** 行の永続 identity（先頭セルのインライン styles に載っている）を読む */
function readRowIdentity(cell: any): string | undefined {
  const content = Array.isArray(cell)
    ? cell
    : cell?.type === "tableCell" && Array.isArray(cell.content)
      ? cell.content
      : null;
  if (!content) return undefined;
  for (const inline of content) {
    const value = inline?.styles?.[TABLE_ROW_IDENTITY_STYLE];
    if (typeof value === "string" && value) return value;
    if (inline?.type === "link" && Array.isArray(inline.content)) {
      const nested = readRowIdentity(inline.content);
      if (nested) return nested;
    }
  }
  return undefined;
}

/** 同じキーが並んだときに 1 つずつずらす */
function uniqueKey(used: Map<string, number>, base: string): string {
  const seen = used.get(base) ?? 0;
  used.set(base, seen + 1);
  return seen === 0 ? base : `${base}#${seen}`;
}

/**
 * 表ブロックを「列（ヘッダ文字列）× 行（identity → 先頭セル文字列 → 並び）」で読む。
 * ヘッダが空の列と、identity も先頭セルも空の行は並びで対応付ける。
 */
function readTableSnapshot(block: Record<string, any>): TableSnapshot | null {
  const data = readTableData(block);
  if (!data) return null;
  const rawRows: any[] = block.content?.rows ?? [];

  const columnKeys = new Map<string, number>();
  const columns: TableColumn[] = data.header.map((name, index) => ({
    key: name ? uniqueKey(columnKeys, `name:${name}`) : `index:${index}`,
    name,
    index,
  }));

  const rowKeys = new Map<string, number>();
  const rows: TableRow[] = data.rows.map((values, index) => {
    const rawCells = rawRows[index + 1]?.cells ?? [];
    const identity = readRowIdentity(rawCells[0]);
    const label = values[0] ?? "";
    const seed = identity ? `id:${identity}` : label ? `text:${label}` : `index:${index}`;
    const cells = new Map<string, string>();
    columns.forEach((column, i) => cells.set(column.key, values[i] ?? ""));
    return { key: uniqueKey(rowKeys, seed), label, index, cells };
  });

  return {
    columns,
    rows,
    columnByKey: new Map(columns.map((c) => [c.key, c])),
    rowByKey: new Map(rows.map((r) => [r.key, r])),
  };
}

function cellValue(
  snapshot: TableSnapshot | null | undefined,
  rowKey: string,
  columnKey: string,
): string | undefined {
  return snapshot?.rowByKey.get(rowKey)?.cells.get(columnKey);
}

/** 行の値を「その表の列順」で並べる */
function rowValues(snapshot: TableSnapshot, row: TableRow): string[] {
  return snapshot.columns.map((column) => row.cells.get(column.key) ?? "");
}

/** 列の値を「その表の行順」で並べる */
function columnValues(snapshot: TableSnapshot, columnKey: string): string[] {
  return snapshot.rows.map((row) => row.cells.get(columnKey) ?? "");
}

function rowSignature(
  snapshot: TableSnapshot | null | undefined,
  rowKey: string,
): string | undefined {
  if (!snapshot) return undefined;
  const row = snapshot.rowByKey.get(rowKey);
  return row ? stableStringify(rowValues(snapshot, row)) : undefined;
}

function diffTable(
  hasBase: boolean,
  base: TableSnapshot | null,
  mine: TableSnapshot,
  theirs: TableSnapshot,
): TableCellChange[] {
  const changes: TableCellChange[] = [];

  // 列: 提案側の並びを先に、元側にしか無い列を後ろに
  const columnKeys: string[] = [...theirs.columns.map((c) => c.key)];
  for (const column of mine.columns) {
    if (!theirs.columnByKey.has(column.key)) columnKeys.push(column.key);
  }

  for (const key of columnKeys) {
    const inMine = mine.columnByKey.get(key);
    const inTheirs = theirs.columnByKey.get(key);
    if (inMine && inTheirs) continue;
    const by = classifyChange(
      hasBase,
      base?.columnByKey.has(key) ? "present" : undefined,
      inMine ? "present" : undefined,
      inTheirs ? "present" : undefined,
    );
    if (inTheirs) {
      changes.push({
        kind: "columnAdded",
        by,
        column: inTheirs.name,
        columnIndex: inTheirs.index,
        cells: columnValues(theirs, key),
      });
    } else if (inMine) {
      changes.push({
        kind: "columnRemoved",
        by,
        column: inMine.name,
        columnIndex: inMine.index,
        cells: columnValues(mine, key),
      });
    }
  }

  // 行: 提案側の並びを先に、元側にしか無い行を後ろに
  const rowKeys: string[] = [...theirs.rows.map((r) => r.key)];
  for (const row of mine.rows) {
    if (!theirs.rowByKey.has(row.key)) rowKeys.push(row.key);
  }

  for (const key of rowKeys) {
    const inMine = mine.rowByKey.get(key);
    const inTheirs = theirs.rowByKey.get(key);
    if (inTheirs && !inMine) {
      changes.push({
        kind: "rowAdded",
        by: classifyChange(hasBase, rowSignature(base, key), undefined, rowSignature(theirs, key)),
        rowLabel: inTheirs.label,
        rowIndex: inTheirs.index,
        cells: rowValues(theirs, inTheirs),
      });
      continue;
    }
    if (inMine && !inTheirs) {
      changes.push({
        kind: "rowRemoved",
        by: classifyChange(hasBase, rowSignature(base, key), rowSignature(mine, key), undefined),
        rowLabel: inMine.label,
        rowIndex: inMine.index,
        cells: rowValues(mine, inMine),
      });
      continue;
    }
    if (!inMine || !inTheirs) continue;

    for (const columnKey of columnKeys) {
      const column = theirs.columnByKey.get(columnKey);
      if (!column || !mine.columnByKey.has(columnKey)) continue;
      const before = inMine.cells.get(columnKey) ?? "";
      const after = inTheirs.cells.get(columnKey) ?? "";
      if (before === after) continue;
      changes.push({
        kind: "cellModified",
        by: classifyChange(hasBase, cellValue(base, key, columnKey), before, after),
        rowLabel: inTheirs.label,
        rowIndex: inTheirs.index,
        column: column.name,
        columnIndex: column.index,
        before,
        after,
      });
    }
  }

  return changes;
}

// ──────────────────────────────────────────────
// 本体
// ──────────────────────────────────────────────

/**
 * 元のノート（mine）と提案（theirs）の差分を作る。基準版（base）があれば
 * 「誰が変えたか」まで分類する。React に依存しない純関数。
 */
export function computeProposalDiff(input: ProposalDiffInput): ProposalDiff {
  const { mine, theirs } = input;
  const base = input.base ?? null;
  const hasBase = Boolean(base);
  const unsupported: ProposalUnsupportedReason[] = [];

  if ((mine.pages?.length ?? 0) > 1 || (theirs.pages?.length ?? 0) > 1) {
    unsupported.push("multiple-pages");
  }

  const mineFlat = flattenBlocks(firstPageBlocks(mine));
  const theirsFlat = flattenBlocks(firstPageBlocks(theirs));
  const groups = alignBlocks(mineFlat, theirsFlat);
  if (base) attachBase(groups, flattenBlocks(firstPageBlocks(base)));

  // 並びが動いたブロックを見つける（中身が同じでも位置が変わったもの）
  const matched = groups
    .filter((g) => g.mine && g.theirs)
    .sort((a, b) => (a.theirs as FlatBlock).order - (b.theirs as FlatBlock).order);
  const keep = stablePositions(matched.map((g) => (g.mine as FlatBlock).order));
  const movedGroups = new Set<BlockGroup>();
  matched.forEach((group, index) => {
    if (!keep.has(index)) movedGroups.add(group);
  });

  // 表示順: 提案側の文書順。削除だけの項目は元側で直前にあったブロックの後ろへ差し込む
  const removalKey = new Map<BlockGroup, number>();
  const groupByMine = new Map<FlatBlock, BlockGroup>();
  for (const group of groups) if (group.mine) groupByMine.set(group.mine, group);
  let lastOrder = -1;
  let pending = 0;
  for (const m of mineFlat) {
    const group = groupByMine.get(m);
    if (!group) continue;
    if (group.theirs) {
      lastOrder = group.theirs.order;
      pending = 0;
    } else {
      pending += 1;
      removalKey.set(group, lastOrder + pending / (pending + 1));
    }
  }

  const items: { key: number; change: BlockChange }[] = [];
  for (const group of groups) {
    const { mine: m, theirs: t, base: b } = group;
    const by = classifyChange(hasBase, b?.signature, m?.signature, t?.signature);

    if (m && t) {
      const changed = m.signature !== t.signature;
      const moved = movedGroups.has(group);
      if (!changed && !moved) continue;
      const before = blockToReadableText(m.block);
      const after = blockToReadableText(t.block);
      const isTable = m.type === "table" && t.type === "table";
      const change: BlockChange = {
        kind: changed ? (isTable ? "table" : "modified") : "moved",
        // 中身が同じで位置だけ動いたものは、直前のブロックがどちら側で変わったかで見る
        by: changed ? by : classifyChange(hasBase, b?.prevKey, m.prevKey, t.prevKey),
        blockId: t.id,
        blockType: t.type,
        before,
        after,
      };
      if (m.id !== t.id) change.mineBlockId = m.id;
      if (b) change.base = blockToReadableText(b.block);
      if (changed && before === after) change.propsOnly = true;
      if (changed && moved) change.moved = true;
      if (changed && isTable) {
        const mineSnap = readTableSnapshot(m.block);
        const theirsSnap = readTableSnapshot(t.block);
        change.cells =
          mineSnap && theirsSnap
            ? diffTable(hasBase, b ? readTableSnapshot(b.block) : null, mineSnap, theirsSnap)
            : [];
      }
      items.push({ key: t.order, change });
      continue;
    }

    if (t) {
      const change: BlockChange = {
        kind: "added",
        by,
        blockId: t.id,
        blockType: t.type,
        before: "",
        after: blockToReadableText(t.block),
      };
      if (b) change.base = blockToReadableText(b.block);
      items.push({ key: t.order, change });
      continue;
    }

    if (m) {
      const change: BlockChange = {
        kind: "removed",
        by,
        blockId: m.id,
        blockType: m.type,
        before: blockToReadableText(m.block),
        after: "",
      };
      if (b) change.base = blockToReadableText(b.block);
      items.push({ key: removalKey.get(group) ?? -1, change });
    }
  }

  items.sort((a, b) => a.key - b.key);
  const diff: ProposalDiff = { blocks: items.map((item) => item.change), unsupported };

  const mineTitle = stripForkSuffix(mine.title ?? "");
  const theirsTitle = stripForkSuffix(theirs.title ?? "");
  if (mineTitle !== theirsTitle) {
    diff.title = {
      by: classifyChange(
        hasBase,
        base ? stripForkSuffix(base.title ?? "") : undefined,
        mineTitle,
        theirsTitle,
      ),
      before: mine.title ?? "",
      after: theirs.title ?? "",
    };
    if (base) diff.title.base = base.title ?? "";
  }

  return diff;
}

/** 一覧の見出し用の集計（題名の変更は数えない） */
export function summarizeProposalDiff(diff: ProposalDiff): ProposalDiffSummary {
  const summary: ProposalDiffSummary = {
    total: diff.blocks.length,
    added: 0,
    removed: 0,
    modified: 0,
    moved: 0,
    tables: 0,
    byTheirs: 0,
    byMine: 0,
    byBoth: 0,
    byUnknown: 0,
  };
  for (const change of diff.blocks) {
    if (change.kind === "added") summary.added += 1;
    else if (change.kind === "removed") summary.removed += 1;
    else if (change.kind === "modified") summary.modified += 1;
    else if (change.kind === "moved") summary.moved += 1;
    else summary.tables += 1;

    if (change.by === "theirs") summary.byTheirs += 1;
    else if (change.by === "mine") summary.byMine += 1;
    else if (change.by === "both") summary.byBoth += 1;
    else summary.byUnknown += 1;
  }
  return summary;
}
