// auto-timestamp.ts（記録テーブルの自動日時記入）のテスト

import { describe, it, expect } from "vitest";
import {
  applyLogTableTimestamps,
  primeLogTableRowTracking,
  forgetLogTableTracking,
} from "./auto-timestamp";

const cell = (text: string) => [{ type: "text", text, styles: {} }];

function makeTable(id: string, rows: string[][]) {
  return {
    id,
    type: "table",
    content: {
      type: "tableContent",
      rows: rows.map((r) => ({ cells: r.map(cell) })),
    },
  };
}

/** getBlock / updateBlock を持つ最小エディタモック */
function makeEditor(blocks: any[]) {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const updates: Array<{ id: string; rows: string[][] }> = [];
  return {
    getBlock: (id: string) => byId.get(id) ?? null,
    updateBlock: (id: string, patch: any) => {
      const block = byId.get(id);
      if (!block) throw new Error("no block");
      const next = { ...block, content: patch.content };
      byId.set(id, next);
      updates.push({
        id,
        rows: patch.content.rows.map((row: any) =>
          row.cells.map((c: any) =>
            (Array.isArray(c) ? c : (c.content ?? []))
              .map((t: any) => t.text ?? "")
              .join("")
          )
        ),
      });
    },
    updates,
  };
}

const NOW = new Date(2026, 7, 12, 9, 30);

/** 行を 1 つ足した状態にする（標準操作で行が増えたのを再現） */
function addEmptyRow(editor: ReturnType<typeof makeEditor>, id: string) {
  const block = editor.getBlock(id);
  const width = block.content.rows[0].cells.length;
  editor.updateBlock(id, {
    content: {
      ...block.content,
      rows: [...block.content.rows, { cells: Array.from({ length: width }, () => cell("")) }],
    },
  });
  editor.updates.length = 0;
}

// 記録はエディタごとに持つ。テストはそれぞれ新しいエディタを作るので前の記録は残らない
describe("applyLogTableTimestamps", () => {
  it("初見は記録のみで書き込まない（既存の空セルに勝手に入れない）", () => {
    const editor = makeEditor([
      makeTable("t1", [["日時", "値"], ["", "6"]]),
    ]);
    applyLogTableTimestamps(editor, ["t1"], NOW);
    expect(editor.updates.length).toBe(0);
  });

  it("行が増えたら 1 列目が空のデータ行に日時を書く", () => {
    const table = makeTable("t1", [["日時", "値"], ["2026-08-11 08:15", "7"]]);
    const editor = makeEditor([table]);
    applyLogTableTimestamps(editor, ["t1"], NOW); // 初見
    // 標準操作で行が増えた状態を再現
    editor.updateBlock("t1", {
      content: {
        type: "tableContent",
        rows: [
          { cells: [cell("日時"), cell("値")] },
          { cells: [cell("2026-08-11 08:15"), cell("7")] },
          { cells: [cell(""), cell("")] },
        ],
      },
    });
    editor.updates.length = 0;
    applyLogTableTimestamps(editor, ["t1"], NOW);
    expect(editor.updates.length).toBe(1);
    expect(editor.updates[0].rows).toEqual([
      ["日時", "値"],
      ["2026-08-11 08:15", "7"],
      ["2026-08-12 09:30", ""],
    ]);
  });

  it("行数が減った・変わらないときは何もしない（undo を邪魔しない）", () => {
    const table = makeTable("t1", [["日時"], ["a"], ["b"]]);
    const editor = makeEditor([table]);
    applyLogTableTimestamps(editor, ["t1"], NOW); // 初見: 3 行
    editor.updateBlock("t1", {
      content: { type: "tableContent", rows: [{ cells: [cell("日時")] }, { cells: [cell("a")] }] },
    });
    editor.updates.length = 0;
    applyLogTableTimestamps(editor, ["t1"], NOW); // 2 行に減少
    expect(editor.updates.length).toBe(0);
    applyLogTableTimestamps(editor, ["t1"], NOW); // 不変
    expect(editor.updates.length).toBe(0);
  });

  it("1 列目が埋まっている行（日時付きペースト等）は触らない", () => {
    const table = makeTable("t1", [["日時", "値"], ["2026-08-11 08:15", "7"]]);
    const editor = makeEditor([table]);
    applyLogTableTimestamps(editor, ["t1"], NOW);
    editor.updateBlock("t1", {
      content: {
        type: "tableContent",
        rows: [
          { cells: [cell("日時"), cell("値")] },
          { cells: [cell("2026-08-11 08:15"), cell("7")] },
          { cells: [cell("2026-08-10 07:00"), cell("3")] },
        ],
      },
    });
    editor.updates.length = 0;
    applyLogTableTimestamps(editor, ["t1"], NOW);
    expect(editor.updates.length).toBe(0);
  });

  it("登録が消えたテーブル・table 以外は追跡から外す", () => {
    const editor = makeEditor([makeTable("t1", [["日時"], [""]])]);
    applyLogTableTimestamps(editor, ["missing"], NOW);
    expect(editor.updates.length).toBe(0);
  });

  it("prime 後は『ノートを開いて最初の行追加』にも日時が入る", () => {
    const saved = makeTable("t1", [["日時", "値"], ["2026-08-11 08:15", "7"]]);
    const editor = makeEditor([saved]);
    // ノートを開いた: エディタの本文から行数を priming（onChange はまだ来ていない）
    primeLogTableRowTracking(editor, [saved], ["t1"]);
    addEmptyRow(editor, "t1"); // 開いて最初の行追加
    applyLogTableTimestamps(editor, ["t1"], NOW);
    expect(editor.updates.length).toBe(1);
    expect(editor.updates[0].rows[2]).toEqual(["2026-08-12 09:30", ""]);
  });
});

