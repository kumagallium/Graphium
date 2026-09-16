// 工程フロー（plan-flow.ts）のテスト。
//
// 検証の軸:
//   - collectOperationRows: 表の行 → ノート対応の解決（@付き/無し両キー・同名衝突・
//     trashed/archived の反映）
//   - collectOperationNoteIds / findPlanNotesOf: index だけから取れる工程・計画の集合
//   - buildPlanFlowGraph: 直線・分岐・合流・未作成・broken・計画外参照除外・入れ子・循環・深さ上限

import { describe, expect, it } from "vitest";
import {
  collectOperationRows,
  collectOperationRowsFromBlocks,
  nextDefaultOperationName,
  collectOperationNoteIds,
  findPlanNotesOf,
  collectCrossNoteReferencesTo,
  buildPlanFlowGraph,
  PLAN_FLOW_MAX_DEPTH,
  PLANNED_INPUT_SEPARATOR,
  parsePlannedInputs,
  formatPlannedInputs,
  resolvePlannedRow,
  wouldCreatePlannedCycle,
  type OperationRow,
} from "./plan-flow";
import type { GraphiumDocument } from "../../lib/document-types";
import type { GraphiumIndex, NoteIndexEntry } from "../navigation/index-file";
import type { ProcessIndex, ProcessIndexEntry } from "./process-index";
import type { FlowGraphData } from "./activity-graph-adapter";
import type { BlockLink } from "../../lib/block-link-types";
import { t } from "../../i18n";

// ── フィクスチャ用ヘルパー ──

const cellText = (text: string) => [{ type: "text", text, styles: {} }];

function tableBlock(id: string, rows: string[][]) {
  return {
    id,
    type: "table",
    content: {
      type: "tableContent",
      rows: rows.map((cells) => ({ cells: cells.map(cellText) })),
    },
  };
}

function makeDoc(opts: {
  blocks: any[];
  tableMeta: Record<string, { noteLinks?: Record<string, string>; columns?: Record<string, string[]> }>;
}): GraphiumDocument {
  return {
    version: 2,
    title: "Plan",
    pages: [
      {
        id: "page-1",
        title: "Main",
        blocks: opts.blocks,
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
        tableMeta: opts.tableMeta as any,
      },
    ],
    createdAt: "2026-09-01T00:00:00.000Z",
    modifiedAt: "2026-09-01T00:00:00.000Z",
  } as GraphiumDocument;
}

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

// ── collectOperationRows ──

describe("collectOperationRows", () => {
  it("note-link 列を持つ表の行を出現順で拾う", () => {
    const doc = makeDoc({
      blocks: [
        tableBlock("t1", [
          ["工程", "条件"],
          ["合成", "800C"],
          ["洗浄", ""],
        ]),
      ],
      tableMeta: { t1: { noteLinks: { 合成: "note-a", 洗浄: "note-b" }, columns: { 工程: ["note-link"] } } },
    });

    const rows = collectOperationRows(doc);
    expect(rows.map((r) => r.name)).toEqual(["合成", "洗浄"]);
    expect(rows[0]).toMatchObject({ noteId: "note-a", attrs: [{ label: "条件: 800C" }] });
    expect(rows[1]).toMatchObject({ noteId: "note-b", attrs: [] }); // 空セルは出さない
  });

  it("planned-input 列は plannedFrom に読み、attrs には混ざらない", () => {
    const doc = makeDoc({
      blocks: [
        tableBlock("t1", [
          ["工程", "入力元", "条件"],
          ["焼成", "合成、洗浄", "800C"],
        ]),
      ],
      tableMeta: {
        t1: {
          noteLinks: { 焼成: "note-b" },
          columns: { 工程: ["note-link"], 入力元: ["planned-input"] },
        },
      },
    });
    const rows = collectOperationRows(doc);
    expect(rows[0].plannedFrom).toEqual(["合成", "洗浄"]);
    expect(rows[0].attrs).toEqual([{ label: "条件: 800C" }]); // 入力元列は attrs に出ない
  });

  it("planned-input 列が無い表は plannedFrom が空配列", () => {
    const doc = makeDoc({
      blocks: [tableBlock("t1", [["工程"], ["合成"]])],
      tableMeta: { t1: { noteLinks: { 合成: "note-a" }, columns: { 工程: ["note-link"] } } },
    });
    const rows = collectOperationRows(doc);
    expect(rows[0].plannedFrom).toEqual([]);
  });

  it("note-link 列が無い表は無視する", () => {
    const doc = makeDoc({
      blocks: [tableBlock("t1", [["a"], ["1"]])],
      tableMeta: { t1: {} },
    });
    expect(collectOperationRows(doc)).toEqual([]);
  });

  it('"@名前" と "名前" の両キーで noteLinks を解決する', () => {
    const doc = makeDoc({
      blocks: [
        tableBlock("t1", [
          ["工程"],
          ["@合成"], // 作成済み行はセルが @名前 表記
          ["洗浄"], // 未作成扱いで表示は素の名前
        ]),
      ],
      tableMeta: {
        t1: {
          // 合成は @付きキーのみ、洗浄は素の名前のみで登録されているケース
          noteLinks: { "合成": "note-a", "洗浄": "note-b" },
          columns: { 工程: ["note-link"] },
        },
      },
    });
    const rows = collectOperationRows(doc);
    expect(rows[0]).toMatchObject({ name: "@合成", noteId: "note-a" });
    expect(rows[1]).toMatchObject({ name: "洗浄", noteId: "note-b" });
  });

  it("同名の行が 2 回目以降に現れたら duplicateName にして noteId を解決しない", () => {
    const doc = makeDoc({
      blocks: [
        tableBlock("t1", [
          ["工程"],
          ["合成"],
          ["合成"], // 2 回目
        ]),
      ],
      tableMeta: { t1: { noteLinks: { 合成: "note-a" }, columns: { 工程: ["note-link"] } } },
    });
    const rows = collectOperationRows(doc);
    expect(rows[0]).toMatchObject({ noteId: "note-a", state: undefined });
    expect(rows[1]).toMatchObject({ noteId: null, state: "duplicateName" });
  });

  it("未作成行（noteLinks に無い）は unlinked", () => {
    const doc = makeDoc({
      blocks: [tableBlock("t1", [["工程"], ["合成"]])],
      tableMeta: { t1: { noteLinks: {}, columns: { 工程: ["note-link"] } } },
    });
    const rows = collectOperationRows(doc);
    expect(rows[0]).toMatchObject({ noteId: null, state: "unlinked" });
  });

  it("index の deletedAt / archivedAt を trashed / archived として反映する", () => {
    const doc = makeDoc({
      blocks: [tableBlock("t1", [["工程"], ["合成"], ["洗浄"]])],
      tableMeta: { t1: { noteLinks: { 合成: "note-a", 洗浄: "note-b" }, columns: { 工程: ["note-link"] } } },
    });
    const index = makeIndex([
      noteEntry({ noteId: "note-a", deletedAt: "2026-09-02T00:00:00.000Z" }),
      noteEntry({ noteId: "note-b", archivedAt: "2026-09-02T00:00:00.000Z" }),
    ]);
    const rows = collectOperationRows(doc, index);
    expect(rows[0].state).toBe("trashed");
    expect(rows[1].state).toBe("archived");
  });
});

