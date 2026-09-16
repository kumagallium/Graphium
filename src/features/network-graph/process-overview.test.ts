// 全体ビュー集約（aggregateStepNameGraph）のテスト。
//
// 検証の軸は 3 つ:
//   - cross-note 参照が「供給側 step 名 → 消費側 step 名」のエッジとして正しく数えられること
//   - 名前が解決できないリンクは黙って落とさず dropped に計上されること
//   - since での絞り込み・未題除外・孤立ノードが規則通りに効くこと
//   - since は消費側エントリだけを絞り、供給側の解決は全件 index で行う（期間外供給は dropped）

import { describe, it, expect } from "vitest";
import { aggregateStepNameGraph } from "./process-overview";
import type { ProcessIndex, ProcessIndexEntry } from "./process-index";
import type { FlowStep } from "./activity-graph-adapter";
import type { BlockLink } from "../../lib/block-link-types";

const summary = { stepCount: 0, materialCount: 0, toolCount: 0, outputCount: 0, branching: false };

const flowStep = (id: string, name: string): FlowStep => ({ id, name, params: [] });

const link = (overrides: Partial<BlockLink> & Pick<BlockLink, "id" | "sourceBlockId" | "targetBlockId">): BlockLink => ({
  type: "informed_by",
  layer: "prov",
  createdBy: "human",
  ...overrides,
});

const entry = (overrides: Partial<ProcessIndexEntry> & Pick<ProcessIndexEntry, "noteId">): ProcessIndexEntry => ({
  title: overrides.noteId,
  sourceModifiedAt: "2026-01-01T00:00:00.000Z",
  projectedAt: "2026-01-01T00:00:00.000Z",
  graph: { steps: [], entities: [], edges: [] },
  summary,
  ...overrides,
});

const index = (processes: ProcessIndexEntry[]): ProcessIndex => ({
  version: 1,
  updatedAt: "2026-01-01T00:00:00.000Z",
  processes,
});

