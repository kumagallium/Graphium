// 記録テーブルの自動日時記入
//
// 専用の「+ 記録」ボタンは持たない。記録テーブルは「行を足すと日時の列に
// 日時が入るふるまいがオンになった、ただのテーブル」であり、行の追加は
// BlockNote 標準の操作（テーブル下端の + 帯・最終セルで Tab・右クリック・
// ペースト）をそのまま使う。ここは editor.onChange 経由で行数の増加を検知し、
// 日時の列が空の行に現在日時を書き込むだけの薄いレイヤー。
//
// - 日時の列は、ふるまい（tableMeta.columns）が付いた列名で引く。名前が見つからない
//   （旧データ・改名済み）ときは先頭列にフォールバックする
// - 列の改名・削除は見出しの変化から検知し、呼び出し側のコールバックで注釈へ反映する
// - ノートを開いた直後（初見）は記録だけ行い、既存の空セルには書き込まない
// - 行数が減った・変わらないときは何も書かない（undo を邪魔しない）
// - 書き込みは editor.updateBlock なので再び onChange が走るが、その回は
//   行数が変わらないため何もせず収束する

import { formatDateTime } from "../../lib/format-datetime";
import { findColumnIndexByName, readCellText } from "../table-meta/table-cells";
import { findColumnNameByType, type TableMeta } from "../table-meta/types";

/** 表ごとの日時列の解決と、改名・削除への追従（省略時は従来どおり先頭列固定） */
export type LogTableColumnOptions = {
  /** 表の日時列の名前（ふるまいが付いた列名）。無ければ先頭列 */
  columnNameOf?: (blockId: string) => string | undefined;
  /** 日時列の見出しが書き換わったと判断したとき（注釈のキーを付け替える） */
  onRenameColumn?: (blockId: string, from: string, to: string) => void;
  /** 日時列が消えたと判断したとき（ふるまいを外す） */
  onRemoveColumn?: (blockId: string) => void;
};

/** ストアの読み口から LogTableColumnOptions を組む（呼び出し側の配線を 1 箇所に） */
export function logTableColumnOptions(store: {
  getSnapshot: () => Record<string, TableMeta>;
  renameColumn: (blockId: string, from: string, to: string) => void;
  removeColumnType: (blockId: string, type: "datetime-auto") => void;
}): LogTableColumnOptions {
  return {
    columnNameOf: (blockId) => findColumnNameByType(store.getSnapshot()[blockId], "datetime-auto"),
    onRenameColumn: (blockId, from, to) => store.renameColumn(blockId, from, to),
    onRemoveColumn: (blockId) => store.removeColumnType(blockId, "datetime-auto"),
  };
}

/** 見出し行のテキスト配列 */
function readHeaders(block: any): string[] {
  const cells = (block?.content?.rows ?? [])[0]?.cells ?? [];
  return cells.map((c: any) => readCellText(c));
}

/** セルの形式（tableCell / 旧 inline 配列）を保ったままテキストだけのセルを作る */
function withCellText(cell: any, text: string): any {
  const content = [{ type: "text", text, styles: {} }];
  if (cell && !Array.isArray(cell) && cell.type === "tableCell") {
    return { ...cell, content };
  }
  return content;
}

// エディタ → （テーブルブロック ID → 直近に見た行数（ヘッダ込み））
// メインエディタと SidePeek は同時に開いていて、それぞれ別のノートを持つ。記録を
// 1 つにまとめると、片方の読み込み（prime）がもう片方の記録を消し、消された側の
// 次の行追加が「初見」扱いになって日時が入らない。エディタはノートを開くたびに
// 作り直されるので、ノート切替で前の記録を捨てる処理は要らない。
const rowCountsByEditor = new WeakMap<object, Map<string, number>>();

function countOf(list: string[], value: string): number {
  return list.reduce((n, v) => (v === value ? n + 1 : n), 0);
}

/**
 * 注釈の名前が見出しに無い表を初めて見たときの列位置。見出しが空の列が 1 つだけ
 * あれば、日時列の見出しを消したまま保存したものとみなしてその列。それ以外は
 * 先頭列（ふるまいが先頭列固定だった頃のデータで、先頭列の見出しを改名したもの）
 */
function guessMissingColumnIndex(headers: string[]): number {
  return countOf(headers, "") === 1 ? headers.indexOf("") : 0;
}