describe("記録はエディタ単位（メインと SidePeek が同時に開いている）", () => {
  it("片方の prime がもう片方の記録を消さない", () => {
    const main = makeEditor([makeTable("m1", [["日時", "値"], ["2026-08-11 08:15", "7"]])]);
    const peek = makeEditor([makeTable("p1", [["日時"], ["2026-08-10 07:00"]])]);
    primeLogTableRowTracking(main, [main.getBlock("m1")], ["m1"]);
    // あとからピークでノートを開いた（記録が 1 つだった頃は、ここでメインの分が消えていた）
    primeLogTableRowTracking(peek, [peek.getBlock("p1")], ["p1"]);

    addEmptyRow(main, "m1");
    applyLogTableTimestamps(main, ["m1"], NOW);
    expect(main.updates.map((u) => u.rows[2])).toEqual([["2026-08-12 09:30", ""]]);

    addEmptyRow(peek, "p1");
    applyLogTableTimestamps(peek, ["p1"], NOW);
    expect(peek.updates.map((u) => u.rows[2])).toEqual([["2026-08-12 09:30"]]);
  });

  it("同じ ID の表でも、別のエディタで見た行数を持ち込まない", () => {
    const rows = [["日時", "値"], ["2026-08-11 08:15", "7"]];
    const main = makeEditor([makeTable("t1", rows)]);
    applyLogTableTimestamps(main, ["t1"], NOW); // メインで初見: 2 行
    // 別のエディタでは 1 行多い状態で開いた。そのエディタにとっては初見なので、
    // 既存の空セルは埋めない
    const peek = makeEditor([makeTable("t1", [...rows, ["", ""]])]);
    applyLogTableTimestamps(peek, ["t1"], NOW);
    expect(peek.updates.length).toBe(0);
  });

  it("エディタが無いときは何もしない", () => {
    expect(() => applyLogTableTimestamps(null, ["t1"], NOW)).not.toThrow();
    expect(() => primeLogTableRowTracking(null, [], ["t1"])).not.toThrow();
  });
});

