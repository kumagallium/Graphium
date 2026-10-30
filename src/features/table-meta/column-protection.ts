// 列の保護
//
// 「うっかり書き換えた」を防ぐための印で、値の検証でも強制でもない（表を共有した相手は外せる）。
// 保護の対象は 2 種類:
//   - 明示保護: 列ハンドルの「保護」（ColumnType "protected"）を付けた列。列ごと
//   - 計算の書き込み: 計算ブロックが実際に書いたセル（電卓の印が付くセル）と、その列の見出し。
//     同じ列に人が基準として入れたセルも混ざるので、列ごとではなくセル単位
//
// 止めるもの: 保護列の既存の行のセルの中身の変更・見出しの書き換え・列の削除。
// 許すもの: 行の追加・削除・並べ替え、保護列以外の列の追加・並べ替え、表ごとの削除。
//
// 実装は二重: (a) Decoration でセルを編集不可にして入力自体を受けず、
// (b) filterTransaction で貼り付け・ドロップ・API 経由など (a) をすり抜ける変更も止める。
// 自動処理（日時の自動記入・計算の書き戻し・左端への並べ直し等）は withProtectionBypass で通す。
// undo / redo は prosemirror-history のメタ（"history$"）で見分けて通す。

import { createExtension } from "@blocknote/core";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { calcWrittenCells, type CalcCellWrite } from "./calc-cells";
import type { TableMeta } from "./types";

/** 1 つの表について、何を保護するか */
export type TableProtection = {
  /** 明示保護の列名（列ごと） */
  columns: Set<string>;
  /** 計算ブロックが書き込む列名（見出しだけ保護する） */
  calcColumns: Set<string>;
  /** この表への書き戻し宣言（計算が書いたセルの割り出しに使う） */
  calcWrites: CalcCellWrite[];
};

/** 明示的に保護された列名（ColumnType "protected"） */
export function protectedColumnNames(meta: TableMeta | undefined): Set<string> {
  const out = new Set<string>();
  for (const [name, types] of Object.entries(meta?.columns ?? {})) {
    if (name !== "" && types.includes("protected")) out.add(name);
  }
  return out;
}

/** その表に計算ブロックが書き込む列名 */
export function calcWrittenColumnNames(
  calcWritebacks: Record<string, unknown[]> | undefined,
  blockId: string,
): Set<string> {
  const out = new Set<string>();
  for (const requests of Object.values(calcWritebacks ?? {})) {
    for (const req of requests as Partial<CalcCellWrite>[]) {
      if (req?.tableBlockId === blockId && req.column) out.add(req.column.trim());
    }
  }
  return out;
}

/** 表 1 つ分の保護の解決（ホストのストアから） */
export function resolveTableProtection(
  meta: TableMeta | undefined,
  calcWritebacks: Record<string, unknown[]> | undefined,
  blockId: string,
): TableProtection {
  const calcWrites: CalcCellWrite[] = [];
  for (const requests of Object.values(calcWritebacks ?? {})) {
    for (const req of requests as CalcCellWrite[]) {
      if (req?.tableBlockId === blockId) calcWrites.push(req);
    }
  }
  return {
    columns: protectedColumnNames(meta),
    calcColumns: calcWrittenColumnNames(calcWritebacks, blockId),
    calcWrites,
  };
}

function isEmptyProtection(p: TableProtection | undefined): boolean {
  return !p || (p.columns.size === 0 && p.calcColumns.size === 0);
}

// ── 純関数: 表の中身（文字列の格子）の比較 ────────────────────────────

/** 計算が書いたセル（rows の添字・列の添字）を格子から割り出す */
function calcCellsOfGrid(grid: string[][], blockId: string, writes: CalcCellWrite[]) {
  const block = {
    id: blockId,
    content: {
      rows: grid.map((row) => ({
        cells: row.map((text) => ({ type: "tableCell", content: [{ type: "text", text }] })),
      })),
    },
  };
  return calcWrittenCells(block, writes.map((w) => ({ ...w, tableBlockId: blockId })));
}

function countMap(values: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return m;
}

function sameArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * 表の編集（prev → next。どちらも trim 済みの文字列の格子で、0 行目が見出し）を通してよいか。
 * - 保護列の見出しが新しい見出しに無ければ止める（改名・列の削除）
 * - 明示保護の列: 旧の非空値の多重集合 O・新の非空値 N で、N ⊆ O かつ
 *   |O|-|N| ≤ max(0, 旧データ行数-新データ行数) なら通す（行の削除で減るのは可・空にするのは不可・新しい値は不可）
 * - 計算が書いたセル: 旧の同じ位置の値が変わったら止める。行数・列数が変わる変更と、
 *   行の並べ替えだけの変更は飛ばす（守りは Decoration に任せる）
 */