// ── collectOperationNoteIds / findPlanNotesOf / collectCrossNoteReferencesTo ──

describe("collectOperationNoteIds", () => {
  it("knowledge/prov 層の重複ターゲットを dedupe し出現順で返す", () => {
    const index = makeIndex([
      noteEntry({
        noteId: "plan-1",
        outgoingLinks: [
          { targetNoteId: "op-a", layer: "knowledge" },
          { targetNoteId: "op-a", targetBlockId: "b1", layer: "prov" },
          { targetNoteId: "op-b", layer: "knowledge" },
        ],
      }),
    ]);
    expect(collectOperationNoteIds(index, "plan-1")).toEqual(["op-a", "op-b"]);
  });

  it("計画ノートが index に無ければ空配列", () => {
    const index = makeIndex([]);
    expect(collectOperationNoteIds(index, "missing")).toEqual([]);
  });
});

describe("findPlanNotesOf", () => {
  it("計画ノートからの参照だけを modifiedAt 降順で返す", () => {
    const index = makeIndex([
      noteEntry({
        noteId: "plan-old",
        noteContexts: ["計画"],
        modifiedAt: "2026-09-01T00:00:00.000Z",
        outgoingLinks: [{ targetNoteId: "op-1", layer: "knowledge" }],
      }),
      noteEntry({
        noteId: "plan-new",
        noteContexts: ["plan"],
        modifiedAt: "2026-09-05T00:00:00.000Z",
        outgoingLinks: [{ targetNoteId: "op-1", layer: "knowledge" }],
      }),
      noteEntry({
        noteId: "not-plan",
        noteContexts: ["計画中"], // 予約語の前方一致だが別語（弾く）
        outgoingLinks: [{ targetNoteId: "op-1", layer: "knowledge" }],
      }),
    ]);
    const result = findPlanNotesOf(index, "op-1");
    expect(result.map((n) => n.noteId)).toEqual(["plan-new", "plan-old"]);
  });

  it("アーカイブ済みの計画ノートは出さない", () => {
    const index = makeIndex([
      noteEntry({
        noteId: "plan-archived",
        noteContexts: ["計画"],
        archivedAt: "2026-09-02T00:00:00.000Z",
        outgoingLinks: [{ targetNoteId: "op-1", layer: "knowledge" }],
      }),
    ]);
    expect(findPlanNotesOf(index, "op-1")).toEqual([]);
  });
});

describe("collectCrossNoteReferencesTo", () => {
  it("informed_by で targetNoteId が一致するリンクだけ集める", () => {
    const link = crossLink({ id: "l1", targetNoteId: "op-target", targetEntityId: "row-1" });
    const other = crossLink({ id: "l2", type: "derived_from" as any, targetNoteId: "op-target" });
    const processIndex = makeProcessIndex([
      processEntry({ noteId: "op-from", crossNoteLinks: [link, other] }),
    ]);
    const result = collectCrossNoteReferencesTo(processIndex, "op-target");
    expect(result).toEqual([{ fromNoteId: "op-from", link }]);
  });
});

// ── buildPlanFlowGraph ──

function linearRows(names: [string, string][]): OperationRow[] {
  // names: [name, noteId][]
  return names.map(([name, noteId], i) => ({
    rowIndex: i + 1,
    tableBlockId: "t1",
    name,
    noteId,
    attrs: [],
    plannedFrom: [],
  }));
}