// ホストは表の注釈の復元とエディタの公開の両方の時点で prime を呼ぶ（どちらが先でも
// 取りこぼさないため）。後の呼び出しで記録を崩さないことを確かめる
describe("prime は記録の無い表だけを埋める", () => {
  it("後から読み込み時の本文で呼ばれても、記録済みの行数は変えない", () => {
    const loaded = makeTable("t1", [["日時", "値"], ["2026-08-11 08:15", "7"]]);
    const editor = makeEditor([loaded]);
    primeLogTableRowTracking(editor, [loaded], ["t1"]); // 2 行
    addEmptyRow(editor, "t1");
    applyLogTableTimestamps(editor, ["t1"], NOW); // 3 行目に日時が入り、記録は 3 行
    // 利用者が 3 行目の日時をあえて消した
    const table = editor.getBlock("t1");
    editor.updateBlock("t1", {
      content: {
        ...table.content,
        rows: table.content.rows.map((row: any, i: number) =>
          i === 2 ? { cells: [cell(""), cell("")] } : row
        ),
      },
    });
    editor.updates.length = 0;
    // 読み込み時の本文（2 行）でもう一度呼ばれた
    primeLogTableRowTracking(editor, [loaded], ["t1"]);
    applyLogTableTimestamps(editor, ["t1"], NOW);
    // 行は増えていないので、消した日時を埋め戻さない
    expect(editor.updates.length).toBe(0);
  });

  it("空の一覧で呼ばれても、記録は消えない", () => {
    const saved = makeTable("t1", [["日時", "値"], ["2026-08-11 08:15", "7"]]);
    const editor = makeEditor([saved]);
    primeLogTableRowTracking(editor, [saved], ["t1"]);
    // 後から空の一覧で呼ばれた（呼ぶ側がまだ注釈を持っていなかった等）
    primeLogTableRowTracking(editor, [saved], []);
    addEmptyRow(editor, "t1");
    applyLogTableTimestamps(editor, ["t1"], NOW);
    expect(editor.updates.map((u) => u.rows[2])).toEqual([["2026-08-12 09:30", ""]]);
  });
});