export function isTableEditAllowed(prev: string[][], next: string[][], prot: TableProtection): boolean {
  if (isEmptyProtection(prot) || prev.length === 0) return true;
  const prevHeaders = prev[0];
  const nextHeaders = next[0] ?? [];

  const named = new Set([...prot.columns, ...prot.calcColumns]);
  for (const name of named) {
    if (prevHeaders.includes(name) && !nextHeaders.includes(name)) return false;
  }

  const cellAt = (grid: string[][], r: number, c: number) => grid[r]?.[c] ?? "";
  const prevData = prev.length - 1;
  const nextData = next.length - 1;

  for (const name of prot.columns) {
    const pc = prevHeaders.indexOf(name);
    if (pc < 0) continue;
    const nc = nextHeaders.indexOf(name);
    const oldVals: string[] = [];
    for (let r = 1; r < prev.length; r++) {
      const v = cellAt(prev, r, pc);
      if (v !== "") oldVals.push(v);
    }
    const newVals: string[] = [];
    for (let r = 1; r < next.length; r++) {
      const v = cellAt(next, r, nc);
      if (v !== "") newVals.push(v);
    }
    const o = countMap(oldVals);
    for (const [v, n] of countMap(newVals)) {
      if (n > (o.get(v) ?? 0)) return false; // 新しい値
    }
    if (oldVals.length - newVals.length > Math.max(0, prevData - nextData)) return false; // 空にした
  }

  // 計算が書いたセル（形が変わる変更は飛ばす）
  if (prot.calcWrites.length > 0 && prevData === nextData && prevHeaders.length === nextHeaders.length) {
    const signature = (grid: string[][]) => grid.slice(1).map((r) => r.join("\u0001")).sort();
    const permutedOnly = sameArray(prevHeaders, nextHeaders) && sameArray(signature(prev), signature(next));
    if (!permutedOnly) {
      for (const { row, col } of calcCellsOfGrid(prev, "", prot.calcWrites)) {
        const nc = nextHeaders.indexOf(prevHeaders[col]);
        if (nc < 0) return false;
        if (cellAt(prev, row, col) !== cellAt(next, row, nc)) return false;
      }
    }
  }
  return true;
}

// ── 通す経路 ───────────────────────────────────────────────────────

let bypassDepth = 0;

/** 自動処理（日時の自動記入・計算の書き戻し・列の並べ直し等）の書き込みを保護の対象から外す */
export function withProtectionBypass<T>(fn: () => T): T {
  bypassDepth++;
  try {
    return fn();
  } finally {
    bypassDepth--;
  }
}

/** undo / redo のトランザクションか（prosemirror-history の PluginKey("history") のメタ） */
function isHistoryTransaction(tr: { getMeta: (k: string) => unknown }): boolean {
  return Boolean(tr.getMeta("history$"));
}

// ── エディタごとの解決 ─────────────────────────────────────────────

type Resolver = (blockId: string) => TableProtection | undefined;
const resolvers = new WeakMap<object, Resolver>();

/** ホスト（ノート / サイドピーク）が、表ブロック ID → 保護の解決を登録する */
export function setColumnProtectionResolver(editor: object, resolver: Resolver | null): void {
  if (resolver) resolvers.set(editor, resolver);
  else resolvers.delete(editor);
}

const pluginKey = new PluginKey<DecorationSet>("columnProtection");

/** 注釈（保護の付け外し・計算の書き込み先）が変わったとき、装飾を描き直す */
export function refreshColumnProtection(editor: any): void {
  try {
    const view = editor?._tiptapEditor?.view;
    if (!view || view.isDestroyed) return;
    view.dispatch(view.state.tr.setMeta(pluginKey, true).setMeta("addToHistory", false));
  } catch {
    // エディタの破棄直後など。次の変更で描き直される
  }
}

// ── ProseMirror の表の読み取り ───────────────────────────────────

type PmTable = { id: string; grid: string[][]; cellPos: number[][]; cellSize: number[][] };

