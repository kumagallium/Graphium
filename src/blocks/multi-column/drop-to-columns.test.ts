// applyColumnDrop（DnD カラム生成の純関数）のユニットテスト
//
// ドロップの適用は「ドラッグ元の除去 → カラム正規化 → 挿入」のページ JSON
// 変換として行われる。id が保存されること（PROV・ラベル等のサイドストアが
// 生きる条件）と、適用不能ケースで null を返すこと（PM 既定への委譲）を
// ここで固定する。

import { describe, it, expect } from "vitest";
import { applyColumnDrop } from "./drop-to-columns";

const p = (id: string, text = id) => ({
  id,
  type: "paragraph",
  content: [{ type: "text", text, styles: {} }],
  children: [],
});

const col = (id: string, children: any[], width?: number) => ({
  id,
  type: "column",
  props: width != null ? { width } : {},
  children,
});

const list = (id: string, children: any[]) => ({
  id,
  type: "columnList",
  children,
});

describe("applyColumnDrop — wrap（2 カラム化）", () => {
  it("右端ドロップ: [対象, ドラッグ] の順で columnList になる", () => {
    const blocks = [p("a"), p("b"), p("target")];
    const out = applyColumnDrop(blocks, ["a"], {
      kind: "wrap",
      targetId: "target",
      side: "right",
    })!;
    expect(out.map((b) => b.type)).toEqual(["paragraph", "columnList"]);
    const cl = out[1];
    expect(cl.children.map((c: any) => c.type)).toEqual(["column", "column"]);
    expect(cl.children[0].children[0].id).toBe("target");
    expect(cl.children[1].children[0].id).toBe("a"); // id 保存
    expect(out[0].id).toBe("b");
  });

  it("左端ドロップ: [ドラッグ, 対象] の順になる", () => {
    const out = applyColumnDrop([p("a"), p("t")], ["a"], {
      kind: "wrap",
      targetId: "t",
      side: "left",
    })!;
    expect(out[0].children[0].children[0].id).toBe("a");
    expect(out[0].children[1].children[0].id).toBe("t");
  });

  it("step の中のブロックも wrap できる（ネスト走査）", () => {
    const blocks = [
      { id: "s", type: "step", content: [], children: [p("inner"), p("t")] },
      p("a"),
    ];
    const out = applyColumnDrop(blocks, ["a"], {
      kind: "wrap",
      targetId: "t",
      side: "right",
    })!;
    const step = out[0];
    expect(step.children[1].type).toBe("columnList");
    expect(step.children[1].children[1].children[0].id).toBe("a");
  });

  it("children 付きブロック（step）は children ごと移動する", () => {
    const step = { id: "s", type: "step", content: [], children: [p("in1"), p("in2")] };
    const out = applyColumnDrop([step, p("t")], ["s"], {
      kind: "wrap",
      targetId: "t",
      side: "right",
    })!;
    const moved = out[0].children[1].children[0];
    expect(moved.id).toBe("s");
    expect(moved.children.map((c: any) => c.id)).toEqual(["in1", "in2"]);
  });

  it("対象が見つからない（対象自身をドラッグ）なら null", () => {
    expect(
      applyColumnDrop([p("a"), p("t")], ["t"], { kind: "wrap", targetId: "t", side: "left" }),
    ).toBeNull();
  });

  it("ドラッグ元が見つからないなら null", () => {
    expect(
      applyColumnDrop([p("t")], ["ghost"], { kind: "wrap", targetId: "t", side: "left" }),
    ).toBeNull();
  });
});

describe("applyColumnDrop — add-column（既存リストへの追加）", () => {
  const base = () => [
    list("L", [col("c1", [p("x")], 1), col("c2", [p("y")], 2)]),
    p("a"),
  ];

  it("カラムの右に新しいカラムが入る", () => {
    const out = applyColumnDrop(base(), ["a"], {
      kind: "add-column",
      refColumnId: "c1",
      side: "right",
    })!;
    const L = out[0];
    expect(L.children).toHaveLength(3);
    expect(L.children[0].id).toBe("c1");
    expect(L.children[1].children[0].id).toBe("a"); // 新カラム
    expect(L.children[2].id).toBe("c2");
    // 既存カラムの width prop は無傷
    expect(L.children[0].props.width).toBe(1);
    expect(L.children[2].props.width).toBe(2);
  });

  it("カラムの左にも入る", () => {
    const out = applyColumnDrop(base(), ["a"], {
      kind: "add-column",
      refColumnId: "c1",
      side: "left",
    })!;
    expect(out[0].children[0].children[0].id).toBe("a");
  });

  it("カラム間の移動: 元カラムが空になったらリストごと解消される → null（PM 既定に委譲）", () => {
    // 2 カラムの一方の唯一のブロックを、もう一方の隣に落とす
    // → 除去+正規化でリスト自体が unwrap され、ref カラムが消えるので適用不能
    const blocks = [list("L", [col("c1", [p("x")]), col("c2", [p("y")])])];
    const out = applyColumnDrop(blocks, ["x"], {
      kind: "add-column",
      refColumnId: "c2",
      side: "right",
    });
    expect(out).toBeNull();
  });

  it("3 カラムから 1 本抜いてもリストは維持され、隣に追加できる", () => {
    const blocks = [
      list("L", [col("c1", [p("x")]), col("c2", [p("y")]), col("c3", [p("z")])]),
    ];
    const out = applyColumnDrop(blocks, ["x"], {
      kind: "add-column",
      refColumnId: "c3",
      side: "right",
    })!;
    const L = out[0];
    // c1 は空になって消え、c2, c3, 新カラム(x) の 3 本
    expect(L.children).toHaveLength(3);
    expect(L.children[0].id).toBe("c2");
    expect(L.children[1].id).toBe("c3");
    expect(L.children[2].children[0].id).toBe("x");
  });
});

describe("applyColumnDrop — 正規化とガード", () => {
  it("別のリストのカラムからトップレベルへ: 空カラムが消え 1 本になったリストは解消", () => {
    const blocks = [
      list("L", [col("c1", [p("x")]), col("c2", [p("y1"), p("y2")])]),
      p("t"),
    ];
    const out = applyColumnDrop(blocks, ["x"], {
      kind: "wrap",
      targetId: "t",
      side: "left",
    })!;
    // L は c1 が空 → 1 本 → 解消されて y1, y2 が持ち上がる
    expect(out.map((b) => b.id ?? b.type)).toEqual(["y1", "y2", "columnList"]);
    expect(out[2].children[0].children[0].id).toBe("x");
    expect(out[2].children[1].children[0].id).toBe("t");
  });

  it("カラム系ノード自体をドラッグ対象にしたら null", () => {
    const blocks = [list("L", [col("c1", [p("x")]), col("c2", [p("y")])]), p("t")];
    expect(
      applyColumnDrop(blocks, ["c1"], { kind: "wrap", targetId: "t", side: "left" }),
    ).toBeNull();
  });

  it("複数ブロックのドラッグは 1 つの新カラムにまとまる", () => {
    const blocks = [p("a"), p("b"), p("t")];
    const out = applyColumnDrop(blocks, ["a", "b"], {
      kind: "wrap",
      targetId: "t",
      side: "right",
    })!;
    const cl = out[0];
    expect(cl.children[1].children.map((c: any) => c.id)).toEqual(["a", "b"]);
  });
});