/** 表を初めて見たときの日時列の位置 */
function initialColumnIndex(block: any, columnName: string | undefined): number {
  const headers = readHeaders(block);
  if (columnName === undefined || headers.includes(columnName)) {
    return findColumnIndexByName(block, columnName);
  }
  return guessMissingColumnIndex(headers);
}

/**
 * 表の追跡の記録を捨てる。時系列テーブルを付け直す直前に呼ぶ — 外していた間は
 * onChange で記録が更新されないので、古い記録と比べると、その間に足した行まで
 * 「新しく増えた行」とみなして日時を入れてしまう。
 */
export function forgetLogTableTracking(editor: object | null | undefined, blockId: string): void {
  if (!editor) return;
  rowCountsOf(editor).delete(blockId);
  headerTracksOf(editor).delete(blockId);
}

/** データ行ごとの中身（全セルのテキストをつないだもの）。どの行が増えたかの判定に使う */
function readRowSignatures(block: any): string[] {
  const rows: any[] = block?.content?.rows ?? [];
  return rows.slice(1).map((r) => (r?.cells ?? []).map((c: any) => readCellText(c)).join("\u0001"));
}

/**
 * 直近の行と今の行を先頭から突き合わせ、新しく増えた行の位置（content.rows の位置。
 * 見出しが 0）を返す。中身が同じ行は前から順に対応させる — 途中に挿した行・末尾に
 * 足した行・貼り付けた複数行のどれでも、増えた分だけが残る。
 */
export function findAddedRows(prev: string[], current: string[]): Set<number> {
  const added = new Set<number>();
  let j = 0;
  for (let i = 0; i < current.length; i++) {
    if (j < prev.length && current[i] === prev[j]) {
      j++;
    } else {
      added.add(i + 1);
    }
  }
  return added;
}

// エディタ → （テーブルブロック ID → 直近の見出し・直近に解決した日時列の位置・データ行の中身）
// 見出しは改名・削除の判定に、行の中身は「どの行が新しく増えたか」の判定に使う。
// 行数と同じ理由でエディタ単位に持つ
type HeaderTrack = { headers: string[]; index: number; rows: string[] };
const headerTracksByEditor = new WeakMap<object, Map<string, HeaderTrack>>();

function headerTracksOf(editor: object): Map<string, HeaderTrack> {
  let tracks = headerTracksByEditor.get(editor);
  if (!tracks) {
    tracks = new Map();
    headerTracksByEditor.set(editor, tracks);
  }
  return tracks;
}

function rowCountsOf(editor: object): Map<string, number> {
  let counts = rowCountsByEditor.get(editor);
  if (!counts) {
    counts = new Map();
    rowCountsByEditor.set(editor, counts);
  }
  return counts;
}

/**
 * ノートを開いたときに、各記録テーブルの行数をそのエディタの分として先に記録して
 * おく。これが無いと「ノートを開いて最初の行追加」が初見扱いになり日時が入らない
 * （初見で書き込まないのは、既存の空セルを勝手に埋めないための仕様）。
 *
 * まだ記録の無い表だけを記録し、記録済みの行数は上書きしない。ホストは表の注釈の
 * 復元とエディタの公開のどちらが先でも取りこぼさないよう両方の時点で呼ぶので、
 * 後から古い本文や空の一覧で呼ばれても、その間に足した行の記録を崩さないため。
 */
export function primeLogTableRowTracking(
  editor: object | null | undefined,
  blocks: any[],
  logTableIds: Iterable<string>,
  options?: LogTableColumnOptions
): void {
  if (!editor) return;
  const ids = new Set(logTableIds);
  if (ids.size === 0) return;
  const counts = rowCountsOf(editor);
  const tracks = headerTracksOf(editor);
  const visit = (list: any[]) => {
    for (const b of list ?? []) {
      if (b?.type === "table" && ids.has(b.id) && !counts.has(b.id)) {
        counts.set(b.id, (b.content?.rows ?? []).length);
        tracks.set(b.id, {
          headers: readHeaders(b),
          index: initialColumnIndex(b, options?.columnNameOf?.(b.id)),
          rows: readRowSignatures(b),
        });
      }
      if (Array.isArray(b?.children)) visit(b.children);
    }
  };
  visit(blocks ?? []);
}

