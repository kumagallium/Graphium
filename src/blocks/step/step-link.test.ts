// step カードの前手順リンク — 候補収集の純関数テスト
//
// カードのヘッダーから informed_by を張るとき、候補は「自分以外の step」を
// 文書順に並べたもの。タイトルは Activity 名と同じ流儀（連番プレフィックス除去）。

import { describe, it, expect } from "vitest";
import { collectStepPredecessorCandidates } from "./view";

const step = (id: string, title: string, children: any[] = []) => ({
  id,
  type: "step",
  content: [{ type: "text", text: title, styles: {} }],
  children,
});

const para = (id: string, text = "") => ({
  id,
  type: "paragraph",
  content: [{ type: "text", text, styles: {} }],
  children: [],
});

describe("collectStepPredecessorCandidates", () => {
  it("自分以外の step を文書順に集める", () => {
    const doc = [step("s1", "前処理"), para("p1"), step("s2", "反応 A"), step("s3", "評価")];
    expect(collectStepPredecessorCandidates(doc, "s2")).toEqual([
      { blockId: "s1", title: "前処理" },
      { blockId: "s3", title: "評価" },
    ]);
  });

  it("タイトルの連番プレフィックスは除かれる（Activity 名と同じ見た目）", () => {
    const doc = [step("s1", "1. 前処理"), step("s2", "反応")];
    expect(collectStepPredecessorCandidates(doc, "s2")[0].title).toBe("前処理");
  });

  it("無関係な入れ子の step は候補に入る", () => {
    const doc = [step("outer", "外側", [step("inner", "内側")]), step("s2", "次")];
    expect(collectStepPredecessorCandidates(doc, "s2").map((c) => c.blockId)).toEqual([
      "outer",
      "inner",
    ]);
  });

  it("自分の子孫（内部工程）は候補に入らない", () => {
    // containment が既に関係を表す。informed_by を重ねると二重になる
    const doc = [step("outer", "外側", [step("inner", "内側")]), step("s2", "次")];
    expect(collectStepPredecessorCandidates(doc, "outer").map((c) => c.blockId)).toEqual([
      "s2",
    ]);
  });

  it("自分の祖先（自分を包む工程）は候補に入らない", () => {
    const doc = [
      step("outer", "外側", [step("mid", "中間", [step("inner", "内側")])]),
      step("s2", "次"),
    ];
    expect(collectStepPredecessorCandidates(doc, "inner").map((c) => c.blockId)).toEqual([
      "s2",
    ]);
  });

  it("タイトルが空の step は id 断片でフォールバックする", () => {
    const doc = [step("abcdef1234", ""), step("s2", "次")];
    expect(collectStepPredecessorCandidates(doc, "s2")[0].title).toBe("abcdef12");
  });

  it("step が他に無ければ空", () => {
    const doc = [step("s1", "唯一"), para("p1")];
    expect(collectStepPredecessorCandidates(doc, "s1")).toEqual([]);
  });
});