describe("aggregateStepNameGraph", () => {
  it("直線 2 ノート: 消費側ノートの step が供給側ノートの step を参照する", () => {
    const supplier = entry({
      noteId: "note-a",
      graph: { steps: [flowStep("a-step", "焼結")], entities: [], edges: [] },
    });
    const consumer = entry({
      noteId: "note-b",
      graph: { steps: [flowStep("b-step", "研磨")], entities: [], edges: [] },
      crossNoteLinks: [
        link({ id: "l1", sourceBlockId: "b-step", targetBlockId: "a-step", targetNoteId: "note-a" }),
      ],
    });

    const result = aggregateStepNameGraph(index([supplier, consumer]));

    expect(result.dropped).toBe(0);
    expect(result.nodes).toEqual(
      expect.arrayContaining([
        { name: "焼結", noteCount: 1 },
        { name: "研磨", noteCount: 1 },
      ]),
    );
    expect(result.edges).toEqual([{ from: "焼結", to: "研磨", count: 1 }]);
  });

  it("同じ供給を 2 ノートが使う: エッジは畳まず count が積み上がる", () => {
    const supplier = entry({
      noteId: "note-a",
      graph: { steps: [flowStep("a-step", "焼結")], entities: [], edges: [] },
    });
    const consumer1 = entry({
      noteId: "note-b",
      graph: { steps: [flowStep("b-step", "研磨")], entities: [], edges: [] },
      crossNoteLinks: [
        link({ id: "l1", sourceBlockId: "b-step", targetBlockId: "a-step", targetNoteId: "note-a" }),
      ],
    });
    const consumer2 = entry({
      noteId: "note-c",
      graph: { steps: [flowStep("c-step", "研磨")], entities: [], edges: [] },
      crossNoteLinks: [
        link({ id: "l2", sourceBlockId: "c-step", targetBlockId: "a-step", targetNoteId: "note-a" }),
      ],
    });

    const result = aggregateStepNameGraph(index([supplier, consumer1, consumer2]));

    expect(result.dropped).toBe(0);
    expect(result.edges).toEqual([{ from: "焼結", to: "研磨", count: 2 }]);
    // 研磨は 2 ノートが持つので noteCount = 2
    expect(result.nodes).toEqual(
      expect.arrayContaining([{ name: "研磨", noteCount: 2 }]),
    );
  });

  it("同一ノートに同名 step が複数あっても noteCount は 1", () => {
    const one = entry({
      noteId: "note-a",
      graph: {
        steps: [flowStep("a1", "計量"), flowStep("a2", "計量")],
        entities: [],
        edges: [],
      },
    });

    const result = aggregateStepNameGraph(index([one]));

    expect(result.nodes).toEqual([{ name: "計量", noteCount: 1 }]);
  });

  it("targetStepTitle フォールバック: targetBlockId が解決できなければスナップショット名を使う", () => {
    const supplier = entry({
      noteId: "note-a",
      // 供給側 step が改名・削除されて blockId が一致しない
      graph: { steps: [flowStep("a-step-renamed", "焼結（改）")], entities: [], edges: [] },
    });
    const consumer = entry({
      noteId: "note-b",
      graph: { steps: [flowStep("b-step", "研磨")], entities: [], edges: [] },
      crossNoteLinks: [
        link({
          id: "l1",
          sourceBlockId: "b-step",
          targetBlockId: "a-step-missing",
          targetNoteId: "note-a",
          targetStepTitle: "焼結",
        }),
      ],
    });

    const result = aggregateStepNameGraph(index([supplier, consumer]));

    expect(result.dropped).toBe(0);
    expect(result.edges).toEqual([{ from: "焼結", to: "研磨", count: 1 }]);
    // フォールバックで解決した名前もノードとして出る（note-a に帰属）
    expect(result.nodes).toEqual(
      expect.arrayContaining([{ name: "焼結", noteCount: 1 }]),
    );
  });

  it("供給ノートが index に無く targetStepTitle も無ければ dropped に計上する", () => {
    const consumer = entry({
      noteId: "note-b",
      graph: { steps: [flowStep("b-step", "研磨")], entities: [], edges: [] },
      crossNoteLinks: [
        link({ id: "l1", sourceBlockId: "b-step", targetBlockId: "a-step", targetNoteId: "note-missing" }),
      ],
    });

    const result = aggregateStepNameGraph(index([consumer]));

    expect(result.dropped).toBe(1);
    expect(result.edges).toEqual([]);
  });

  it("since で絞ると範囲外のエントリごとつながりが消える", () => {
    const oldSupplier = entry({
      noteId: "note-old-a",
      sourceModifiedAt: "2025-01-01T00:00:00.000Z",
      graph: { steps: [flowStep("a-step", "旧焼結")], entities: [], edges: [] },
    });
    const oldConsumer = entry({
      noteId: "note-old-b",
      sourceModifiedAt: "2025-01-01T00:00:00.000Z",
      graph: { steps: [flowStep("b-step", "旧研磨")], entities: [], edges: [] },
      crossNoteLinks: [
        link({ id: "l1", sourceBlockId: "b-step", targetBlockId: "a-step", targetNoteId: "note-old-a" }),
      ],
    });
    const newSupplier = entry({
      noteId: "note-new-a",
      sourceModifiedAt: "2026-06-01T00:00:00.000Z",
      graph: { steps: [flowStep("a-step", "新焼結")], entities: [], edges: [] },
    });
    const newConsumer = entry({
      noteId: "note-new-b",
      sourceModifiedAt: "2026-06-01T00:00:00.000Z",
      graph: { steps: [flowStep("b-step", "新研磨")], entities: [], edges: [] },
      crossNoteLinks: [
        link({ id: "l2", sourceBlockId: "b-step", targetBlockId: "a-step", targetNoteId: "note-new-a" }),
      ],
    });

    const result = aggregateStepNameGraph(
      index([oldSupplier, oldConsumer, newSupplier, newConsumer]),
      { since: "2026-01-01T00:00:00.000Z" },
    );

    expect(result.dropped).toBe(0);
    expect(result.edges).toEqual([{ from: "新焼結", to: "新研磨" , count: 1 }]);
    expect(result.nodes).not.toEqual(expect.arrayContaining([{ name: "旧焼結", noteCount: 1 }]));
    expect(result.nodes).not.toEqual(expect.arrayContaining([{ name: "旧研磨", noteCount: 1 }]));
  });

  it("since: 消費側は期間内だが供給側だけ期間外 → エッジもノードも出ず dropped に計上する", () => {
    // 計画書 §2.5 の規則: since は参照を持つ側（消費側）のエントリで絞る。
    // 供給側ノートが全件 index に存在しても期間外なら、線として数えず dropped にする
    const oldSupplier = entry({
      noteId: "note-old-a",
      sourceModifiedAt: "2025-01-01T00:00:00.000Z",
      graph: { steps: [flowStep("a-step", "旧焼結スナップショット")], entities: [], edges: [] },
    });
    const newConsumer = entry({
      noteId: "note-new-b",
      sourceModifiedAt: "2026-06-01T00:00:00.000Z",
      graph: { steps: [flowStep("b-step", "新研磨")], entities: [], edges: [] },
      crossNoteLinks: [
        link({ id: "l1", sourceBlockId: "b-step", targetBlockId: "a-step", targetNoteId: "note-old-a" }),
      ],
    });

    const result = aggregateStepNameGraph(
      index([oldSupplier, newConsumer]),
      { since: "2026-01-01T00:00:00.000Z" },
    );

    expect(result.dropped).toBe(1);
    expect(result.edges).toEqual([]);
    // 期間外の供給ノートの step 名は出ない（名前も混入させない）
    expect(result.nodes).not.toEqual(
      expect.arrayContaining([{ name: "旧焼結スナップショット", noteCount: 1 }]),
    );
    // 消費側の step 名は孤立ノードとして出る
    expect(result.nodes).toEqual(
      expect.arrayContaining([{ name: "新研磨", noteCount: 1 }]),
    );
  });

  it("since: 供給側ノートが全件 index にも無ければ dropped に計上する", () => {
    const consumer = entry({
      noteId: "note-b",
      sourceModifiedAt: "2026-06-01T00:00:00.000Z",
      graph: { steps: [flowStep("b-step", "研磨")], entities: [], edges: [] },
      crossNoteLinks: [
        link({ id: "l1", sourceBlockId: "b-step", targetBlockId: "a-step", targetNoteId: "note-missing" }),
      ],
    });

    const result = aggregateStepNameGraph(
      index([consumer]),
      { since: "2026-01-01T00:00:00.000Z" },
    );

    expect(result.dropped).toBe(1);
    expect(result.edges).toEqual([]);
  });

  it("since: 供給側ノートは期間内だが step が改名済み → targetStepTitle で解決でき dropped は 0", () => {
    const supplier = entry({
      noteId: "note-a",
      sourceModifiedAt: "2026-06-01T00:00:00.000Z",
      // 供給側 step が改名・削除されて blockId が一致しない
      graph: { steps: [flowStep("a-step-renamed", "焼結（改）")], entities: [], edges: [] },
    });
    const consumer = entry({
      noteId: "note-b",
      sourceModifiedAt: "2026-06-01T00:00:00.000Z",
      graph: { steps: [flowStep("b-step", "研磨")], entities: [], edges: [] },
      crossNoteLinks: [
        link({
          id: "l1",
          sourceBlockId: "b-step",
          targetBlockId: "a-step-missing",
          targetNoteId: "note-a",
          targetStepTitle: "焼結",
        }),
      ],
    });

    const result = aggregateStepNameGraph(
      index([supplier, consumer]),
      { since: "2026-01-01T00:00:00.000Z" },
    );

    expect(result.dropped).toBe(0);
    expect(result.edges).toEqual([{ from: "焼結", to: "研磨", count: 1 }]);
  });

  it("無題ラベルの step は候補から除外する", () => {
    const one = entry({
      noteId: "note-a",
      graph: {
        steps: [flowStep("a1", "(無題)"), flowStep("a2", "計量")],
        entities: [],
        edges: [],
      },
    });

    const result = aggregateStepNameGraph(index([one]), { untitledLabel: "(無題)" });

    expect(result.nodes).toEqual([{ name: "計量", noteCount: 1 }]);
  });

  it("異なる 2 ノートの step が同名でも self-loop 相当のエッジをそのまま出す（畳んだり除外しない）", () => {
    const supplier = entry({
      noteId: "note-a",
      graph: { steps: [flowStep("a-step", "検査")], entities: [], edges: [] },
    });
    const consumer = entry({
      noteId: "note-b",
      graph: { steps: [flowStep("b-step", "検査")], entities: [], edges: [] },
      crossNoteLinks: [
        link({ id: "l1", sourceBlockId: "b-step", targetBlockId: "a-step", targetNoteId: "note-a" }),
      ],
    });

    const result = aggregateStepNameGraph(index([supplier, consumer]));

    expect(result.dropped).toBe(0);
    expect(result.edges).toEqual([{ from: "検査", to: "検査", count: 1 }]);
  });

  it("エッジに出ない step 名も孤立ノードとして出す", () => {
    const one = entry({
      noteId: "note-a",
      graph: { steps: [flowStep("a1", "混合")], entities: [], edges: [] },
    });

    const result = aggregateStepNameGraph(index([one]));

    expect(result.nodes).toEqual([{ name: "混合", noteCount: 1 }]);
    expect(result.edges).toEqual([]);
  });
});
