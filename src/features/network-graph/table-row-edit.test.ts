import { describe, it, expect } from "vitest";
import { BlockNoteEditor } from "@blocknote/core";
import {
  renameTableRow,
  setTableCell,
  removeTableRow,
  appendEntityRowToTable,
  addTableRow,
  removeTableColumn,
} from "./table-row-edit";

const cell = (text: string) => ({ type: "tableCell", content: [{ type: "text", text, styles: {} }] });

function makeEditor() {
  const table = {
    id: "tbl-1",
    type: "table",
    content: {
      type: "tableContent",
      rows: [
        { cells: [cell("名前"), cell("質量"), cell("メモ")] },
        { cells: [cell("バッチA"), cell("5g"), cell("焼成用")] },
        { cells: [cell("バッチB"), cell("5g"), cell("対照")] },
      ],
    },
  };
  const updates: { id: string; content: any }[] = [];
  return {
    document: [{ id: "step-1", type: "step", content: [], children: [table] }],
    updates,
    updateBlock(id: string, patch: { content: any }) {
      updates.push({ id, content: patch.content });
      // 実エディタと同じく document へ反映する（連打の冪等性はこれが前提）
      if (id === table.id && patch.content) table.content = patch.content;
    },
  };
}

const rowTexts = (content: any) =>
  content.rows.map((r: any) => r.cells.map((c: any) => c.content.map((x: any) => x.text).join("")));

describe("table-row-edit", () => {
  it("renameTableRow は該当行の 1 列目だけを書き換える", () => {
    const ed = makeEditor();
    expect(renameTableRow(ed, "tbl-1", "バッチA", "バッチA改")).toBe(true);
    expect(rowTexts(ed.updates[0].content)).toEqual([
      ["名前", "質量", "メモ"],
      ["バッチA改", "5g", "焼成用"],
      ["バッチB", "5g", "対照"],
    ]);
  });

  it("renameTableRow は先頭セルの tableRowIdentity を保持する", () => {
    const ed = makeEditor();
    const first = (ed.document[0].children[0] as any).content.rows[1].cells[0].content[0];
    first.styles = { tableRowIdentity: "row_batch_a", italic: "true" };

    expect(renameTableRow(ed, "tbl-1", "バッチA", "改名後")).toBe(true);
    expect(ed.updates[0].content.rows[1].cells[0].content[0].styles).toEqual({
      tableRowIdentity: "row_batch_a",
      italic: "true",
    });
  });

  it("setTableCell はヘッダの列名でセルを特定して書き換える", () => {
    const ed = makeEditor();
    expect(setTableCell(ed, "tbl-1", "バッチB", "メモ", "予備")).toBe(true);
    expect(rowTexts(ed.updates[0].content)[2]).toEqual(["バッチB", "5g", "予備"]);
  });

  it("存在しない列は no-op で false", () => {
    const ed = makeEditor();
    expect(setTableCell(ed, "tbl-1", "バッチA", "純度", "99%")).toBe(false);
    expect(ed.updates).toHaveLength(0);
  });

  it("removeTableRow は該当データ行だけを消す（ヘッダは残る）", () => {
    const ed = makeEditor();
    expect(removeTableRow(ed, "tbl-1", "バッチA")).toBe(true);
    expect(rowTexts(ed.updates[0].content)).toEqual([
      ["名前", "質量", "メモ"],
      ["バッチB", "5g", "対照"],
    ]);
  });

  it("存在しない行・テーブルは no-op で false", () => {
    const ed = makeEditor();
    expect(renameTableRow(ed, "tbl-1", "バッチC", "X")).toBe(false);
    expect(removeTableRow(ed, "no-such-table", "バッチA")).toBe(false);
    expect(ed.updates).toHaveLength(0);
  });
});