describe("buildPlanFlowGraph", () => {
  it("直線 3 工程: A の output を B が使い、B の output を C が使う", () => {
    const rows = linearRows([
      ["合成", "note-a"],
      ["焼成", "note-b"],
      ["洗浄", "note-c"],
    ]);
    const processIndex = makeProcessIndex([
      processEntry({
        noteId: "note-a",
        graph: {
          steps: [{ id: "step-a", name: "合成", params: [] }],
          entities: [{ id: "out-a", label: "粉末", kind: "output", rowIdentity: "row-a", attrs: [] }],
          edges: [{ id: "g1", kind: "generates", source: "step-a", target: "out-a" }],
        },
      }),
      processEntry({
        noteId: "note-b",
        graph: {
          steps: [{ id: "step-b", name: "焼成", params: [] }],
          entities: [{ id: "out-b", label: "焼成体", kind: "output", rowIdentity: "row-b", attrs: [] }],
          edges: [{ id: "g2", kind: "generates", source: "step-b", target: "out-b" }],
        },
        crossNoteLinks: [
          crossLink({
            id: "l-ab",
            targetNoteId: "note-a",
            targetBlockId: "step-a",
            targetEntityId: "row-a",
          }),
        ],
      }),
      processEntry({
        noteId: "note-c",
        graph: {
          steps: [{ id: "step-c", name: "洗浄", params: [] }],
          entities: [],
          edges: [],
        },
        crossNoteLinks: [
          crossLink({
            id: "l-bc",
            targetNoteId: "note-b",
            targetBlockId: "step-b",
            targetEntityId: "row-b",
          }),
        ],
      }),
    ]);
    const index = makeIndex([
      noteEntry({ noteId: "note-a" }),
      noteEntry({ noteId: "note-b" }),
      noteEntry({ noteId: "note-c" }),
    ]);

    const result = buildPlanFlowGraph({ rows, index, processIndex });
    expect(result.truncated).toBe(false);
    expect(result.brokenCount).toBe(0);
    expect(result.graph.steps.map((s) => s.id)).toEqual(["note:note-a", "note:note-b", "note:note-c"]);
    // A の output は B に、B の output は C に used される
    expect(result.graph.edges.filter((e) => e.kind === "used")).toHaveLength(2);
    expect(result.graph.edges.filter((e) => e.kind === "generates")).toHaveLength(2);
  });

  it("分岐: A の output を B・C の両方が使う", () => {
    const rows = linearRows([
      ["合成", "note-a"],
      ["評価1", "note-b"],
      ["評価2", "note-c"],
    ]);
    const aGraph: FlowGraphData = {
      steps: [{ id: "step-a", name: "合成", params: [] }],
      entities: [{ id: "out-a", label: "粉末", kind: "output", rowIdentity: "row-a", attrs: [] }],
      edges: [{ id: "g1", kind: "generates", source: "step-a", target: "out-a" }],
    };
    const refA = { targetNoteId: "note-a", targetBlockId: "step-a", targetEntityId: "row-a" };
    const processIndex = makeProcessIndex([
      processEntry({ noteId: "note-a", graph: aGraph }),
      processEntry({
        noteId: "note-b",
        graph: { steps: [{ id: "step-b", name: "評価1", params: [] }], entities: [], edges: [] },
        crossNoteLinks: [crossLink({ id: "l-ab", ...refA })],
      }),
      processEntry({
        noteId: "note-c",
        graph: { steps: [{ id: "step-c", name: "評価2", params: [] }], entities: [], edges: [] },
        crossNoteLinks: [crossLink({ id: "l-ac", ...refA })],
      }),
    ]);
    const index = makeIndex([
      noteEntry({ noteId: "note-a" }),
      noteEntry({ noteId: "note-b" }),
      noteEntry({ noteId: "note-c" }),
    ]);
    const result = buildPlanFlowGraph({ rows, index, processIndex });
    const usedEdges = result.graph.edges.filter((e) => e.kind === "used");
    expect(usedEdges).toHaveLength(2);
    expect(new Set(usedEdges.map((e) => e.target))).toEqual(new Set(["note:note-b", "note:note-c"]));
    // 同じ output entity を指す（分岐元は 1 つ）
    expect(new Set(usedEdges.map((e) => e.source)).size).toBe(1);
  });

  it("合流: B の output と C の output を D が両方使う", () => {
    const rows = linearRows([
      ["合成1", "note-b"],
      ["合成2", "note-c"],
      ["混合", "note-d"],
    ]);
    const graphOf = (stepId: string, name: string, outId: string, rowId: string): FlowGraphData => ({
      steps: [{ id: stepId, name, params: [] }],
      entities: [{ id: outId, label: name + "生成物", kind: "output", rowIdentity: rowId, attrs: [] }],
      edges: [{ id: `g-${stepId}`, kind: "generates", source: stepId, target: outId }],
    });
    const processIndex = makeProcessIndex([
      processEntry({ noteId: "note-b", graph: graphOf("step-b", "合成1", "out-b", "row-b") }),
      processEntry({ noteId: "note-c", graph: graphOf("step-c", "合成2", "out-c", "row-c") }),
      processEntry({
        noteId: "note-d",
        graph: { steps: [{ id: "step-d", name: "混合", params: [] }], entities: [], edges: [] },
        crossNoteLinks: [
          crossLink({ id: "l-bd", targetNoteId: "note-b", targetBlockId: "step-b", targetEntityId: "row-b" }),
          crossLink({ id: "l-cd", targetNoteId: "note-c", targetBlockId: "step-c", targetEntityId: "row-c" }),
        ],
      }),
    ]);
    const index = makeIndex([
      noteEntry({ noteId: "note-b" }),
      noteEntry({ noteId: "note-c" }),
      noteEntry({ noteId: "note-d" }),
    ]);
    const result = buildPlanFlowGraph({ rows, index, processIndex });
    const usedEdges = result.graph.edges.filter((e) => e.kind === "used");
    expect(usedEdges).toHaveLength(2);
    expect(usedEdges.every((e) => e.target === "note:note-d")).toBe(true);
  });

  it("未作成行は entity 無しの step だけ出す", () => {
    const rows: OperationRow[] = [
      { rowIndex: 1, tableBlockId: "t1", name: "未作成", noteId: null, attrs: [], state: "unlinked", plannedFrom: [] },
    ];
    const result = buildPlanFlowGraph({ rows, index: makeIndex([]), processIndex: null });
    expect(result.graph.steps).toEqual([
      {
        id: "row:t1:1",
        name: "未作成",
        params: [],
        noteRef: { noteId: null, tableBlockId: "t1", rowIndex: 1, state: "unlinked" },
      },
    ]);
    expect(result.graph.entities).toEqual([]);
    expect(result.graph.edges).toEqual([]);
  });

  it("broken: 解決できない cross-note 参照は broken の used エッジになり brokenCount が増える", () => {
    const rows = linearRows([
      ["合成", "note-a"],
      ["焼成", "note-b"],
    ]);
    const processIndex = makeProcessIndex([
      processEntry({ noteId: "note-a", graph: emptyGraph() }), // 参照先の行が消えている想定
      processEntry({
        noteId: "note-b",
        graph: { steps: [{ id: "step-b", name: "焼成", params: [] }], entities: [], edges: [] },
        crossNoteLinks: [
          crossLink({
            id: "l-broken",
            targetNoteId: "note-a",
            targetBlockId: "step-a",
            targetEntityId: "row-a",
            targetEntityLabel: "旧・粉末",
          }),
        ],
      }),
    ]);
    const index = makeIndex([noteEntry({ noteId: "note-a" }), noteEntry({ noteId: "note-b" })]);
    const result = buildPlanFlowGraph({ rows, index, processIndex });
    expect(result.brokenCount).toBe(1);
    const usedEdge = result.graph.edges.find((e) => e.kind === "used");
    expect(usedEdge?.broken).toBe(true);
    const brokenEntity = result.graph.entities.find((e) => e.id === usedEdge?.source);
    expect(brokenEntity?.label).toBe("旧・粉末");
  });

  it("計画外ノートへの cross-note 参照は出さない", () => {
    const rows = linearRows([["焼成", "note-b"]]);
    const processIndex = makeProcessIndex([
      processEntry({
        noteId: "note-b",
        graph: { steps: [{ id: "step-b", name: "焼成", params: [] }], entities: [], edges: [] },
        crossNoteLinks: [
          crossLink({
            id: "l-outside",
            targetNoteId: "note-outside", // この計画の工程行に無いノート
            targetBlockId: "step-x",
            targetEntityId: "row-x",
          }),
        ],
      }),
    ]);
    const index = makeIndex([noteEntry({ noteId: "note-b" })]);
    const result = buildPlanFlowGraph({ rows, index, processIndex });
    expect(result.brokenCount).toBe(0);
    expect(result.graph.edges).toEqual([]);
    expect(result.graph.entities).toEqual([]);
  });

  it("trashed/archived の工程ノートは工程チェーンを辿らない（entity 無しの step だけ）", () => {
    const rows: OperationRow[] = [
      { rowIndex: 1, tableBlockId: "t1", name: "合成", noteId: "note-a", attrs: [], state: "trashed", plannedFrom: [] },
      { rowIndex: 2, tableBlockId: "t1", name: "焼成", noteId: "note-b", attrs: [], state: "archived", plannedFrom: [] },
    ];
    const processIndex = makeProcessIndex([
      processEntry({ noteId: "note-a", graph: emptyGraph() }),
      processEntry({ noteId: "note-b", graph: emptyGraph() }),
    ]);
    const result = buildPlanFlowGraph({
      rows,
      index: makeIndex([]),
      processIndex,
    });
    expect(result.graph.entities).toEqual([]);
    expect(result.graph.edges).toEqual([]);
    expect(result.graph.steps.map((s) => s.noteRef?.state)).toEqual(["trashed", "archived"]);
  });

  it("2 段入れ子: 子の計画の、さらに子の output は、使われると入れ子の上の工程にぶら下がる", () => {
    // plan-1 の工程行 = note-mid（自身も計画、工程行 = note-leaf）と note-next。
    // 表示するのは実際に渡った output だけなので、note-leaf の output を note-next が
    // 使うことで初めて出る。出るときは入れ子の上の工程（note-mid）の下に付く
    const rows = linearRows([
      ["中間工程", "note-mid"],
      ["次工程", "note-next"],
    ]);
    const index = makeIndex([
      noteEntry({
        noteId: "note-mid",
        noteContexts: ["計画"],
        outgoingLinks: [{ targetNoteId: "note-leaf", layer: "knowledge" }],
      }),
      noteEntry({ noteId: "note-leaf" }),
      noteEntry({ noteId: "note-next" }),
    ]);
    const processIndex = makeProcessIndex([
      processEntry({
        noteId: "note-leaf",
        graph: {
          steps: [{ id: "step-leaf", name: "末端", params: [] }],
          entities: [{ id: "out-leaf", label: "最終物", kind: "output", rowIdentity: "row-leaf", attrs: [] }],
          edges: [{ id: "g-leaf", kind: "generates", source: "step-leaf", target: "out-leaf" }],
        },
      }),
      processEntry({
        noteId: "note-next",
        graph: { steps: [{ id: "step-next", name: "次", params: [] }], entities: [], edges: [] },
        crossNoteLinks: [
          crossLink({
            id: "l-leaf-next",
            targetNoteId: "note-leaf",
            targetBlockId: "step-leaf",
            targetEntityId: "row-leaf",
          }),
        ],
      }),
    ]);
    const result = buildPlanFlowGraph({ rows, index, processIndex });
    // 可視 step は note-mid と note-next（入れ子は 1 ノードに見える）
    expect(result.graph.steps.map((s) => s.id)).toEqual(["note:note-mid", "note:note-next"]);
    expect(result.graph.entities).toHaveLength(1);
    const generatesEdge = result.graph.edges.find((e) => e.kind === "generates");
    expect(generatesEdge?.source).toBe("note:note-mid");
    expect(generatesEdge?.target).toBe(result.graph.entities[0].id);
    const usedEdge = result.graph.edges.find((e) => e.kind === "used");
    expect(usedEdge?.source).toBe(result.graph.entities[0].id);
    expect(usedEdge?.target).toBe("note:note-next");
  });

  it("ダイヤモンド入れ子: 2 つの工程行が同じ末端ノートを子に持つとき、使われた output は両方に出る", () => {
    // plan-1 の工程行 = mid1, mid2（どちらも計画、工程行 = note-leaf）と note-next。
    // mid1 の expand が先に note-leaf を訪問しても、mid2 側の output が黙って消えては
    // いけない（rows 間で visited を共有しないことの回帰テスト）。entity は owner ごとに別ノード
    const rows = linearRows([
      ["中間1", "note-mid1"],
      ["中間2", "note-mid2"],
      ["次工程", "note-next"],
    ]);
    const index = makeIndex([
      noteEntry({
        noteId: "note-mid1",
        noteContexts: ["計画"],
        outgoingLinks: [{ targetNoteId: "note-leaf", layer: "knowledge" }],
      }),
      noteEntry({
        noteId: "note-mid2",
        noteContexts: ["計画"],
        outgoingLinks: [{ targetNoteId: "note-leaf", layer: "knowledge" }],
      }),
      noteEntry({ noteId: "note-leaf" }),
      noteEntry({ noteId: "note-next" }),
    ]);
    const processIndex = makeProcessIndex([
      processEntry({
        noteId: "note-leaf",
        graph: {
          steps: [{ id: "step-leaf", name: "末端", params: [] }],
          entities: [{ id: "out-leaf", label: "最終物", kind: "output", rowIdentity: "row-leaf", attrs: [] }],
          edges: [{ id: "g-leaf", kind: "generates", source: "step-leaf", target: "out-leaf" }],
        },
      }),
      processEntry({
        noteId: "note-next",
        graph: { steps: [{ id: "step-next", name: "次", params: [] }], entities: [], edges: [] },
        crossNoteLinks: [
          crossLink({
            id: "l-leaf-next",
            targetNoteId: "note-leaf",
            targetBlockId: "step-leaf",
            targetEntityId: "row-leaf",
          }),
        ],
      }),
    ]);
    const result = buildPlanFlowGraph({ rows, index, processIndex });
    expect(result.truncated).toBe(false);
    expect(result.graph.steps.map((s) => s.id)).toEqual(["note:note-mid1", "note:note-mid2", "note:note-next"]);
    // mid1・mid2 それぞれの下に output が 1 つずつ（計 2 件）出る
    expect(result.graph.entities).toHaveLength(2);
    const generatesEdges = result.graph.edges.filter((e) => e.kind === "generates");
    expect(generatesEdges.map((e) => e.source).sort()).toEqual(["note:note-mid1", "note:note-mid2"]);
  });

  it("どの工程にも使われていない output は出さない（計画の最終成果物も例外にしない）", () => {
    // A の output を B が使う。B の output はどこにも使われない（計画の最終成果物）。
    // 出したままだと、ポートを掴めるのに引くと生成元の工程からの予定線ができるずれが生まれる
    const rows = linearRows([
      ["合成", "note-a"],
      ["焼成", "note-b"],
    ]);
    const processIndex = makeProcessIndex([
      processEntry({
        noteId: "note-a",
        graph: {
          steps: [{ id: "step-a", name: "合成", params: [] }],
          entities: [{ id: "out-a", label: "粉末", kind: "output", rowIdentity: "row-a", attrs: [] }],
          edges: [{ id: "g-a", kind: "generates", source: "step-a", target: "out-a" }],
        },
      }),
      processEntry({
        noteId: "note-b",
        graph: {
          steps: [{ id: "step-b", name: "焼成", params: [] }],
          entities: [{ id: "out-b", label: "焼成体", kind: "output", rowIdentity: "row-b", attrs: [] }],
          edges: [{ id: "g-b", kind: "generates", source: "step-b", target: "out-b" }],
        },
        crossNoteLinks: [
          crossLink({ id: "l-ab", targetNoteId: "note-a", targetBlockId: "step-a", targetEntityId: "row-a" }),
        ],
      }),
    ]);
    const index = makeIndex([noteEntry({ noteId: "note-a" }), noteEntry({ noteId: "note-b" })]);
    const result = buildPlanFlowGraph({ rows, index, processIndex });
    // 渡った「粉末」だけが出て、最終成果物の「焼成体」は出ない
    expect(result.graph.entities.map((e) => e.label)).toEqual(["粉末"]);
    const generatesEdges = result.graph.edges.filter((e) => e.kind === "generates");
    expect(generatesEdges).toHaveLength(1);
    expect(generatesEdges[0].source).toBe("note:note-a");
    // 誰にも使われない output が 1 つも無い計画でも、used / planned の判定には影響しない
    expect(result.graph.edges.filter((e) => e.kind === "used")).toHaveLength(1);
  });

  it("循環（A の工程 B が A を工程に持つ）で停止する", () => {
    const rows = linearRows([["工程B", "note-b"]]);
    const index = makeIndex([
      noteEntry({
        noteId: "note-b",
        noteContexts: ["計画"],
        outgoingLinks: [{ targetNoteId: "note-a", layer: "knowledge" }],
      }),
      noteEntry({
        noteId: "note-a",
        noteContexts: ["計画"],
        outgoingLinks: [{ targetNoteId: "note-b", layer: "knowledge" }],
      }),
    ]);
    const result = buildPlanFlowGraph({ rows, index, processIndex: null });
    // 無限ループせず終了し、truncated は立たない（循環は visited で止まる）
    expect(result.truncated).toBe(false);
    expect(result.graph.steps).toHaveLength(1);
  });

  it("深さ上限を超えたら打ち切って truncated を返す", () => {
    // note-0 → note-1 → … → note-10（すべて計画ノート）という鎖。
    // PLAN_FLOW_MAX_DEPTH(8) を超える深さになる。
    const chainLength = PLAN_FLOW_MAX_DEPTH + 3;
    const notes: NoteIndexEntry[] = [];
    for (let i = 0; i < chainLength; i++) {
      const isLast = i === chainLength - 1;
      notes.push(
        noteEntry({
          noteId: `note-${i}`,
          noteContexts: isLast ? undefined : ["計画"],
          outgoingLinks: isLast ? [] : [{ targetNoteId: `note-${i + 1}`, layer: "knowledge" }],
        }),
      );
    }
    const index = makeIndex(notes);
    const rows = linearRows([["起点", "note-0"]]);
    const result = buildPlanFlowGraph({ rows, index, processIndex: null });
    expect(result.truncated).toBe(true);
  });
});

