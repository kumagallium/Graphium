// @vitest-environment jsdom
// 列の保護: 保護列の解決・編集の判定（純関数）と、実エディタでの止め方・通し方
import { afterEach, describe, expect, it, vi } from "vitest";
import { BlockNoteEditor } from "@blocknote/core";
import {
  columnProtectionExtension,
  isTableEditAllowed,
  protectedColumnNames,
  refreshColumnProtection,
  resolveTableProtection,
  setColumnProtectionResolver,
  withProtectionBypass,
  type TableProtection,
} from "./column-protection";
import type { TableMeta } from "./types";

const prot = (over: Partial<TableProtection> = {}): TableProtection => ({
  columns: new Set(),
  calcColumns: new Set(),
  calcWrites: [],
  ...over,
});

describe("protectedColumnNames / resolveTableProtection", () => {
  it("明示の保護だけを列名で返す（空の列名は除く）", () => {
    const meta: TableMeta = {
      columns: { 質量: ["protected"], 日時: ["datetime-auto"], 備考: ["datetime-auto", "protected"], "": ["protected"] },
    };
    expect([...protectedColumnNames(meta)].sort()).toEqual(["備考", "質量"]);
    expect(protectedColumnNames(undefined).size).toBe(0);
  });

  it("計算が書く列は見出しの保護、書き込み宣言はセルの保護に回る（列ごとの保護にはならない）", () => {
    const writes = {
      c1: [{ tableBlockId: "t1", column: "合計", texts: ["1"] }],
      c2: [{ tableBlockId: "other", column: "x", texts: ["1"] }],
    };
    const p = resolveTableProtection({ columns: { 質量: ["protected"] } }, writes, "t1");
    expect([...p.columns]).toEqual(["質量"]);
    expect([...p.calcColumns]).toEqual(["合計"]);
    expect(p.calcWrites).toHaveLength(1);
  });
});

describe("isTableEditAllowed（明示保護の列）", () => {
  const prev = [
    ["試料", "質量"],
    ["A", "1.0"],
    ["B", "2.0"],
    ["C", ""],
  ];
  const p = prot({ columns: new Set(["質量"]) });

  it("既存セルの書き換えは止める", () => {
    expect(isTableEditAllowed(prev, [prev[0], ["A", "9"], prev[2], prev[3]], p)).toBe(false);
  });
  it("値を空にするのも止める", () => {
    expect(isTableEditAllowed(prev, [prev[0], ["A", ""], prev[2], prev[3]], p)).toBe(false);
  });
  it("行の追加は通す（保護セルは空のまま）", () => {
    expect(isTableEditAllowed(prev, [...prev, ["D", ""]], p)).toBe(true);
  });
  it("新しい行の保護セルに書くのは止める", () => {
    expect(isTableEditAllowed(prev, [...prev, ["D", "5"]], p)).toBe(false);
  });
  it("行の削除は通す", () => {
    expect(isTableEditAllowed(prev, [prev[0], prev[2], prev[3]], p)).toBe(true);
  });
  it("行を足しながら別の値を空にするのは止める", () => {
    expect(isTableEditAllowed(prev, [prev[0], ["A", ""], prev[2], prev[3], ["D", ""]], p)).toBe(false);
  });
  it("行の並べ替えは通す", () => {
    expect(isTableEditAllowed(prev, [prev[0], prev[2], prev[1], prev[3]], p)).toBe(true);
  });
  it("見出しの改名・保護列の削除は止める", () => {
    expect(isTableEditAllowed(prev, [["試料", "重さ"], ...prev.slice(1)], p)).toBe(false);
    expect(isTableEditAllowed(prev, prev.map((r) => [r[0]]), p)).toBe(false);
  });
  it("保護列以外の列の追加・並べ替え、他の列の書き換えは通す", () => {
    expect(isTableEditAllowed(prev, prev.map((r, i) => [...r, i === 0 ? "メモ" : ""]), p)).toBe(true);
    expect(isTableEditAllowed(prev, prev.map((r) => [r[1], r[0]]), p)).toBe(true);
    expect(isTableEditAllowed(prev, [prev[0], ["Z", "1.0"], prev[2], prev[3]], p)).toBe(true);
  });
  it("保護が無い表は何でも通す", () => {
    expect(isTableEditAllowed(prev, [["x"]], prot())).toBe(true);
  });
});