describe("appendEntityRowToTable", () => {
  it("既存テーブルがあれば末尾に行を足す（他の列は空）", () => {
    const ed = makeEditor();
    const r = appendEntityRowToTable(ed, "step-1", "バッチC", () => "tbl-1", "名前");
    expect(r).toEqual({ tableBlockId: "tbl-1", created: false });
    expect(rowTexts(ed.updates[0].content)).toEqual([
      ["名前", "質量", "メモ"],
      ["バッチA", "5g", "焼成用"],
      ["バッチB", "5g", "対照"],
      ["バッチC", "", ""],
    ]);
  });

  it("空行があればそこへ書く（行を増やさない）", () => {
    const ed = makeEditor();
    (ed.document[0].children[0] as any).content.rows.push({
      cells: [cell(""), cell(""), cell("")],
    });
    const r = appendEntityRowToTable(ed, "step-1", "バッチC", () => "tbl-1", "名前");
    expect(r?.created).toBe(false);
    const rows = rowTexts(ed.updates[0].content);
    expect(rows).toHaveLength(4);
    expect(rows[3]).toEqual(["バッチC", "", ""]);
  });

  it("空段落だけの step では、その段落を置き換えて表にする（1 トランザクション）", () => {
    // 実バグ: 「後ろへ挿入 → 元の段落を削除」の 2 手だと、2 手目が挿入前の
    // 位置で動いて入れたばかりの表ごと消していた（表がどこにも残らない）
    const calls: string[] = [];
    const replaced: any[] = [];
    const ed: any = {
      document: [
        { id: "step-1", type: "step", content: [], children: [{ id: "p1", type: "paragraph", content: [] }] },
      ],
      insertBlocks() {
        calls.push("insertBlocks");
        return [{ id: "x" }];
      },
      removeBlocks() {
        calls.push("removeBlocks");
      },
      replaceBlocks(remove: string[], insert: any[]) {
        calls.push("replaceBlocks");
        replaced.push({ remove, insert });
        return { insertedBlocks: [{ id: "new-tbl" }] };
      },
      updateBlock() {
        calls.push("updateBlock");
      },
    };
    const r = appendEntityRowToTable(ed, "step-1", "バッチA", () => null, "名前");
    expect(r).toEqual({ tableBlockId: "new-tbl", created: true });
    expect(calls).toEqual(["replaceBlocks"]); // 挿入と削除を分けない
    expect(replaced[0].remove).toEqual(["p1"]);
    expect(replaced[0].insert[0].content.rows.map((row: any) => row.cells.map((c: any) => c[0].text))).toEqual([
      ["名前"],
      ["バッチA"],
    ]);
  });

  it("中身のある step では末尾の後ろに足す", () => {
    const inserted: any[] = [];
    const ed: any = {
      document: [
        {
          id: "step-1",
          type: "step",
          content: [],
          children: [{ id: "p1", type: "paragraph", content: [{ type: "text", text: "本文" }] }],
        },
      ],
      insertBlocks(blocks: any[], ref: string, pos: string) {
        inserted.push({ block: blocks[0], ref, pos });
        return [{ id: "new-tbl" }];
      },
      replaceBlocks() {
        throw new Error("空段落でないときは置き換えない");
      },
      removeBlocks() {},
      updateBlock() {},
    };
    const r = appendEntityRowToTable(ed, "step-1", "バッチA", () => null, "名前");
    expect(r).toEqual({ tableBlockId: "new-tbl", created: true });
    expect(inserted[0]).toMatchObject({ ref: "p1", pos: "after" });
  });

  it("中身が空の step は children ごと差し替える", () => {
    const step: any = { id: "step-1", type: "step", content: [], children: [] };
    const ed: any = {
      document: [step],
      insertBlocks() {
        throw new Error("基準になる子が無いので挿入は使わない");
      },
      removeBlocks() {},
      replaceBlocks() {
        throw new Error("消す対象が無い");
      },
      updateBlock(id: string, patch: any) {
        if (id === "step-1" && patch.children) {
          step.children = patch.children.map((c: any) => ({ id: "new-tbl", ...c }));
        }
      },
    };
    const r = appendEntityRowToTable(ed, "step-1", "バッチA", () => null, "名前");
    expect(r).toEqual({ tableBlockId: "new-tbl", created: true });
    expect(step.children[0].type).toBe("table");
  });

  it("step が見つからなければ null", () => {
    const ed = makeEditor();
    expect(appendEntityRowToTable(ed, "no-step", "X", () => null, "名前")).toBeNull();
  });
});