// ── parsePlannedInputs / formatPlannedInputs ──

describe("parsePlannedInputs", () => {
  it("「、」「,」「，」「;」「\\n」のいずれでも分割する", () => {
    expect(parsePlannedInputs("合成、焼成,洗浄，乾燥;検品\n出荷")).toEqual([
      "合成",
      "焼成",
      "洗浄",
      "乾燥",
      "検品",
      "出荷",
    ]);
  });

  it("各名前を trim し、先頭 @ を外す", () => {
    expect(parsePlannedInputs("@合成、 焼成 ")).toEqual(["合成", "焼成"]);
  });

  it("大文字小文字を区別せず重複を除く（先に出た表記を残す）", () => {
    expect(parsePlannedInputs("合成、GO、go、合成")).toEqual(["合成", "GO"]);
  });

  it("空セルは空配列", () => {
    expect(parsePlannedInputs("")).toEqual([]);
    expect(parsePlannedInputs("   ")).toEqual([]);
  });
});

describe("formatPlannedInputs", () => {
  it("PLANNED_INPUT_SEPARATOR で結合する", () => {
    expect(formatPlannedInputs(["合成", "焼成"])).toBe(`合成${PLANNED_INPUT_SEPARATOR}焼成`);
  });

  it("空配列は空文字", () => {
    expect(formatPlannedInputs([])).toBe("");
  });
});