/**
 * 登録済み記録テーブルの行数変化を調べ、増えていれば日時の列が空の
 * データ行に現在日時を書き込む。editor.onChange から毎回呼んでよい。
 * 行数の記録は渡されたエディタの分だけを読み書きする。
 *
 * 日時の列は options.columnNameOf の列名で引く（無ければ先頭列）。名前が見出しに
 * 無いときは、直近に追っていた列を見出しで探し直す。列数が減ってその列も消えたなら
 * onRemoveColumn、その列の見出しが書き換わっていたなら onRenameColumn を呼ぶ。
 */
export function applyLogTableTimestamps(
  editor: any,
  logTableIds: Iterable<string>,
  now: Date = new Date(),
  options?: LogTableColumnOptions
): void {
  if (!editor) return;
  const prevRowCounts = rowCountsOf(editor);
  const tracks = headerTracksOf(editor);
  for (const blockId of logTableIds) {
    const block = editor?.getBlock?.(blockId);
    if (!block || block.type !== "table") {
      prevRowCounts.delete(blockId);
      tracks.delete(blockId);
      continue;
    }
    const rows: any[] = block.content?.rows ?? [];
    const prev = prevRowCounts.get(blockId);
    prevRowCounts.set(blockId, rows.length);

    // ── 日時列の解決（改名・削除への追従）──
    const headers = readHeaders(block);
    const prevTrack = tracks.get(blockId);
    const columnName = options?.columnNameOf?.(blockId);
    let colIndex: number;
    let removed = false;
    if (columnName === undefined || headers.includes(columnName)) {
      colIndex = findColumnIndexByName(block, columnName);
    } else if (!prevTrack) {
      colIndex = guessMissingColumnIndex(headers);
    } else if (prevTrack.index < 0) {
      // 直前に列ごと消えたと判断済み（注釈の更新が届く前の onChange）。書かない
      colIndex = -1;
    } else {
      // 注釈の名前が見出しに無い。直近に追っていた列を今の見出しで探し直す
      const prevName = prevTrack.headers[prevTrack.index] ?? "";
      if (headers.length < prevTrack.headers.length && !headers.includes(prevName)) {
        // 列が減り、追っていた列の見出しも消えた → 列ごと削除された
        options?.onRemoveColumn?.(blockId);
        removed = true;
        colIndex = -1;
      } else {
        // 列の挿入・並べ替えで位置がずれても、見出しが前後とも一意なら名前で追う
        // （直前に他の列と同じ名前だったなら、名前ではどちらの列か決まらない）
        colIndex =
          prevName !== "" &&
          countOf(prevTrack.headers, prevName) === 1 &&
          countOf(headers, prevName) === 1
            ? headers.indexOf(prevName)
            : Math.min(prevTrack.index, headers.length - 1);
        // 改名とみなすのは、追っていた列の見出しが実際に書き換わったときだけ。
        // 空（打ち直しの途中）や、他の列と同じ名前（打鍵の途中で一致した等）のうちは
        // 付け替えない — 他の列のふるまいと混ざると元に戻せない
        const current = headers[colIndex] ?? "";
        if (current !== prevName && current !== "" && countOf(headers, current) === 1) {
          options?.onRenameColumn?.(blockId, columnName, current);
        }
      }
    }
    const rowSignatures = readRowSignatures(block);
    tracks.set(blockId, { headers, index: colIndex, rows: rowSignatures });
    if (removed || colIndex < 0) continue;

    // 初見は記録のみ。減少・不変は何もしない
    if (prev === undefined || rows.length <= prev) continue;

    // 日時を入れるのは新しく増えた行だけ。後から足した日時の列は既存の行が空なので、
    // 「日時の列が空の行を全部埋める」と過去の行に今の日時が入ってしまう
    const added = prevTrack ? findAddedRows(prevTrack.rows, rowSignatures) : null;
    const stamp = formatDateTime(now);
    let changed = false;
    const nextRows = rows.map((row, i) => {
      if (i === 0) return row; // ヘッダ
      if (added && !added.has(i)) return row;
      const cells = row.cells ?? [];
      if (cells.length <= colIndex || readCellText(cells[colIndex]) !== "") return row;
      changed = true;
      return {
        ...row,
        cells: cells.map((c: any, j: number) => (j === colIndex ? withCellText(c, stamp) : c)),
      };
    });
    if (!changed) continue;
    try {
      editor.updateBlock(block.id, { content: { ...block.content, rows: nextRows } });
    } catch {
      // 走査中のトランザクション競合などで失敗しても、次の onChange で再試行される
    }
  }
}