/** doc 内の表（wanted が true を返す ID のみ）を、文字列の格子とセルの位置で読む */
function collectPmTables(doc: any, wanted: (id: string) => boolean): PmTable[] {
  const out: PmTable[] = [];
  doc.descendants((node: any, pos: number, parent: any) => {
    if (node.type.name !== "table") return true;
    const id = parent?.attrs?.id;
    if (typeof id === "string" && wanted(id)) {
      const grid: string[][] = [];
      const cellPos: number[][] = [];
      const cellSize: number[][] = [];
      node.forEach((row: any, rowOff: number) => {
        const g: string[] = [];
        const p: number[] = [];
        const s: number[] = [];
        row.forEach((cell: any, cellOff: number) => {
          g.push(cell.textContent.trim());
          p.push(pos + 1 + rowOff + 1 + cellOff);
          s.push(cell.nodeSize);
        });
        grid.push(g);
        cellPos.push(p);
        cellSize.push(s);
      });
      out.push({ id, grid, cellPos, cellSize });
    }
    return false;
  });
  return out;
}

// data-protected-cell の値で見た目を分ける（app.css）: "" = 本文のセル（薄い背景）/
// "column-header" = 手で保護した列の見出し（鍵の印）/ "header" = 計算が書く列の見出し
// （改名を止めるだけ。計算のセルには電卓の印が既にある）
type ProtectedKind = "" | "column-header" | "header";
const protectedAttrs = (kind: ProtectedKind) => ({ contenteditable: "false", "data-protected-cell": kind });

/** doc から装飾（保護するセルを編集不可にする）を組む */
function buildDecorations(doc: any, resolve: Resolver | undefined): DecorationSet {
  if (!resolve) return DecorationSet.empty;
  const protections = new Map<string, TableProtection>();
  const tables = collectPmTables(doc, (id) => {
    const p = resolve(id);
    if (isEmptyProtection(p)) return false;
    protections.set(id, p!);
    return true;
  });
  const decos: Decoration[] = [];
  for (const t of tables) {
    const prot = protections.get(t.id)!;
    const headers = t.grid[0] ?? [];
    const add = (r: number, c: number, kind: ProtectedKind = "") => {
      const from = t.cellPos[r]?.[c];
      const size = t.cellSize[r]?.[c];
      if (from === undefined || size === undefined) return;
      decos.push(Decoration.node(from, from + size, protectedAttrs(kind)));
    };
    // 見出しは明示保護の列と計算が書く列のどちらでも保護する
    headers.forEach((h, c) => {
      if (prot.columns.has(h)) add(0, c, "column-header");
      else if (prot.calcColumns.has(h)) add(0, c, "header");
    });
    const cols = headers.map((h) => prot.columns.has(h));
    for (let r = 1; r < t.grid.length; r++) cols.forEach((on, c) => on && add(r, c));
    for (const { row, col } of calcCellsOfGrid(t.grid, t.id, prot.calcWrites)) add(row, col);
  }
  return DecorationSet.create(doc, decos);
}

/** 弾いたときの通知（その表の 🔒 バッジを目立たせる） */
function notifyBlocked(blockId: string): void {
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent("graphium:protected-edit-blocked", { detail: { blockId } }));
  });
}

function createPlugin(editor: object): Plugin {
  const resolve = () => resolvers.get(editor);
  return new Plugin<DecorationSet>({
    key: pluginKey,
    state: {
      init: (_config, state) => buildDecorations(state.doc, resolve()),
      // 同じ doc ならキャッシュを返す。変わるのは本文の変更と refresh のときだけ
      apply: (tr, old, _oldState, newState) =>
        tr.docChanged || tr.getMeta(pluginKey) ? buildDecorations(newState.doc, resolve()) : old,
    },
    props: {
      decorations: (state) => pluginKey.getState(state),
    },
    filterTransaction(tr, state) {
      if (!tr.docChanged || bypassDepth > 0 || isHistoryTransaction(tr)) return true;
      const resolveFn = resolve();
      if (!resolveFn) return true;
      const protections = new Map<string, TableProtection>();
      const oldTables = collectPmTables(state.doc, (id) => {
        const p = resolveFn(id);
        if (isEmptyProtection(p)) return false;
        protections.set(id, p!);
        return true;
      });
      if (oldTables.length === 0) return true;
      const newTables = new Map(collectPmTables(tr.doc, (id) => protections.has(id)).map((t) => [t.id, t]));
      for (const old of oldTables) {
        const next = newTables.get(old.id);
        if (!next) continue; // 表ごとの削除は許す
        if (!isTableEditAllowed(old.grid, next.grid, protections.get(old.id)!)) {
          notifyBlocked(old.id);
          return false;
        }
      }
      return true;
    },
  });
}

// BlockNote の拡張として登録する（エディタごとに 1 つ。editor 実体でレジストリを引く）
export const columnProtectionExtension = createExtension(({ editor }) => ({
  key: "columnProtection",
  prosemirrorPlugins: [createPlugin(editor)],
}));