describe("appendEntityRowToTable の冪等性", () => {
  it("同名の行が既にあれば増やさない（再生成のデバウンス中の連打対策）", () => {
    const ed = makeEditor();
    const first = appendEntityRowToTable(ed, "step-1", "バッチC", () => "tbl-1", "名前");
    expect(first).toEqual({ tableBlockId: "tbl-1", created: false });
    expect(rowTexts(ed.updates[0].content)).toHaveLength(4);

    // 2 回目・3 回目は何も書かない（updates が増えない）
    const before = ed.updates.length;
    expect(appendEntityRowToTable(ed, "step-1", "バッチC", () => "tbl-1", "名前")).toEqual({
      tableBlockId: "tbl-1",
      created: false,
    });
    expect(appendEntityRowToTable(ed, "step-1", "バッチC", () => "tbl-1", "名前")).toEqual({
      tableBlockId: "tbl-1",
      created: false,
    });
    expect(ed.updates).toHaveLength(before);
  });
});

describe("addTableRow", () => {
  function makeHeaderOnlyEditor() {
    const table = {
      id: "tbl-1",
      type: "table",
      content: {
        type: "tableContent",
        rows: [{ cells: [cell("名前"), cell("質量"), cell("メモ")] }],
      },
    };
    const updates: { id: string; content: any }[] = [];
    return {
      document: [{ id: "step-1", type: "step", content: [], children: [table] }],
      updates,
      updateBlock(id: string, patch: { content: any }) {
        updates.push({ id, content: patch.content });
        if (id === table.id && patch.content) table.content = patch.content;
      },
    };
  }

  it("ヘッダのみの表でも、ヘッダ文字列を引き継がず空セルの行を足す", () => {
    const ed = makeHeaderOnlyEditor();
    expect(addTableRow(ed, "tbl-1", "行1")).toBe(true);
    expect(rowTexts(ed.updates[0].content)).toEqual([
      ["名前", "質量", "メモ"],
      ["行1", "", ""],
    ]);
  });

  it("データ行がある表では、既存データ行の列数・セル形をテンプレートにする（従来どおり）", () => {
    const ed = makeEditor();
    expect(addTableRow(ed, "tbl-1", "バッチC")).toBe(true);
    expect(rowTexts(ed.updates[0].content)).toEqual([
      ["名前", "質量", "メモ"],
      ["バッチA", "5g", "焼成用"],
      ["バッチB", "5g", "対照"],
      ["バッチC", "", ""],
    ]);
  });

  it("空のテーブル（ヘッダも無い）は no-op で false", () => {
    const ed = makeHeaderOnlyEditor();
    const table = (ed.document[0].children[0] as any);
    table.content.rows = [];
    expect(addTableRow(ed, "tbl-1", "行1")).toBe(false);
    expect(ed.updates.length).toBe(0);
  });
});