// ── resolvePlannedRow ──

function planRow(overrides: Partial<OperationRow> & { name: string; noteId: string | null; rowIndex: number }): OperationRow {
  return {
    tableBlockId: "t1",
    attrs: [],
    plannedFrom: [],
    ...overrides,
  };
}

describe("resolvePlannedRow", () => {
  const rows: OperationRow[] = [
    planRow({ rowIndex: 1, name: "合成", noteId: "note-a" }),
    planRow({ rowIndex: 2, name: "@焼成", noteId: "note-b" }),
  ];

  it("先頭 @ を外し trim・小文字で行名と一致させる", () => {
    expect(resolvePlannedRow(rows, "合成")?.noteId).toBe("note-a");
    expect(resolvePlannedRow(rows, "@合成")?.noteId).toBe("note-a");
    expect(resolvePlannedRow(rows, "焼成")?.noteId).toBe("note-b"); // 行側が @ 付きでも一致
    expect(resolvePlannedRow(rows, "ゴウセイ")).toBeNull();
  });

  it("同名の行は先勝ち", () => {
    const dup: OperationRow[] = [
      planRow({ rowIndex: 1, name: "合成", noteId: "note-first" }),
      planRow({ rowIndex: 2, name: "合成", noteId: "note-second" }),
    ];
    expect(resolvePlannedRow(dup, "合成")?.noteId).toBe("note-first");
  });
});

