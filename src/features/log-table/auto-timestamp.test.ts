// auto-timestamp.ts（記録テーブルの自動日時記入）のテスト

import { describe, it, expect, beforeEach } from "vitest";
import {
  applyLogTableTimestamps,
  resetLogTableRowTracking,
  primeLogTableRowTracking,
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

describe("applyLogTableTimestamps", () => {
  beforeEach(() => resetLogTableRowTracking());

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
    // ノート読込: 保存済みブロックから行数を priming（onChange はまだ来ていない）
    primeLogTableRowTracking([saved], ["t1"]);
    const editor = makeEditor([
      makeTable("t1", [
        ["日時", "値"],
        ["2026-08-11 08:15", "7"],
        ["", ""], // 開いて最初の行追加
      ]),
    ]);
    applyLogTableTimestamps(editor, ["t1"], NOW);
    expect(editor.updates.length).toBe(1);
    expect(editor.updates[0].rows[2]).toEqual(["2026-08-12 09:30", ""]);
  });
});