describe("removeTableColumn", () => {
  // BlockNote は columnWidths を列の位置で当てる（columnWidths[列] がその列の幅）。
  // 消した列の幅を残したままだと、残った列に隣の幅がずれて当たる
  function makeWidenedEditor(extra: Record<string, any> = {}) {
    const ed = makeEditor();
    Object.assign((ed.document[0].children[0] as any).content, extra);
    return ed;
  }

  it("先頭列を消すと、残った列は元の列の幅のまま（消した列の幅だけ取り除く）", () => {
    const ed = makeWidenedEditor({ columnWidths: [260, 120, undefined], headerRows: 1 });
    expect(removeTableColumn(ed, "tbl-1", 0)).toBe(true);
    const content = ed.updates[0].content;
    expect(rowTexts(content)).toEqual([
      ["質量", "メモ"],
      ["5g", "焼成用"],
      ["5g", "対照"],
    ]);
    expect(content.columnWidths).toHaveLength(2);
    expect(content.columnWidths).toEqual([120, undefined]);
    // 列幅以外の設定はそのまま持ち越す
    expect(content.headerRows).toBe(1);
  });

  it("真ん中の列を消すと、両隣の列の幅はそのまま", () => {
    const ed = makeWidenedEditor({ columnWidths: [260, 120, 180] });
    expect(removeTableColumn(ed, "tbl-1", 1)).toBe(true);
    expect(rowTexts(ed.updates[0].content)[0]).toEqual(["名前", "メモ"]);
    expect(ed.updates[0].content.columnWidths).toEqual([260, 180]);
  });

  it("列幅が無い表・消す列まで幅が無い表では columnWidths に触らない", () => {
    const none = makeWidenedEditor();
    expect(removeTableColumn(none, "tbl-1", 0)).toBe(true);
    expect("columnWidths" in none.updates[0].content).toBe(false);

    const short = makeWidenedEditor({ columnWidths: [260] });
    expect(removeTableColumn(short, "tbl-1", 2)).toBe(true);
    expect(short.updates[0].content.columnWidths).toEqual([260]);
  });

  it("見出し列を消すと headerCols を 1 減らす（見出し列より右の列なら変えない）", () => {
    // headerCols は先頭から何個のセルを見出しにするか。減らさないと次の列が見出し列になる
    const first = makeWidenedEditor({ headerCols: 1, headerRows: 1 });
    expect(removeTableColumn(first, "tbl-1", 0)).toBe(true);
    expect(first.updates[0].content.headerCols).toBe(0);
    expect(first.updates[0].content.headerRows).toBe(1);

    const two = makeWidenedEditor({ headerCols: 2 });
    expect(removeTableColumn(two, "tbl-1", 1)).toBe(true);
    expect(two.updates[0].content.headerCols).toBe(1);

    const right = makeWidenedEditor({ headerCols: 1 });
    expect(removeTableColumn(right, "tbl-1", 2)).toBe(true);
    expect(right.updates[0].content.headerCols).toBe(1);
  });

  it("結合セルのある表では、列の位置とセルの位置が一致しないので columnWidths は今のまま持ち越す", () => {
    const ed = makeWidenedEditor({ columnWidths: [260, 120, 180], headerCols: 2 });
    const rows = (ed.document[0].children[0] as any).content.rows;
    rows[1].cells = [{ ...cell("バッチA 5g"), props: { colspan: 2, rowspan: 1 } }, cell("焼成用")];
    expect(removeTableColumn(ed, "tbl-1", 1)).toBe(true);
    expect(ed.updates[0].content.columnWidths).toEqual([260, 120, 180]);
    // headerCols はセルの並び順で当たる（消すのもセルの並び順）ので、結合があっても 1 減らす
    expect(ed.updates[0].content.headerCols).toBe(1);
  });

  it("実際の BlockNote でも、列を消した後に残った列が元の幅のまま", () => {
    const editor = BlockNoteEditor.create({
      initialContent: [
        {
          type: "table",
          content: {
            type: "tableContent",
            columnWidths: [260, 120, undefined],
            rows: [
              { cells: [cell("Name"), cell("Mass"), cell("Memo")] },
              { cells: [cell("Batch A"), cell("5g"), cell("bake")] },
            ],
          },
        },
      ],
    } as any);
    const id = editor.document[0].id;
    expect(removeTableColumn(editor, id, 0)).toBe(true);
    const content = (editor.getBlock(id) as any).content;
    expect(rowTexts(content)).toEqual([
      ["Mass", "Memo"],
      ["5g", "bake"],
    ]);
    expect(content.columnWidths).toHaveLength(2);
    expect(content.columnWidths).toEqual([120, undefined]);
  });

  it("実際の BlockNote でも、見出し列を消すと次の列が見出し列にならない", () => {
    const editor = BlockNoteEditor.create({
      initialContent: [
        {
          type: "table",
          content: {
            type: "tableContent",
            headerRows: 1,
            headerCols: 1,
            rows: [
              { cells: [cell("Name"), cell("Mass"), cell("Memo")] },
              { cells: [cell("Batch A"), cell("5g"), cell("bake")] },
            ],
          },
        },
      ],
    } as any);
    const id = editor.document[0].id;
    expect((editor.getBlock(id) as any).content.headerCols).toBe(1);
    expect(removeTableColumn(editor, id, 0)).toBe(true);
    const content = (editor.getBlock(id) as any).content;
    expect(rowTexts(content)[0]).toEqual(["Mass", "Memo"]);
    expect(content.headerCols ?? 0).toBe(0);
    expect(content.headerRows).toBe(1);
  });
});