// ── wouldCreatePlannedCycle ──

describe("wouldCreatePlannedCycle", () => {
  it("自己参照は常に true", () => {
    const rows: OperationRow[] = [planRow({ rowIndex: 1, name: "合成", noteId: "note-a" })];
    expect(wouldCreatePlannedCycle(rows, "合成", "合成")).toBe(true);
  });

  it("直接循環（B の入力元が A、A の入力元に B を足そうとする）は true", () => {
    const rows: OperationRow[] = [
      planRow({ rowIndex: 1, name: "A", noteId: "note-a" }),
      planRow({ rowIndex: 2, name: "B", noteId: "note-b", plannedFrom: ["A"] }),
    ];
    expect(wouldCreatePlannedCycle(rows, "B", "A")).toBe(true);
  });

  it("間接循環（A→B→C のとき C→A を足そうとする）は true", () => {
    const rows: OperationRow[] = [
      planRow({ rowIndex: 1, name: "A", noteId: "note-a" }),
      planRow({ rowIndex: 2, name: "B", noteId: "note-b", plannedFrom: ["A"] }),
      planRow({ rowIndex: 3, name: "C", noteId: "note-c", plannedFrom: ["B"] }),
    ];
    expect(wouldCreatePlannedCycle(rows, "C", "A")).toBe(true);
  });

  it("循環にならない組み合わせは false", () => {
    const rows: OperationRow[] = [
      planRow({ rowIndex: 1, name: "A", noteId: "note-a" }),
      planRow({ rowIndex: 2, name: "B", noteId: "note-b", plannedFrom: ["A"] }),
      planRow({ rowIndex: 3, name: "C", noteId: "note-c" }),
    ];
    expect(wouldCreatePlannedCycle(rows, "A", "C")).toBe(false);
  });
});

