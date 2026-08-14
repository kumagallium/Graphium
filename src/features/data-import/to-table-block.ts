// パース結果 → BlockNote のテーブルブロック
//
// 生成するのは標準の table ブロックそのもの（セルはただの文字列）。取り込み由来だと
// 分かる情報は tableMeta.source 側に置くので、書き出せば普通の Markdown 表として
// 残る — テーブルを「アプリ専用のデータベース」にしないという table-meta の方針に揃える。

import type { ParsedDelimited } from "./types";

type InlineText = { type: "text"; text: string; styles: Record<string, never> };

function cell(text: string): InlineText[] {
  return [{ type: "text", text, styles: {} }];
}

/** 空セルは content: [] にする（空文字の text ノードは BlockNote が受け付けない） */
function cellContent(text: string): InlineText[] {
  return text === "" ? [] : cell(text);
}

export type TableBlockSpec = {
  type: "table";
  content: {
    type: "tableContent";
    rows: { cells: InlineText[][] }[];
  };
};

/** headers / rows をテーブルブロックの content に組む。ヘッダが空なら null */
export function toTableBlock(parsed: ParsedDelimited): TableBlockSpec | null {
  if (parsed.headers.length === 0) return null;
  const rows = [
    { cells: parsed.headers.map((h) => cellContent(h)) },
    ...parsed.rows.map((r) => ({ cells: r.map((c) => cellContent(c)) })),
  ];
  return { type: "table", content: { type: "tableContent", rows } };
}

/**
 * 取り込んだ表の既定のキャプション。
 *
 * 拡張子を落としたファイル名をそのまま使う。表の名前はチャートの系列参照名にも
 * なるので、無名のまま増えるより出所が分かる名前が付いているほうが後で効く。
 */
export function defaultCaption(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").trim() || fileName;
}
