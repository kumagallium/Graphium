// ローカルビュー（local-view-model.ts）のテスト。
//
// 検証の軸:
//   - 計画あり: 親・同じ層・子（子 = steps）
//   - 起点が計画ノート自身: 子 = notes、親レーンは空
//   - 起点が入れ子の途中: 親・同じ層・子（子 = notes）が全部埋まる
//   - 計画なし: cross-note 参照で depth 1 / 2
//   - 同日重なりで row が増える
//   - step の分岐で col が同じまま row が分かれる
//   - 工程ノートが 2 つの計画に属する（plans が 2 件、modifiedAt 最新が先頭）
//   - trashed の sibling が state 付きで残る

import { describe, expect, it } from "vitest";
import { buildLocalView } from "./local-view-model";
import type { GraphiumIndex, NoteIndexEntry } from "../navigation/index-file";
import type { ProcessIndex, ProcessIndexEntry } from "./process-index";
import type { FlowGraphData } from "./activity-graph-adapter";
import type { BlockLink } from "../../lib/block-link-types";

// ── フィクスチャ用ヘルパー（plan-flow.test.ts と同じ作り） ──

function noteEntry(overrides: Partial<NoteIndexEntry> & { noteId: string }): NoteIndexEntry {
  return {
    title: overrides.noteId,
    modifiedAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    headings: [],
    labels: [],
    outgoingLinks: [],
    ...overrides,
  };
}

function makeIndex(notes: NoteIndexEntry[]): GraphiumIndex {
  return { version: 26, updatedAt: "2026-09-01T00:00:00.000Z", notes };
}

function emptyGraph(): FlowGraphData {
  return { steps: [], entities: [], edges: [] };
}

function processEntry(overrides: Partial<ProcessIndexEntry> & { noteId: string }): ProcessIndexEntry {
  return {
    title: overrides.noteId,
    sourceModifiedAt: "2026-09-01T00:00:00.000Z",
    projectedAt: "2026-09-01T00:00:00.000Z",
    graph: emptyGraph(),
    summary: { stepCount: 1, materialCount: 0, toolCount: 0, outputCount: 1, branching: false },
    ...overrides,
  };
}

function makeProcessIndex(processes: ProcessIndexEntry[]): ProcessIndex {
  return { version: 4, updatedAt: "2026-09-01T00:00:00.000Z", processes };
}

function crossLink(overrides: Partial<BlockLink> & { id: string }): BlockLink {
  return {
    sourceBlockId: "src-step",
    targetBlockId: "remote-step",
    type: "informed_by",
    layer: "prov",
    createdBy: "human",
    ...overrides,
  } as BlockLink;
}

// ── 計画あり: 親・同じ層・子(steps) ──

describe("buildLocalView: 計画あり", () => {
  const index = makeIndex([
    noteEntry({
      noteId: "plan-1",
      title: "製造計画",
      noteContexts: ["計画"],
      modifiedAt: "2026-09-05T00:00:00.000Z",
      outgoingLinks: [
        { targetNoteId: "op-a", layer: "knowledge" },
        { targetNoteId: "op-b", layer: "knowledge" },
      ],
    }),
    noteEntry({ noteId: "op-a", title: "合成", createdAt: "2026-09-01T00:00:00.000Z" }),
    noteEntry({ noteId: "op-b", title: "焼成", createdAt: "2026-09-02T00:00:00.000Z" }),
  ]);

  const processIndex = makeProcessIndex([
    processEntry({
      noteId: "op-a",
      graph: {
        steps: [
          { id: "step-1", name: "秤量", params: [] },
          { id: "step-2", name: "混合", params: [] },
        ],
        entities: [{ id: "mid-1", label: "混合物", kind: "output", attrs: [] }],
        edges: [
          { id: "g1", kind: "generates", source: "step-1", target: "mid-1" },
          { id: "u1", kind: "used", source: "mid-1", target: "step-2" },
        ],
      },
    }),
  ]);

  it("親は計画ノート、同じ層は工程ノート、子は起点(op-a)の step 整列", () => {
    const view = buildLocalView({ originNoteId: "op-a", index, processIndex });
    expect(view).not.toBeNull();
    expect(view!.origin).toEqual({ noteId: "op-a", title: "合成" });
    expect(view!.plans).toEqual([{ noteId: "plan-1", title: "製造計画" }]);
    expect(view!.parent).toMatchObject({ noteId: "plan-1", title: "製造計画" });
    expect(view!.siblings.map((s) => s.noteId).sort()).toEqual(["op-a", "op-b"]);
    expect(view!.siblings.find((s) => s.noteId === "op-a")?.isOrigin).toBe(true);

    expect(view!.children.kind).toBe("steps");
    if (view!.children.kind === "steps") {
      const step1 = view!.children.steps.find((s) => s.id === "step-1")!;
      const step2 = view!.children.steps.find((s) => s.id === "step-2")!;
      expect(step1.col).toBe(0);
      expect(step2.col).toBe(1);
      expect(view!.children.edges).toEqual([{ from: "step-1", to: "step-2" }]);
    }
  });

  it("計画ノートが index に無い起点は null", () => {
    expect(buildLocalView({ originNoteId: "missing", index, processIndex })).toBeNull();
  });
});

