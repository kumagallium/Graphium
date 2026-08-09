import { describe, it, expect } from "vitest";
import {
  renameTableRow,
  setTableCell,
  removeTableRow,
  appendEntityRowToTable,
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
