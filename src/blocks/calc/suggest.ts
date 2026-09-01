// 計算ブロックの表参照の入力補完
//
// `table[` / `col(` と打った時点から、表名 → 列名の候補を出して
// `table["秤量表"]["質量"]` を最後まで手で打たなくて済むようにする。
// 記法（文字列キー限定）は覚えていなくても、入口の 6 文字だけで辿り着ける。
//
// caret 直前のテキストだけを見る素朴なパターンマッチで、式の構文解析はしない。
// 候補の出所は tableMeta ストア経由で配布される表の列データ（view と同じもの）。

import type { TableColumnsIndex } from "../../features/table-meta/types";

export type CalcSuggestion = {
  /** 何の候補か（表名 / 列名） */
  kind: "table" | "column";
  /** どの記法の途中か（table["..."] 形式か col("...") 形式か） */
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
  if (!tables) return null;
  const before = text.slice(0, caret);
  const lineStart = before.lastIndexOf("\n") + 1;
  const line = before.slice(lineStart);

  // 長いパターン（列名）から順に試す
  const columnIndex = line.match(/table\[\s*"([^"]+)"\s*\]\s*\[\s*"?([^"\]\n]*)$/);
  const columnCall = line.match(/\bcol(?:umn)?\(\s*"([^"]+)"\s*,\s*"?([^",)\n]*)$/);
  const tableIndex = line.match(/table\[\s*"?([^"\]\n]*)$/);
  const tableCall = line.match(/\bcol(?:umn)?\(\s*"?([^",)\n]*)$/);

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
  return null;
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