// ── 起点が計画ノート自身: 子 = notes、親レーンは空 ──

describe("buildLocalView: 起点が最上位の計画", () => {
  it("親レーンは空、同じ層は起点のみ、子は工程ノート一覧", () => {
    const index = makeIndex([
      noteEntry({
        noteId: "plan-1",
        title: "製造計画",
        noteContexts: ["計画"],
        outgoingLinks: [{ targetNoteId: "op-a", layer: "knowledge" }],
      }),
      noteEntry({ noteId: "op-a", title: "合成" }),
    ]);
    const processIndex = makeProcessIndex([]);

    const view = buildLocalView({ originNoteId: "plan-1", index, processIndex });
    expect(view).not.toBeNull();
    expect(view!.plans).toEqual([]); // 自分を指す計画は無い
    expect(view!.parent).toBeNull();
    expect(view!.siblings.map((s) => s.noteId)).toEqual(["plan-1"]);
    expect(view!.children).toEqual({
      kind: "notes",
      notes: [
        { noteId: "op-a", title: "合成", t: "2026-09-01T00:00:00.000Z", row: 0, isOrigin: false, state: undefined },
      ],
    });
  });
});

// ── 起点が入れ子の途中: 親・同じ層・子(notes) が全部埋まる ──

describe("buildLocalView: 起点が入れ子の途中", () => {
  it("親は上位計画、同じ層は兄弟工程、子は自分の工程ノート", () => {
    const index = makeIndex([
      noteEntry({
        noteId: "plan-top",
        title: "上位計画",
        noteContexts: ["計画"],
        outgoingLinks: [
          { targetNoteId: "sub-plan", layer: "knowledge" },
          { targetNoteId: "op-sibling", layer: "knowledge" },
        ],
      }),
      noteEntry({
        noteId: "sub-plan",
        title: "下位計画（入れ子）",
        noteContexts: ["計画", "計画/サブ"],
        outgoingLinks: [{ targetNoteId: "op-child", layer: "knowledge" }],
      }),
      noteEntry({ noteId: "op-sibling", title: "兄弟工程" }),
      noteEntry({ noteId: "op-child", title: "子工程" }),
    ]);
    const processIndex = makeProcessIndex([]);

    const view = buildLocalView({ originNoteId: "sub-plan", index, processIndex });
    expect(view).not.toBeNull();
    expect(view!.parent?.noteId).toBe("plan-top");
    expect(view!.siblings.map((s) => s.noteId).sort()).toEqual(["op-sibling", "sub-plan"]);
    expect(view!.children).toEqual({
      kind: "notes",
      notes: [
        { noteId: "op-child", title: "子工程", t: "2026-09-01T00:00:00.000Z", row: 0, isOrigin: false, state: undefined },
      ],
    });
  });
});

// ── 計画なし: cross-note 参照で depth ホップ ──

