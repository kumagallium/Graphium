// pin-note-link-column.ts（ノートへのリンクの列を左端に保つ）のテスト

import { describe, it, expect } from "vitest";
import { moveColumnToFront, pinNoteLinkColumns } from "./pin-note-link-column";
import type { TableMeta } from "./types";

const cell = (text: string) => ({ type: "tableCell", props: {}, content: text ? [{ type: "text", text, styles: {} }] : [] });
const texts = (content: any) =>
  content.rows.map((r: any) => r.cells.map((c: any) => (c.content ?? []).map((t: any) => t.text).join("")));

function makeEditor(rows: string[][], columnWidths?: (number | undefined)[]) {
  let block: any = {
    id: "t1",
    type: "table",
    content: {
      type: "tableContent",
      ...(columnWidths ? { columnWidths } : {}),
      rows: rows.map((r) => ({ cells: r.map(cell) })),
    },
  };
  let updates = 0;
  return {
    getBlock: (id: string) => (id === "t1" ? block : null),
    updateBlock: (_id: string, patch: any) => {
      block = { ...block, content: patch.content };
      updates++;
    },
    get block() {
      return block;
    },
    get updates() {
      return updates;
    },
  };
}

const linkOn = (name: string): TableMeta => ({ columns: { [name]: ["note-link"] } });

describe("moveColumnToFront", () => {
  it("各行のセルと列幅を同じ並びで動かし、他のフィールドを保つ", () => {
    const content = {
      type: "tableContent",
      headerRows: 1,
      columnWidths: [100, 200, undefined],
      rows: [{ cells: [cell("a"), cell("b"), cell("c")] }, { cells: [cell("1"), cell("2"), cell("3")] }],
    };
    const next = moveColumnToFront(content, 2);
    expect(texts(next)).toEqual([["c", "a", "b"], ["3", "1", "2"]]);
    expect(next.columnWidths).toEqual([undefined, 100, 200]);
    expect(next.headerRows).toBe(1);
  });
});

describe("pinNoteLinkColumns", () => {
  it("リンクの列が右へ動いたら先頭へ戻す", () => {
    const editor = makeEditor([["", "実験名", "収率"], ["", "@触媒A", "62%"]]);
    pinNoteLinkColumns(editor, ["t1"], { metaOf: () => linkOn("実験名") });
    expect(texts(editor.block.content)).toEqual([["実験名", "", "収率"], ["@触媒A", "", "62%"]]);
  });

  it("先頭にあれば何もしない", () => {
    const editor = makeEditor([["実験名", "収率"], ["A", "1"]]);
    pinNoteLinkColumns(editor, ["t1"], { metaOf: () => linkOn("実験名") });
    expect(editor.updates).toBe(0);
  });

  it("先頭列の見出しが書き換わったら名前を付け替え、列は動かさない", () => {
    const editor = makeEditor([["サンプル", "収率"], ["A", "1"]]);
    const renames: string[][] = [];
    pinNoteLinkColumns(editor, ["t1"], {
      metaOf: () => linkOn("実験名"),
      onRenameColumn: (_id, from, to) => void renames.push([from, to]),
    });
    expect(renames).toEqual([["実験名", "サンプル"]]);
    expect(editor.updates).toBe(0);
  });

  it("見出しが空・他の列と同じ名前のうちは付け替えない", () => {
    const renames: string[][] = [];
    const onRenameColumn = (_id: string, from: string, to: string) => void renames.push([from, to]);
    pinNoteLinkColumns(makeEditor([["", "収率"]]), ["t1"], { metaOf: () => linkOn("実験名"), onRenameColumn });
    pinNoteLinkColumns(makeEditor([["収率", "収率"]]), ["t1"], { metaOf: () => linkOn("実験名"), onRenameColumn });
    expect(renames).toEqual([]);
  });

  it("同じ見出しの列が複数あるときは動かさない", () => {
    const editor = makeEditor([["値", "実験名", "実験名"]]);
    pinNoteLinkColumns(editor, ["t1"], { metaOf: () => linkOn("実験名") });
    expect(editor.updates).toBe(0);
  });

  it("リンクの列が無い表は触らない", () => {
    const editor = makeEditor([["値", "実験名"]]);
    pinNoteLinkColumns(editor, ["t1"], { metaOf: () => ({ columns: { 実験名: ["datetime-auto"] } }) });
    expect(editor.updates).toBe(0);
  });

  it("見出しが空のまま設定された古い表は、先頭列に名前を入れて覚え直す", () => {
    const editor = makeEditor([["", "あ", ""], ["", "@あああ", ""]]);
    const renames: string[][] = [];
    pinNoteLinkColumns(editor, ["t1"], {
      metaOf: () => linkOn(""),
      onRenameColumn: (_id, from, to) => void renames.push([from, to]),
      emptyHeaderName: "名前",
    });
    expect(texts(editor.block.content)[0]).toEqual(["名前", "あ", ""]);
    expect(renames).toEqual([["", "名前"]]);
  });

  it("古い表でも先頭列に見出しがあれば、その名前で覚え直す（列は動かさない）", () => {
    const editor = makeEditor([["サンプル", ""], ["A", ""]]);
    const renames: string[][] = [];
    pinNoteLinkColumns(editor, ["t1"], {
      metaOf: () => linkOn(""),
      onRenameColumn: (_id, from, to) => void renames.push([from, to]),
      emptyHeaderName: "名前",
    });
    expect(renames).toEqual([["", "サンプル"]]);
    expect(texts(editor.block.content)[0]).toEqual(["サンプル", ""]);
  });
});
