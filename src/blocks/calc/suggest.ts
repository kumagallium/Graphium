// 計算ブロックの表参照の入力補完
//
// `table[` / `col(` と打った時点から、表名 → 列名の候補を出して
// `table["秤量表"]["質量"]` を最後まで手で打たなくて済むようにする。
// 記法（文字列キー限定）は覚えていなくても、入口の 6 文字だけで辿り着ける。
//
// caret 直前のテキストだけを見る素朴なパターンマッチで、式の構文解析はしない。
// 候補の出所は tableMeta ストア経由で配布される表の列データ（view と同じもの）。
//
// 表の参照の途中でなければ、関数名の補完をする（functions.ts の厳選一覧から）。
// 変数名を打っている途中にも出るので、確定は Tab だけにする（Enter は改行のまま）。

import type { TableColumnsIndex } from "../../features/table-meta/types";
import { CALC_COMPLETABLE } from "./functions";

/** 関数名の補完を出し始める文字数。1 文字だと変数名を打つたびに出てうるさい */
const FUNCTION_PREFIX_MIN = 2;

export type CalcSuggestion = {
  /** 何の候補か（表名 / 列名 / 関数名） */
  kind: "table" | "column" | "function";
  /** どの記法の途中か（table["..."] 形式か col("...") 形式か）。関数名では "call" */
  style: "index" | "call";
  /** kind === "column" のとき、どの表の列か */
  tableName?: string;
  /** 置換開始位置（text 内の絶対 index）。ここから caret までを候補で置き換える */
  replaceFrom: number;
  /** 入力途中の文字列でフィルタした候補 */
  items: string[];
};

/** mathjs の文字列リテラルに入れる名前のエスケープ（sort-handle 側と対で変える） */
function quoteName(name: string): string {
  return '"' + name.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

/**
 * caret 位置での補完候補を返す。候補ゼロ・補完文脈でないときは null。
 * 判定は caret のある行の中だけで行う（式は 1 行 1 式のため）。
 */
export function computeCalcSuggestion(
  text: string,
  caret: number,
  tables: TableColumnsIndex | null | undefined,
): CalcSuggestion | null {
  const before = text.slice(0, caret);
  const lineStart = before.lastIndexOf("\n") + 1;
  const line = before.slice(lineStart);

  // 長いパターン（列名）から順に試す
  const columnIndex = line.match(/table\[\s*"([^"]+)"\s*\]\s*\[\s*"?([^"\]\n]*)$/);
  const columnCall = line.match(/\bcol(?:umn)?\(\s*"([^"]+)"\s*,\s*"?([^",)\n]*)$/);
  const tableIndex = line.match(/table\[\s*"?([^"\]\n]*)$/);
  const tableCall = line.match(/\bcol(?:umn)?\(\s*"?([^",)\n]*)$/);

  if (!tables) return computeFunctionSuggestion(line, caret);

  const build = (
    kind: "table" | "column",
    style: "index" | "call",
    m: RegExpMatchArray,
    prefix: string,
    tableName?: string,
  ): CalcSuggestion | null => {
    const pool =
      kind === "table"
        ? Object.keys(tables)
        : Object.keys(tables[tableName ?? ""] ?? {});
    const items = pool.filter((name) => name.includes(prefix.trim()));
    if (items.length === 0) return null;
    return {
      kind,
      style,
      ...(tableName !== undefined ? { tableName } : {}),
      // 入力途中のプレフィックスを置換範囲にする。開き引用符まで打っていたら
      // それも含めて置き換える（確定側が引用符ごと入れ直すため）
      replaceFrom: caret - prefix.length - (m[0].endsWith('"' + prefix) ? 1 : 0),
      items,
    };
  };

  if (columnIndex) return build("column", "index", columnIndex, columnIndex[2], columnIndex[1]);
  if (columnCall) return build("column", "call", columnCall, columnCall[2], columnCall[1]);
  if (tableIndex) return build("table", "index", tableIndex, tableIndex[1]);
  if (tableCall) return build("table", "call", tableCall, tableCall[1]);
  return computeFunctionSuggestion(line, caret);
}

/**
 * caret 直前の識別子が関数名の打ちかけなら、前方一致する関数を返す。
 * 次の場所では出さない:
 * - 文字列の中（`col("su` の su は表名）
 * - 数値の直後（`5 min` の min は単位）・`to` の直後（`to kPa` は単位）
 * - 識別子の途中の . の後（`.^` 等の演算子や、プロパティ参照）
 */
function computeFunctionSuggestion(line: string, caret: number): CalcSuggestion | null {
  const m = line.match(/([A-Za-z_][A-Za-z0-9_]*)$/);
  if (!m) return null;
  const prefix = m[1];
  if (prefix.length < FUNCTION_PREFIX_MIN) return null;
  const head = line.slice(0, line.length - prefix.length);
  // 識別子の前が英数字なら、識別子の途中（または数値に続く単位）
  if (/[A-Za-z0-9_.]$/.test(head)) return null;
  // 引用符の数が奇数なら文字列の中
  if ((head.match(/"/g) ?? []).length % 2 === 1) return null;
  const prev = head.trimEnd();
  if (/[0-9]$/.test(prev) || /\bto$/.test(prev)) return null;
  const items = CALC_COMPLETABLE.map((f) => f.name).filter((name) => name.startsWith(prefix));
  if (items.length === 0) return null;
  return { kind: "function", style: "call", replaceFrom: caret - prefix.length, items };
}

/**
 * caret 位置に関数の呼び出し口（`name(`）を差し込む。「?」の一覧から選んだとき用。
 * 直前が識別子の文字なら、つながって別の名前にならないよう空白を 1 つ挟む。
 */
export function insertCalcFunction(
  text: string,
  caret: number,
  name: string,
): { text: string; caret: number } {
  const before = text.slice(0, caret);
  const insert = (/[A-Za-z0-9_)]$/.test(before) ? " " : "") + `${name}(`;
  return { text: before + insert + text.slice(caret), caret: caret + insert.length };
}

/**
 * 候補を確定してテキストへ反映する。戻り値は新しいテキストと caret 位置。
 * 表名の確定は次の入力（列名）へ自然に繋がる形まで入れる:
 *   table[秤   → table["秤量表"]["   （そのまま列名候補が開く）
 *   col(秤     → col("秤量表", "     （同上）
 */
export function applyCalcSuggestion(
  text: string,
  caret: number,
  suggestion: CalcSuggestion,
  item: string,
): { text: string; caret: number } {
  // 関数名は `name(` まで入れて括弧の中に caret を置く（col なら表名の候補へ繋がる）
  if (suggestion.kind === "function") {
    const insert = `${item}(`;
    const nextText = text.slice(0, suggestion.replaceFrom) + insert + text.slice(caret);
    return { text: nextText, caret: suggestion.replaceFrom + insert.length };
  }
  const quoted = quoteName(item);
  const insert =
    suggestion.kind === "table"
      ? suggestion.style === "index"
        ? `${quoted}]["`
        : `${quoted}, "`
      : suggestion.style === "index"
        ? `${quoted}]`
        : `${quoted})`;
  const nextText = text.slice(0, suggestion.replaceFrom) + insert + text.slice(caret);
  return { text: nextText, caret: suggestion.replaceFrom + insert.length };
}