describe("buildLocalView: 計画なし", () => {
  function makeChain(): { index: GraphiumIndex; processIndex: ProcessIndex } {
    const index = makeIndex([
      noteEntry({ noteId: "note-a", title: "A" }),
      noteEntry({ noteId: "note-b", title: "B" }),
      noteEntry({ noteId: "note-c", title: "C" }),
    ]);
    // note-b が note-a を参照し、note-c が note-b を参照する鎖
    const processIndex = makeProcessIndex([
      processEntry({
        noteId: "note-b",
        crossNoteLinks: [crossLink({ id: "l-ab", targetNoteId: "note-a" })],
      }),
      processEntry({
        noteId: "note-c",
        crossNoteLinks: [crossLink({ id: "l-bc", targetNoteId: "note-b" })],
      }),
    ]);
    return { index, processIndex };
  }

  it("depth 1: 直接つながる 1 ホップだけを siblings にし、truncated を立てる", () => {
    const { index, processIndex } = makeChain();
    const view = buildLocalView({ originNoteId: "note-b", index, processIndex, depth: 1 });
    expect(view!.plans).toEqual([]);
    expect(view!.parent).toBeNull();
    expect(view!.siblings.map((s) => s.noteId).sort()).toEqual(["note-a", "note-b", "note-c"]);
    // note-b から note-a・note-c は 1 ホップなので depth 1 で全部拾える → truncated しない
    expect(view!.truncated).toBe(false);
  });

  it("depth 1 かつ端から辿ると、2 ホップ先は含まれず truncated が立つ", () => {
    const index = makeIndex([
      noteEntry({ noteId: "note-a", title: "A" }),
      noteEntry({ noteId: "note-b", title: "B" }),
      noteEntry({ noteId: "note-c", title: "C" }),
    ]);
    const processIndex = makeProcessIndex([
      processEntry({
        noteId: "note-b",
        crossNoteLinks: [crossLink({ id: "l-ab", targetNoteId: "note-a" })],
      }),
      processEntry({
        noteId: "note-c",
        crossNoteLinks: [crossLink({ id: "l-bc", targetNoteId: "note-b" })],
      }),
    ]);
    const view = buildLocalView({ originNoteId: "note-c", index, processIndex, depth: 1 });
    expect(view!.siblings.map((s) => s.noteId).sort()).toEqual(["note-b", "note-c"]);
    expect(view!.truncated).toBe(true);
  });

  it("depth 2: 2 ホップ先まで含めて truncated しない", () => {
    const index = makeIndex([
      noteEntry({ noteId: "note-a", title: "A" }),
      noteEntry({ noteId: "note-b", title: "B" }),
      noteEntry({ noteId: "note-c", title: "C" }),
    ]);
    const processIndex = makeProcessIndex([
      processEntry({
        noteId: "note-b",
        crossNoteLinks: [crossLink({ id: "l-ab", targetNoteId: "note-a" })],
      }),
      processEntry({
        noteId: "note-c",
        crossNoteLinks: [crossLink({ id: "l-bc", targetNoteId: "note-b" })],
      }),
    ]);
    const view = buildLocalView({ originNoteId: "note-c", index, processIndex, depth: 2 });
    expect(view!.siblings.map((s) => s.noteId).sort()).toEqual(["note-a", "note-b", "note-c"]);
    expect(view!.truncated).toBe(false);
  });
});

// ── 同日重なりで row が増える ──

describe("buildLocalView: row の割り当て", () => {
  it("同じ日付の siblings は row が 1 ずつ増え、日付が変われば 0 に戻る", () => {
    const index = makeIndex([
      noteEntry({
        noteId: "plan-1",
        noteContexts: ["計画"],
        outgoingLinks: [
          { targetNoteId: "op-a", layer: "knowledge" },
          { targetNoteId: "op-b", layer: "knowledge" },
          { targetNoteId: "op-c", layer: "knowledge" },
        ],
      }),
      noteEntry({ noteId: "op-a", title: "A", createdAt: "2026-09-01T09:00:00.000Z" }),
      noteEntry({ noteId: "op-b", title: "B", createdAt: "2026-09-01T10:00:00.000Z" }),
      noteEntry({ noteId: "op-c", title: "C", createdAt: "2026-09-02T09:00:00.000Z" }),
    ]);
    const view = buildLocalView({ originNoteId: "op-a", index, processIndex: makeProcessIndex([]) });
    const byId = Object.fromEntries(view!.siblings.map((s) => [s.noteId, s.row]));
    expect(byId["op-a"]).toBe(0);
    expect(byId["op-b"]).toBe(1); // 同日 2 件目
    expect(byId["op-c"]).toBe(0); // 日付が変わったので 0 に戻る
  });
});