// ── buildPlanFlowGraph: 予定の線（planned-input） ──

describe("buildPlanFlowGraph 予定の線", () => {
  it("予定だけ（実績が無い計画）: 予定の線が引かれる", () => {
    const rows: OperationRow[] = [
      planRow({ rowIndex: 1, name: "合成", noteId: "note-a" }),
      planRow({ rowIndex: 2, name: "焼成", noteId: "note-b", plannedFrom: ["合成"] }),
    ];
    const result = buildPlanFlowGraph({ rows, index: makeIndex([]), processIndex: null });
    expect(result.unresolvedPlanned).toEqual([]);
    const plannedEdges = result.graph.edges.filter((e) => e.kind === "planned");
    expect(plannedEdges).toHaveLength(1);
    expect(plannedEdges[0]).toMatchObject({
      id: "planned:note:note-a:note:note-b",
      source: "note:note-a",
      target: "note:note-b",
    });
  });

  it("予定と実績が一致 → used エッジが asPlanned になり、予定の線は出ない", () => {
    const rows: OperationRow[] = [
      planRow({ rowIndex: 1, name: "合成", noteId: "note-a" }),
      planRow({ rowIndex: 2, name: "焼成", noteId: "note-b", plannedFrom: ["合成"] }),
    ];
    const processIndex = makeProcessIndex([
      processEntry({
        noteId: "note-a",
        graph: {
          steps: [{ id: "step-a", name: "合成", params: [] }],
          entities: [{ id: "out-a", label: "粉末", kind: "output", rowIdentity: "row-a", attrs: [] }],
          edges: [{ id: "g1", kind: "generates", source: "step-a", target: "out-a" }],
        },
      }),
      processEntry({
        noteId: "note-b",
        graph: { steps: [{ id: "step-b", name: "焼成", params: [] }], entities: [], edges: [] },
        crossNoteLinks: [
          crossLink({ id: "l-ab", targetNoteId: "note-a", targetBlockId: "step-a", targetEntityId: "row-a" }),
        ],
      }),
    ]);
    const index = makeIndex([noteEntry({ noteId: "note-a" }), noteEntry({ noteId: "note-b" })]);
    const result = buildPlanFlowGraph({ rows, index, processIndex });
    const usedEdge = result.graph.edges.find((e) => e.kind === "used")!;
    expect(usedEdge.plan).toBe("asPlanned");
    expect(result.graph.edges.filter((e) => e.kind === "planned")).toHaveLength(0);
  });

  it("予定あり計画で予定に無い実績 → unplanned が付く", () => {
    const rows: OperationRow[] = [
      planRow({ rowIndex: 1, name: "合成", noteId: "note-a" }),
      planRow({ rowIndex: 2, name: "焼成", noteId: "note-b" }), // 入力元は書いていない（計画外の実績）
      planRow({ rowIndex: 3, name: "別工程", noteId: "note-d" }),
      planRow({ rowIndex: 4, name: "検品", noteId: "note-c", plannedFrom: ["別工程"] }), // 計画自体は存在する
    ];
    const processIndex = makeProcessIndex([
      processEntry({
        noteId: "note-a",
        graph: {
          steps: [{ id: "step-a", name: "合成", params: [] }],
          entities: [{ id: "out-a", label: "粉末", kind: "output", rowIdentity: "row-a", attrs: [] }],
          edges: [{ id: "g1", kind: "generates", source: "step-a", target: "out-a" }],
        },
      }),
      processEntry({
        noteId: "note-b",
        graph: { steps: [{ id: "step-b", name: "焼成", params: [] }], entities: [], edges: [] },
        crossNoteLinks: [
          crossLink({ id: "l-ab", targetNoteId: "note-a", targetBlockId: "step-a", targetEntityId: "row-a" }),
        ],
      }),
    ]);
    const index = makeIndex([
      noteEntry({ noteId: "note-a" }),
      noteEntry({ noteId: "note-b" }),
      noteEntry({ noteId: "note-c" }),
      noteEntry({ noteId: "note-d" }),
    ]);
    const result = buildPlanFlowGraph({ rows, index, processIndex });
    const usedEdgeAB = result.graph.edges.find((e) => e.kind === "used" && e.target === "note:note-b")!;
    expect(usedEdgeAB.plan).toBe("unplanned");
    // 予定はあったが実績が無い（別工程→検品）は planned の線として残る
    expect(
      result.graph.edges.some(
        (e) => e.kind === "planned" && e.source === "note:note-d" && e.target === "note:note-c",
      ),
    ).toBe(true);
  });

  it("予定 0 本なら used エッジに plan を一切付けない", () => {
    const rows: OperationRow[] = [
      planRow({ rowIndex: 1, name: "合成", noteId: "note-a" }),
      planRow({ rowIndex: 2, name: "焼成", noteId: "note-b" }),
    ];
    const processIndex = makeProcessIndex([
      processEntry({
        noteId: "note-a",
        graph: {
          steps: [{ id: "step-a", name: "合成", params: [] }],
          entities: [{ id: "out-a", label: "粉末", kind: "output", rowIdentity: "row-a", attrs: [] }],
          edges: [{ id: "g1", kind: "generates", source: "step-a", target: "out-a" }],
        },
      }),
      processEntry({
        noteId: "note-b",
        graph: { steps: [{ id: "step-b", name: "焼成", params: [] }], entities: [], edges: [] },
        crossNoteLinks: [
          crossLink({ id: "l-ab", targetNoteId: "note-a", targetBlockId: "step-a", targetEntityId: "row-a" }),
        ],
      }),
    ]);
    const index = makeIndex([noteEntry({ noteId: "note-a" }), noteEntry({ noteId: "note-b" })]);
    const result = buildPlanFlowGraph({ rows, index, processIndex });
    const usedEdge = result.graph.edges.find((e) => e.kind === "used")!;
    expect(usedEdge.plan).toBeUndefined();
    expect(result.graph.edges.filter((e) => e.kind === "planned")).toHaveLength(0);
  });

  it("解決できない入力元名は unresolvedPlanned に積んで無視する", () => {
    const rows: OperationRow[] = [
      planRow({ rowIndex: 1, name: "確認", noteId: "note-c", plannedFrom: ["存在しない工程"] }),
    ];
    const result = buildPlanFlowGraph({ rows, index: makeIndex([]), processIndex: null });
    expect(result.unresolvedPlanned).toEqual([{ rowName: "確認", name: "存在しない工程" }]);
    expect(result.graph.edges.filter((e) => e.kind === "planned")).toHaveLength(0);
  });

  it("未作成行（noteId null）も予定の線の端点になれる", () => {
    const rows: OperationRow[] = [
      planRow({ rowIndex: 1, name: "合成", noteId: null }),
      planRow({ rowIndex: 2, name: "焼成", noteId: "note-b", plannedFrom: ["合成"] }),
    ];
    const result = buildPlanFlowGraph({ rows, index: makeIndex([]), processIndex: null });
    const plannedEdges = result.graph.edges.filter((e) => e.kind === "planned");
    expect(plannedEdges).toHaveLength(1);
    expect(plannedEdges[0]).toMatchObject({ source: "row:t1:1", target: "note:note-b" });
  });
});

