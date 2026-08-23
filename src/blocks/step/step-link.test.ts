// step カードの前手順リンク — 候補収集の純関数テスト
//
// カードのヘッダーから informed_by を張るとき、候補は「自分以外の step」を
// 文書順に並べたもの。タイトルは Activity 名と同じ流儀（連番プレフィックス除去）。

import { describe, it, expect } from "vitest";
import {
  calculateCascadePosition,
  collectStepPredecessorCandidates,
  groupCrossNoteOutputs,
} from "./view";

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

  describe("calculateCascadePosition", () => {
    it("右端付近では全列が画面内に収まる位置まで左へずらす", () => {
      const position = calculateCascadePosition(
        { top: 360, right: 1228, bottom: 382 },
        { width: 1472, height: 826 },
        3,
      );

      expect(position).toEqual({
        top: 386,
        left: 452,
        width: 1012,
        maxHeight: 362,
      });
    });

    it("右側に十分な空きがあればトリガー直下の位置を維持する", () => {
      const position = calculateCascadePosition(
        { top: 120, right: 642, bottom: 142 },
        { width: 1472, height: 826 },
        3,
      );

      expect(position).toEqual({
        top: 146,
        left: 362,
        width: 1012,
        maxHeight: 362,
      });
    });

    it("全列が収まらない幅では画面内にスクロール領域を作る", () => {
      const position = calculateCascadePosition(
        { top: 220, right: 740, bottom: 242 },
        { width: 768, height: 700 },
        3,
      );

      expect(position).toEqual({
        top: 246,
        left: 8,
        width: 752,
        maxHeight: 362,
      });
    });

    it("上下どちらにも収まらない場合は画面内の高さに制限する", () => {
      const position = calculateCascadePosition(
        { top: 350, right: 740, bottom: 370 },
        { width: 768, height: 700 },
        1,
      );

      expect(position).toEqual({
        top: 8,
        left: 236,
        width: 524,
        maxHeight: 362,
      });
    });
  });

  describe("groupCrossNoteOutputs", () => {
    it("ノート → step → output の階層へまとめる", () => {
      const output = (
        noteId: string,
        noteTitle: string,
        stepId: string,
        stepName: string,
        label: string,
      ) => ({
        noteId,
        noteTitle,
        sourceModifiedAt: "2026-08-21T00:00:00.000Z",
        stepId,
        stepName,
        entityIdentity: `${stepId}:${label}`,
        identityStable: true,
        label,
        outputIndex: 0,
        outputCount: 1,
        attrs: [],
      });

      expect(
        groupCrossNoteOutputs([
          output("n1", "実験 A", "s1", "合成", "試料 A"),
          output("n1", "実験 A", "s1", "合成", "試料 B"),
          output("n1", "実験 A", "s2", "評価", "測定結果"),
          output("n2", "実験 B", "s3", "焼成", "焼成体"),
        ]),
      ).toEqual([
        {
          noteId: "n1",
          noteTitle: "実験 A",
          steps: [
            {
              stepId: "s1",
              stepName: "合成",
              outputs: [
                expect.objectContaining({ label: "試料 A" }),
                expect.objectContaining({ label: "試料 B" }),
              ],
            },
            {
              stepId: "s2",
              stepName: "評価",
              outputs: [expect.objectContaining({ label: "測定結果" })],
            },
          ],
        },
        {
          noteId: "n2",
          noteTitle: "実験 B",
          steps: [
            {
              stepId: "s3",
              stepName: "焼成",
              outputs: [expect.objectContaining({ label: "焼成体" })],
            },
          ],
        },
      ]);
    });
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