// ── step の分岐で col が同じまま row が分かれる ──

describe("buildLocalView: step の分岐", () => {
  it("同じ col の分岐先は row で分ける", () => {
    const index = makeIndex([noteEntry({ noteId: "op-a", title: "工程" })]);
    const processIndex = makeProcessIndex([
      processEntry({
        noteId: "op-a",
        graph: {
          steps: [
            { id: "step-1", name: "起点", params: [] },
            { id: "step-2a", name: "分岐A", params: [] },
            { id: "step-2b", name: "分岐B", params: [] },
          ],
          entities: [{ id: "out-1", label: "中間物", kind: "output", attrs: [] }],
          edges: [
            { id: "g1", kind: "generates", source: "step-1", target: "out-1" },
            { id: "u1", kind: "used", source: "out-1", target: "step-2a" },
            { id: "u2", kind: "used", source: "out-1", target: "step-2b" },
          ],
        },
      }),
    ]);
    const view = buildLocalView({ originNoteId: "op-a", index, processIndex });
    expect(view!.children.kind).toBe("steps");
    if (view!.children.kind === "steps") {
      const byId = Object.fromEntries(view!.children.steps.map((s) => [s.id, s]));
      expect(byId["step-1"]).toMatchObject({ col: 0, row: 0 });
      expect(byId["step-2a"].col).toBe(1);
      expect(byId["step-2b"].col).toBe(1);
      expect(new Set([byId["step-2a"].row, byId["step-2b"].row])).toEqual(new Set([0, 1]));
    }
  });
});

// ── 工程ノートが 2 つの計画に属する ──

describe("buildLocalView: 複数の計画に属する工程ノート", () => {
  it("plans が 2 件、modifiedAt 最新が先頭（親）", () => {
    const index = makeIndex([
      noteEntry({
        noteId: "plan-old",
        title: "旧計画",
        noteContexts: ["計画"],
        modifiedAt: "2026-09-01T00:00:00.000Z",
        outgoingLinks: [{ targetNoteId: "op-shared", layer: "knowledge" }],
      }),
      noteEntry({
        noteId: "plan-new",
        title: "新計画",
        noteContexts: ["plan"],
        modifiedAt: "2026-09-05T00:00:00.000Z",
        outgoingLinks: [{ targetNoteId: "op-shared", layer: "knowledge" }],
      }),
      noteEntry({ noteId: "op-shared", title: "共有工程" }),
    ]);
    const view = buildLocalView({ originNoteId: "op-shared", index, processIndex: makeProcessIndex([]) });
    expect(view!.plans.map((p) => p.noteId)).toEqual(["plan-new", "plan-old"]);
    expect(view!.parent?.noteId).toBe("plan-new");
  });
});

// ── trashed の sibling が state 付きで残る ──

describe("buildLocalView: ゴミ箱の sibling", () => {
  it("trashed の工程ノートは除外されず state 付きで siblings に残る", () => {
    const index = makeIndex([
      noteEntry({
        noteId: "plan-1",
        noteContexts: ["計画"],
        outgoingLinks: [
          { targetNoteId: "op-a", layer: "knowledge" },
          { targetNoteId: "op-b", layer: "knowledge" },
        ],
      }),
      noteEntry({ noteId: "op-a", title: "A" }),
      noteEntry({ noteId: "op-b", title: "B", deletedAt: "2026-09-03T00:00:00.000Z" }),
    ]);
    const view = buildLocalView({ originNoteId: "op-a", index, processIndex: makeProcessIndex([]) });
    const opB = view!.siblings.find((s) => s.noteId === "op-b");
    expect(opB?.state).toBe("trashed");
  });
});

// ── handoffs（siblings 間の cross-note 参照） ──
//
// fixture の作りは plan-flow.test.ts の broken 系テストと揃える:
// op-a の output（rowIdentity="row-a"）を op-b が informed_by で参照する。