describe("日時列の解決（ふるまいが付いた列名）", () => {
  const addRow = (editor: ReturnType<typeof makeEditor>, id: string) => {
    const block = editor.getBlock(id);
    const width = block.content.rows[0].cells.length;
    editor.updateBlock(id, {
      content: {
        ...block.content,
        rows: [...block.content.rows, { cells: Array.from({ length: width }, () => cell("")) }],
      },
    });
  };

  it("2 列目が日時列なら 2 列目に入り、1 列目は触らない", () => {
    const editor = makeEditor([makeTable("t1", [["実験", "日時"], ["A", "2026-08-11 08:15"]])]);
    const options = { columnNameOf: () => "日時" };
    applyLogTableTimestamps(editor, ["t1"], NOW, options);
    addRow(editor, "t1");
    editor.updates.length = 0;
    applyLogTableTimestamps(editor, ["t1"], NOW, options);
    expect(editor.updates[0].rows[2]).toEqual(["", "2026-08-12 09:30"]);
  });

  it("名前が見出しに無く、改名も通知しない設定なら 0 列目（旧データ互換）", () => {
    const editor = makeEditor([makeTable("t1", [["日時", "値"], ["a", "1"]])]);
    const options = { columnNameOf: () => "存在しない" };
    applyLogTableTimestamps(editor, ["t1"], NOW, options);
    addRow(editor, "t1");
    editor.updates.length = 0;
    applyLogTableTimestamps(editor, ["t1"], NOW, options);
    expect(editor.updates[0].rows[2]).toEqual(["2026-08-12 09:30", ""]);
  });

  it("見出しが改名されたら onRenameColumn を呼び、その列に日時を入れる", () => {
    const editor = makeEditor([makeTable("t1", [["実験", "日時"], ["A", "x"]])]);
    let name = "日時";
    const renames: string[][] = [];
    const options = {
      columnNameOf: () => name,
      onRenameColumn: (_id: string, from: string, to: string) => {
        renames.push([from, to]);
        name = to;
      },
    };
    applyLogTableTimestamps(editor, ["t1"], NOW, options); // 初見: 列位置 1
    // 見出しを改名し、行も足す
    editor.updateBlock("t1", {
      content: {
        type: "tableContent",
        rows: [
          { cells: [cell("実験"), cell("測定日時")] },
          { cells: [cell("A"), cell("x")] },
          { cells: [cell(""), cell("")] },
        ],
      },
    });
    editor.updates.length = 0;
    applyLogTableTimestamps(editor, ["t1"], NOW, options);
    expect(renames).toEqual([["日時", "測定日時"]]);
    expect(editor.updates[0].rows[2]).toEqual(["", "2026-08-12 09:30"]);
  });

  it("日時列が削除され列数が減ったら onRemoveColumn を呼び、書き込まない", () => {
    const editor = makeEditor([makeTable("t1", [["実験", "日時", "値"], ["A", "x", "1"]])]);
    const removed: string[] = [];
    const options = {
      columnNameOf: () => "日時",
      onRemoveColumn: (id: string) => void removed.push(id),
    };
    applyLogTableTimestamps(editor, ["t1"], NOW, options);
    editor.updateBlock("t1", {
      content: {
        type: "tableContent",
        rows: [
          { cells: [cell("実験"), cell("値")] },
          { cells: [cell("A"), cell("1")] },
          { cells: [cell(""), cell("")] },
        ],
      },
    });
    editor.updates.length = 0;
    applyLogTableTimestamps(editor, ["t1"], NOW, options);
    expect(removed).toEqual(["t1"]);
    expect(editor.updates.length).toBe(0);
  });

  it("他の列が削除されただけなら、日時列はそのまま（何も呼ばない）", () => {
    const editor = makeEditor([makeTable("t1", [["実験", "日時", "値"], ["A", "x", "1"]])]);
    const calls: string[] = [];
    const options = {
      columnNameOf: () => "日時",
      onRemoveColumn: () => void calls.push("remove"),
      onRenameColumn: () => void calls.push("rename"),
    };
    applyLogTableTimestamps(editor, ["t1"], NOW, options);
    editor.updateBlock("t1", {
      content: {
        type: "tableContent",
        rows: [{ cells: [cell("実験"), cell("日時")] }, { cells: [cell("A"), cell("x")] }],
      },
    });
    applyLogTableTimestamps(editor, ["t1"], NOW, options);
    expect(calls).toEqual([]);
  });

  it("日時列の見出しを一度空にしてから打ち直しても、先頭列へ飛ばない", () => {
    const editor = makeEditor([makeTable("t1", [["実験", "日時"], ["A", "x"]])]);
    let name = "日時";
    const renames: string[][] = [];
    const options = {
      columnNameOf: () => name,
      onRenameColumn: (_id: string, from: string, to: string) => {
        renames.push([from, to]);
        name = to;
      },
    };
    const setHeader = (second: string, extraRow = false) =>
      editor.updateBlock("t1", {
        content: {
          type: "tableContent",
          rows: [
            { cells: [cell("実験"), cell(second)] },
            { cells: [cell("A"), cell("x")] },
            ...(extraRow ? [{ cells: [cell(""), cell("")] }] : []),
          ],
        },
      });
    applyLogTableTimestamps(editor, ["t1"], NOW, options);
    setHeader(""); // 見出しを全部消した瞬間
    applyLogTableTimestamps(editor, ["t1"], NOW, options);
    setHeader("Date", true); // 打ち直して行も足す
    editor.updates.length = 0;
    applyLogTableTimestamps(editor, ["t1"], NOW, options);
    expect(renames).toEqual([["日時", "Date"]]);
    expect(editor.updates[0].rows[2]).toEqual(["", "2026-08-12 09:30"]);
  });

  it("後から足した空の日時列でも、行を足したときに埋まるのは新しい行だけ", () => {
    const editor = makeEditor([makeTable("t1", [["実験名", "日時"], ["触媒A", ""]])]);
    const options = { columnNameOf: () => "日時" };
    applyLogTableTimestamps(editor, ["t1"], NOW, options);
    addRow(editor, "t1");
    editor.updates.length = 0;
    applyLogTableTimestamps(editor, ["t1"], NOW, options);
    expect(editor.updates[0].rows).toEqual([
      ["実験名", "日時"],
      ["触媒A", ""],
      ["", "2026-08-12 09:30"],
    ]);
  });

  it("途中に挿した行にだけ日時が入る", () => {
    const editor = makeEditor([makeTable("t1", [["実験名", "日時"], ["A", ""], ["B", ""]])]);
    const options = { columnNameOf: () => "日時" };
    applyLogTableTimestamps(editor, ["t1"], NOW, options);
    editor.updateBlock("t1", {
      content: {
        type: "tableContent",
        rows: [
          { cells: [cell("実験名"), cell("日時")] },
          { cells: [cell("A"), cell("")] },
          { cells: [cell(""), cell("")] },
          { cells: [cell("B"), cell("")] },
        ],
      },
    });
    editor.updates.length = 0;
    applyLogTableTimestamps(editor, ["t1"], NOW, options);
    expect(editor.updates[0].rows.map((r) => r[1])).toEqual(["日時", "", "2026-08-12 09:30", ""]);
  });

  const setRows = (editor: ReturnType<typeof makeEditor>, rows: string[][]) =>
    editor.updateBlock("t1", {
      content: { type: "tableContent", rows: rows.map((r) => ({ cells: r.map(cell) })) },
    });

  it("日時列の見出しを空のまま保存して開き直しても、先頭列へ飛ばない", () => {
    // 注釈のキーは「日時」のまま、見出しは空で保存されたノート
    const editor = makeEditor([makeTable("t1", [["実験名", ""], ["A", "x"]])]);
    let name = "日時";
    const renames: string[][] = [];
    const options = {
      columnNameOf: () => name,
      onRenameColumn: (_id: string, from: string, to: string) => {
        renames.push([from, to]);
        name = to;
      },
    };
    primeLogTableRowTracking(editor, [editor.getBlock("t1")], ["t1"], options);
    // 先頭列のセルを編集しても改名とはみなさない
    setRows(editor, [["実験名", ""], ["A2", "x"]]);
    applyLogTableTimestamps(editor, ["t1"], NOW, options);
    expect(renames).toEqual([]);
    // 空の見出しに名前を打つと、その列への改名として追う
    setRows(editor, [["実験名", "Date"], ["A2", "x"], ["", ""]]);
    editor.updates.length = 0;
    applyLogTableTimestamps(editor, ["t1"], NOW, options);
    expect(renames).toEqual([["日時", "Date"]]);
    expect(editor.updates[0].rows[2]).toEqual(["", "2026-08-12 09:30"]);
  });

  it("列を消した直後、注釈の更新が届く前の onChange でも先頭列に書かない", () => {
    const editor = makeEditor([makeTable("t1", [["実験名", "日時"], ["A", "x"]])]);
    const calls: string[] = [];
    const options = {
      columnNameOf: () => "日時", // ストアがまだ古い
      onRemoveColumn: () => void calls.push("remove"),
      onRenameColumn: () => void calls.push("rename"),
    };
    applyLogTableTimestamps(editor, ["t1"], NOW, options);
    setRows(editor, [["実験名"], ["A"]]);
    applyLogTableTimestamps(editor, ["t1"], NOW, options);
    setRows(editor, [["実験名"], ["A"], [""]]);
    editor.updates.length = 0;
    applyLogTableTimestamps(editor, ["t1"], NOW, options);
    expect(calls).toEqual(["remove"]);
    expect(editor.updates.length).toBe(0);
  });

  it("打鍵の途中で他の列と同じ見出しになっても、付け替えない", () => {
    const editor = makeEditor([makeTable("t1", [["実験名", "日時"], ["A", "x"]])]);
    let name = "日時";
    const renames: string[][] = [];
    const options = {
      columnNameOf: () => name,
      onRenameColumn: (_id: string, from: string, to: string) => {
        renames.push([from, to]);
        name = to;
      },
    };
    applyLogTableTimestamps(editor, ["t1"], NOW, options);
    setRows(editor, [["実験名", "実験名"], ["A", "x"]]);
    applyLogTableTimestamps(editor, ["t1"], NOW, options);
    expect(renames).toEqual([]);
    setRows(editor, [["実験名", "実験日"], ["A", "x"], ["", ""]]);
    editor.updates.length = 0;
    applyLogTableTimestamps(editor, ["t1"], NOW, options);
    expect(renames).toEqual([["日時", "実験日"]]);
    expect(editor.updates[0].rows[2]).toEqual(["", "2026-08-12 09:30"]);
  });

  it("付け直す前に記録を捨てれば、外していた間に足した行には入らない", () => {
    const editor = makeEditor([makeTable("t1", [["実験名", "日時"], ["A", ""]])]);
    const options = { columnNameOf: () => "日時" };
    applyLogTableTimestamps(editor, ["t1"], NOW, options);
    // 外していた間に行が増えた（onChange では呼ばれない）
    setRows(editor, [["実験名", "日時"], ["A", ""], ["B", ""]]);
    forgetLogTableTracking(editor, "t1");
    editor.updates.length = 0;
    applyLogTableTimestamps(editor, ["t1"], NOW, options);
    expect(editor.updates.length).toBe(0);
  });
});