describe("isTableEditAllowed（計算が書いたセル）", () => {
  const prev = [
    ["条件", "合計"],
    ["基準", "10"],
    ["a", "20"],
    ["b", "30"],
  ];
  // 「基準」の行は式が cell() で読む行なので計算は書かない（人が入れた基準の値）
  const p = prot({
    calcColumns: new Set(["合計"]),
    calcWrites: [{ tableBlockId: "t1", column: "合計", texts: ["", "20", "30"], skipRows: ["基準"] }],
  });

  it("計算のセルの書き換えは止める", () => {
    expect(isTableEditAllowed(prev, [prev[0], prev[1], ["a", "99"], prev[3]], p)).toBe(false);
  });
  it("同じ列の基準のセルは書き換えられる", () => {
    expect(isTableEditAllowed(prev, [prev[0], ["基準", "11"], prev[2], prev[3]], p)).toBe(true);
  });
  it("計算が書く列の見出しの改名は止める", () => {
    expect(isTableEditAllowed(prev, [["条件", "計"], ...prev.slice(1)], p)).toBe(false);
  });
  it("行の追加・並べ替えは通す", () => {
    expect(isTableEditAllowed(prev, [...prev, ["c", ""]], p)).toBe(true);
    expect(isTableEditAllowed(prev, [prev[0], prev[3], prev[2], prev[1]], p)).toBe(true);
  });
});

// ── 実エディタ ────────────────────────────────────────────────────

const cell = (text: string) => [{ type: "text", text, styles: {} }];
const tableContent = (rows: string[][]) => ({
  type: "tableContent",
  rows: rows.map((r) => ({ cells: r.map(cell) })),
});

const editors: BlockNoteEditor<any, any, any>[] = [];
afterEach(() => {
  while (editors.length) {
    const e: any = editors.pop();
    e._tiptapEditor?.destroy?.();
  }
  document.body.innerHTML = "";
});

function setup(protection: TableProtection) {
  const editor = BlockNoteEditor.create({
    initialContent: [
      {
        type: "table",
        content: tableContent([
          ["試料", "質量"],
          ["A", "1.0"],
          ["B", "2.0"],
        ]),
      },
    ],
    extensions: [columnProtectionExtension()],
  } as any);
  const host = document.createElement("div");
  document.body.appendChild(host);
  editor.mount(host);
  editors.push(editor);
  const id = editor.document[0].id;
  setColumnProtectionResolver(editor, (blockId) => (blockId === id ? protection : undefined));
  refreshColumnProtection(editor);
  const cells = (): string[][] =>
    ((editor.getBlock(id) as any).content.rows as any[]).map((r) => r.cells.map((c: any) => c.content?.[0]?.text ?? ""));
  return { editor, id, cells, host };
}

describe("実エディタでの保護", () => {
  const p = prot({ columns: new Set(["質量"]) });

  it("保護列のセルに編集不可の印（見出しを含む）、他の列には付かない", () => {
    const { host } = setup(p);
    expect(host.querySelectorAll("[data-protected-cell]").length).toBe(3);
    expect(host.querySelectorAll('[data-protected-cell][contenteditable="false"]').length).toBe(3);
  });

  it("既存セルの書き換えは弾かれて通知が出る", async () => {
    const { editor, id, cells } = setup(p);
    const blocked = vi.fn();
    window.addEventListener("graphium:protected-edit-blocked", blocked);
    const block: any = editor.getBlock(id);
    const rows = block.content.rows.map((r: any, i: number) =>
      i === 1 ? { cells: [r.cells[0], cell("9")] } : r,
    );
    editor.updateBlock(id, { content: { ...block.content, rows } } as any);
    expect(cells()[1]).toEqual(["A", "1.0"]);
    await new Promise((r) => setTimeout(r, 5));
    expect(blocked).toHaveBeenCalledTimes(1);
    window.removeEventListener("graphium:protected-edit-blocked", blocked);
  });

  it("他の列の書き換えと行の追加は通り、bypass の中なら保護列も書き換えられる", () => {
    const { editor, id, cells } = setup(p);
    const block: any = editor.getBlock(id);
    const edit = (fn: (rows: any[]) => any[]) =>
      editor.updateBlock(id, { content: { ...(editor.getBlock(id) as any).content, rows: fn((editor.getBlock(id) as any).content.rows) } } as any);
    edit((rows) => rows.map((r, i) => (i === 1 ? { cells: [cell("A2"), r.cells[1]] } : r)));
    expect(cells()[1]).toEqual(["A2", "1.0"]);
    edit((rows) => [...rows, { cells: [cell("C"), cell("")] }]);
    expect(cells()).toHaveLength(4);
    withProtectionBypass(() => edit((rows) => rows.map((r, i) => (i === 1 ? { cells: [r.cells[0], cell("5")] } : r))));
    expect(cells()[1]).toEqual(["A2", "5"]);
    void block;
  });

  it("undo は保護列の変更でも通る", () => {
    const { editor, id, cells } = setup(p);
    const edit = (text: string) => {
      const b: any = editor.getBlock(id);
      editor.updateBlock(id, {
        content: { ...b.content, rows: b.content.rows.map((r: any, i: number) => (i === 1 ? { cells: [r.cells[0], cell(text)] } : r)) },
      } as any);
    };
    withProtectionBypass(() => edit("7"));
    expect(cells()[1]).toEqual(["A", "7"]);
    editor.undo();
    expect(cells()[1]).toEqual(["A", "1.0"]);
    editor.redo();
    expect(cells()[1]).toEqual(["A", "7"]);
  });
});