describe("buildLocalView: handoffs", () => {
  function baseIndex(): GraphiumIndex {
    return makeIndex([
      noteEntry({
        noteId: "plan-1",
        title: "計画",
        noteContexts: ["計画"],
        outgoingLinks: [
          { targetNoteId: "op-a", layer: "knowledge" },
          { targetNoteId: "op-b", layer: "knowledge" },
        ],
      }),
      noteEntry({ noteId: "op-a", title: "A" }),
      noteEntry({ noteId: "op-b", title: "B" }),
    ]);
  }

  it("解決できる参照: from=参照元, to=参照先, broken=false", () => {
    const aGraph: FlowGraphData = {
      steps: [{ id: "step-a", name: "秤量", params: [] }],
      entities: [{ id: "out-a", label: "粉末", kind: "output", rowIdentity: "row-a", attrs: [] }],
      edges: [{ id: "g1", kind: "generates", source: "step-a", target: "out-a" }],
    };
    const processIndex = makeProcessIndex([
      processEntry({ noteId: "op-a", graph: aGraph }),
      processEntry({
        noteId: "op-b",
        crossNoteLinks: [
          crossLink({
            id: "l-ab",
            targetNoteId: "op-a",
            targetBlockId: "step-a",
            targetEntityId: "row-a",
          }),
        ],
      }),
    ]);

    const view = buildLocalView({ originNoteId: "op-a", index: baseIndex(), processIndex });
    expect(view!.handoffs).toEqual([{ from: "op-b", to: "op-a", broken: false }]);
  });

  it("resolveCrossNoteOutput が null になる参照: broken=true", () => {
    const processIndex = makeProcessIndex([
      processEntry({ noteId: "op-a", graph: emptyGraph() }), // 参照先の行が消えている想定
      processEntry({
        noteId: "op-b",
        crossNoteLinks: [
          crossLink({
            id: "l-ab",
            targetNoteId: "op-a",
            targetBlockId: "step-a",
            targetEntityId: "row-a",
          }),
        ],
      }),
    ]);

    const view = buildLocalView({ originNoteId: "op-a", index: baseIndex(), processIndex });
    expect(view!.handoffs).toEqual([{ from: "op-b", to: "op-a", broken: true }]);
  });

  it("自己参照（targetNoteId === fromId）は handoff として出さない", () => {
    // 現行実装は fromId === targetNoteId の参照を早期 continue で弾く（自ノート内の
    // 参照は siblings 間の「つながり」ではないため）。この挙動をテストで固定する。
    const processIndex = makeProcessIndex([
      processEntry({
        noteId: "op-a",
        graph: emptyGraph(),
        crossNoteLinks: [
          crossLink({
            id: "l-aa",
            targetNoteId: "op-a",
            targetBlockId: "step-a",
            targetEntityId: "row-a",
          }),
        ],
      }),
      processEntry({ noteId: "op-b", graph: emptyGraph() }),
    ]);

    const view = buildLocalView({ originNoteId: "op-a", index: baseIndex(), processIndex });
    expect(view!.handoffs).toEqual([]);
  });

  it("同じ from/to の参照が複数あり一部が broken なら、1 本にまとめ broken=true にする", () => {
    const aGraph: FlowGraphData = {
      steps: [{ id: "step-a", name: "秤量", params: [] }],
      entities: [{ id: "out-a", label: "粉末", kind: "output", rowIdentity: "row-a", attrs: [] }],
      edges: [{ id: "g1", kind: "generates", source: "step-a", target: "out-a" }],
    };
    const processIndex = makeProcessIndex([
      processEntry({ noteId: "op-a", graph: aGraph }),
      processEntry({
        noteId: "op-b",
        crossNoteLinks: [
          crossLink({
            id: "l-ab-ok",
            targetNoteId: "op-a",
            targetBlockId: "step-a",
            targetEntityId: "row-a",
          }),
          crossLink({
            id: "l-ab-broken",
            targetNoteId: "op-a",
            targetBlockId: "step-a",
            targetEntityId: "row-missing",
          }),
        ],
      }),
    ]);

    const view = buildLocalView({ originNoteId: "op-a", index: baseIndex(), processIndex });
    expect(view!.handoffs).toEqual([{ from: "op-b", to: "op-a", broken: true }]);
  });
});