describe("collectOperationRowsFromBlocks", () => {
  it("collectOperationRows と同じ結果になる（doc から取り出した blocks/tableMeta を渡すだけ）", () => {
    const blocks = [
      tableBlock("t1", [
        ["工程", "条件"],
        ["合成", "800C"],
      ]),
    ];
    const tableMeta = { t1: { noteLinks: { 合成: "note-a" }, columns: { 工程: ["note-link"] } } } as any;

    const fromBlocks = collectOperationRowsFromBlocks(blocks, tableMeta);
    const fromDoc = collectOperationRows(makeDoc({ blocks, tableMeta }));
    expect(fromBlocks).toEqual(fromDoc);
  });

  it("tableMeta が undefined でも落ちない（空扱い）", () => {
    const blocks = [tableBlock("t1", [["工程"], ["合成"]])];
    expect(collectOperationRowsFromBlocks(blocks, undefined)).toEqual([]);
  });
});

describe("nextDefaultOperationName", () => {
  // t() は現在のロケール（既定は英語）に依存するため、期待値も t() で作る
  const name = (n: number) => t("planFlow.defaultOperationName", { n: String(n) });

  it("空の表なら 1 番から", () => {
    expect(nextDefaultOperationName([])).toBe(name(1));
  });

  it("既存の行数 + 1 番から", () => {
    expect(nextDefaultOperationName([name(1), name(2)])).toBe(name(3));
  });

  it("同名が既にあれば番号を進める（デフォルト名の行が既に使われている場合）", () => {
    // 行数 + 1 = 2 番だが、既に「n 番」の行があるので衝突を避けて 3 番へ進む
    expect(nextDefaultOperationName(["合成", name(2)])).toBe(name(3));
  });

  it("@ 付き・大文字小文字混在でも正規化して同名判定する", () => {
    expect(nextDefaultOperationName([`@${name(1)}`])).toBe(name(2));
  });
});
