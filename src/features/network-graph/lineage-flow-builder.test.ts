// 来歴の「図」: 段ごとの図の組み立てテスト（パン作りの世界観）
import { describe, expect, it } from "vitest";
import { buildLevelFlow, buildProcedureFlow, planHasOperation } from "./lineage-flow-builder";
import { buildPlanFlowGraph, collectOperationRows } from "./plan-flow";
import { planFlowScope, procedureFlowScope, provFlowScope } from "./graph-layout";
import type { LineageStackModel, StackNode } from "./lineage-stack-model";
import type { GraphiumDocument } from "../../lib/document-types";
import type { GraphiumIndex } from "../navigation/index-file";
import type { ProcessIndex, ProcessIndexEntry } from "./process-index";

const cell = (text: string) => [{ type: "text", text, styles: {} }];

function table(id: string, rows: string[][]) {
  return { id, type: "table", content: { type: "tableContent", rows: rows.map((cells) => ({ cells: cells.map(cell) })) } };
}

function doc(title: string, extra: Partial<GraphiumDocument> = {}, blocks: unknown[] = []): GraphiumDocument {
  return {
    version: 2,
    title,
    pages: [{ id: "p1", title: "Main", blocks, labels: {}, provLinks: [], knowledgeLinks: [], tableMeta: {} }],
    createdAt: "2026-09-01T00:00:00.000Z",
    modifiedAt: "2026-09-01T00:00:00.000Z",
    ...extra,
  } as unknown as GraphiumDocument;
}

function planDoc(): GraphiumDocument {
  const d = doc("春のカンパーニュ試作", {}, [
    table("t1", [
      ["工程", "入力元"],
      ["生地", ""],
      ["焼成", "生地"],
    ]),
  ]);
  (d.pages[0] as unknown as { tableMeta: unknown }).tableMeta = {
    t1: {
      noteLinks: { 生地: "dough", 焼成: "bake" },
      columns: { 工程: ["note-link"], 入力元: ["planned-input"] },
      edgeLabels: { 焼成: { 生地: "生地" } },
    },
  };
  return d;
}

const index: GraphiumIndex = {
  version: 32,
  updatedAt: "2026-09-01T00:00:00.000Z",
  notes: ["plan", "dough", "bake", "tasting"].map((noteId) => ({
    noteId,
    noteContexts: noteId === "plan" ? ["計画"] : undefined,
    title: noteId,
    modifiedAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    headings: [],
    labels: [],
    outgoingLinks: [],
  })),
} as unknown as GraphiumIndex;

const node = (id: string, patch: Partial<StackNode> = {}): StackNode => ({
  id,
  title: id,
  kind: "text",
  groups: [],
  links: [],
  ...patch,
});

function stack(nodes: StackNode[]): LineageStackModel {
  return { nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), rootId: nodes[0].id, initialPath: [nodes[0].id] };
}

const labels = {
  derivedBand: "派生したノート",
  wholeNote: "ノート全体",
  bandMore: (label: string, count: number) => `${label}（他 ${count} 件）`,
};

function procEntry(noteId: string, stepIds: string[]): ProcessIndexEntry {
  return {
    noteId,
    title: noteId,
    sourceModifiedAt: "2026-09-01T00:00:00.000Z",
    projectedAt: "2026-09-01T00:00:00.000Z",
    graph: {
      steps: stepIds.map((id) => ({ id, name: `手順 ${id}`, params: [] })),
      entities: [],
      edges: [],
    },
    summary: {},
  } as unknown as ProcessIndexEntry;
}

const pIndex = (entries: ProcessIndexEntry[]): ProcessIndex => ({ version: 1, updatedAt: "", processes: entries });

const base = (s: LineageStackModel) => ({
  nodeId: "",
  stack: s,
  docs: new Map<string, GraphiumDocument>(),
  index: null as GraphiumIndex | null,
  processIndex: null as ProcessIndex | null,
  labels,
});

describe("buildLevelFlow", () => {
  it("計画ノートは工程グラフと同じ steps / edges（線の名前・予定の線）で、配置は planFlowScope", () => {
    const d = planDoc();
    const s = stack([
      node("plan", { kind: "plan", groups: [{ key: "notes", label: "ノート", children: ["dough", "bake", "tasting"] }] }),
      node("dough"),
      node("bake"),
      node("tasting"),
    ]);
    const res = buildLevelFlow({ nodeId: "plan", stack: s, docs: new Map([["plan", d]]), index, processIndex: null, labels });
    expect(res.kind).toBe("plan");
    if (res.kind !== "plan") return;
    const expected = buildPlanFlowGraph({ rows: collectOperationRows(d, index), index, processIndex: null }).graph;
    expect(res.graph.edges).toEqual(expected.edges);
    expect(res.graph.edges.some((e) => e.kind === "planned" && e.userLabel === "生地")).toBe(true);
    expect(res.graph.steps.slice(0, expected.steps.length)).toEqual(expected.steps);
    expect(res.layoutScope).toBe(planFlowScope("plan"));
    // 表の行に無い派生ノートは「派生したノート」の帯に入る（線は無し）
    const extra = res.graph.steps.slice(expected.steps.length);
    expect(extra.map((x) => x.id)).toEqual(["note:tasting"]);
    expect(extra[0].group).toEqual({ id: "lineage-derived", label: "派生したノート", index: 999 });
    expect(res.graph.edges.length).toBe(expected.edges.length);
  });

  it("手順のあるノートは手順の図で、派生元の手順から出る子には derived 辺、他は箱の帯", () => {
    const s = stack([
      node("dough", {
        kind: "proc",
        groups: [
          { key: "h1", label: "一次発酵", children: ["rerun"] },
          { key: "notes", label: "ノート", children: ["memo"] },
        ],
      }),
      node("rerun", { title: "生地 A（再現）" }),
      node("memo", { title: "試食メモ" }),
    ]);
    const docs = new Map([
      ["dough", doc("生地 A")],
      ["rerun", doc("生地 A（再現）", { derivedFromBlockId: "s-ferment" })],
      ["memo", doc("試食メモ")],
    ]);
    const res = buildLevelFlow({
      nodeId: "dough",
      stack: s,
      docs,
      index: null,
      processIndex: pIndex([procEntry("dough", ["s-knead", "s-ferment"])]),
      labels,
    });
    expect(res.kind).toBe("note");
    if (res.kind !== "note") return;
    expect(res.layoutScope).toBe(provFlowScope("dough"));
    expect(res.graph.edges).toContainEqual(
      expect.objectContaining({ kind: "derived", source: "s-ferment", target: "note:rerun" }),
    );
    const memo = res.graph.steps.find((x) => x.id === "note:memo");
    expect(memo?.group).toEqual({ id: "lineage-box:notes", label: "ノート", index: 101 });
    expect(res.graph.steps.find((x) => x.id === "note:rerun")?.group).toBeUndefined();
  });

  it("子だけのノートは箱ごとの帯で、同じ段の受け渡しは used の辺", () => {
    const s = stack([
      node("root1", {
        groups: [
          { key: "h1", label: "生地", children: ["a", "b"] },
          { key: "h2", label: "焼成", children: ["c"] },
        ],
        links: [{ from: "a", to: "c" }],
      }),
      node("a"),
      node("b"),
      node("c"),
    ]);
    const res = buildLevelFlow({
      nodeId: "root1",
      stack: s,
      docs: new Map([["root1", doc("春の仕込み")]]),
      index: null,
      processIndex: null,
      labels,
    });
    expect(res.kind).toBe("children");
    if (res.kind !== "children") return;
    expect(res.layoutScope).toBe(provFlowScope("root1"));
    expect(res.graph.steps.map((x) => [x.id, x.group?.id, x.group?.index])).toEqual([
      ["note:a", "lineage-box:h1", 100],
      ["note:b", "lineage-box:h1", 100],
      ["note:c", "lineage-box:h2", 101],
    ]);
    expect(res.graph.edges).toEqual([
      { id: "lineage-used:a->c", kind: "used", source: "note:a", target: "note:c" },
    ]);
  });

  it("知識の段も子を帯に並べた図になり、配置は保存しない（layoutScope が null）", () => {
    const s = stack([
      node("k", { kind: "knowledge", groups: [{ key: "notes", label: "ノート", children: ["z"] }] }),
      node("z"),
    ]);
    const res = buildLevelFlow({ ...base(s), nodeId: "k" });
    expect(res.kind).toBe("children");
    if (res.kind !== "children") return;
    expect(res.layoutScope).toBeNull();
    expect(res.graph.steps.map((x) => x.id)).toEqual(["note:z"]);
  });

  it("子が無い段は none", () => {
    const s = stack([node("empty"), node("k", { kind: "knowledge" })]);
    expect(buildLevelFlow({ ...base(s), nodeId: "empty" }).kind).toBe("none");
    expect(buildLevelFlow({ ...base(s), nodeId: "k" }).kind).toBe("none");
  });

  it("計画フォルダのノートでなければ、表の行があっても計画の図にしない", () => {
    const d = planDoc();
    const s = stack([node("dough", { groups: [{ key: "notes", label: "ノート", children: ["bake"] }] }), node("bake")]);
    const res = buildLevelFlow({ ...base(s), nodeId: "dough", docs: new Map([["dough", d]]), index });
    expect(res.kind).toBe("children");
  });

  it("未作成の行・開けないノートの行は読み取り専用の noteRef になる", () => {
    const d = planDoc();
    const s = stack([node("plan", { kind: "plan" }), node("dough")]);
    const res = buildLevelFlow({ ...base(s), nodeId: "plan", docs: new Map([["plan", d]]), index });
    expect(res.kind).toBe("plan");
    if (res.kind !== "plan") return;
    // dough は stack にある（開ける）、bake は stack にも docs にも無い（読み取り専用）
    const byName = (n: string) => res.graph.steps.find((x) => x.name === n)?.noteRef;
    expect(byName("生地")?.readOnly).toBeUndefined();
    expect(byName("焼成")?.readOnly).toBe(true);
  });

  it("上限で省いた子（hidden）も並べ、60 件を超えたら帯のラベルに他 N 件を出す", () => {
    const ids = Array.from({ length: 70 }, (_, i) => `c${i}`);
    const s = stack([
      node("root1", {
        groups: [
          {
            key: "h1",
            label: "生地",
            children: ids.slice(0, 20),
            more: 50,
            hidden: ids.slice(20).map((id) => ({ id, title: id, kind: "text" as const })),
          },
        ],
      }),
      ...ids.slice(0, 20).map((id) => node(id)),
    ]);
    const res = buildLevelFlow({ ...base(s), nodeId: "root1" });
    expect(res.kind).toBe("children");
    if (res.kind !== "children") return;
    expect(res.graph.steps).toHaveLength(60);
    expect(res.graph.steps[0].group?.label).toBe("生地（他 10 件）");
    expect(res.graph.steps.some((x) => x.id === "note:c30")).toBe(true);
  });
});

describe("buildProcedureFlow（手順の全体）", () => {
  // 計画: 生地 → 焼成（実際に受け渡す）→ 試食（受け渡しは未記録。入力元に焼成）
  function procPlan(): GraphiumDocument {
    const d = doc("春のカンパーニュ試作", {}, [
      table("t1", [
        ["工程", "入力元"],
        ["生地", ""],
        ["焼成", "生地"],
        ["試食", "焼成、生地"],
      ]),
    ]);
    (d.pages[0] as unknown as { tableMeta: unknown }).tableMeta = {
      t1: {
        noteLinks: { 生地: "dough", 焼成: "bake", 試食: "tasting" },
        columns: { 工程: ["note-link"], 入力元: ["planned-input"] },
        edgeLabels: { 試食: { 焼成: "パン" } },
      },
    };
    return d;
  }

  const doughEntry = (): ProcessIndexEntry =>
    ({
      ...procEntry("dough", []),
      graph: {
        steps: [
          { id: "d1", name: "計量", params: [] },
          { id: "d2", name: "こねる", params: [] },
          { id: "ext", name: "外部", params: [], externalOrigin: { noteId: "x", noteTitle: "x", stepId: "x", stepTitle: "x", outputLabel: "x", broken: false } },
        ],
        entities: [
          { id: "m1", label: "強力粉", kind: "material", attrs: [] },
          { id: "o1", label: "生地", kind: "output", attrs: [], entityId: "ent-dough", rowIdentity: "row-dough" },
        ],
        edges: [
          { id: "u1", kind: "used", source: "m1", target: "d1" },
          { id: "n1", kind: "orderOnly", source: "d1", target: "d2" },
          { id: "g1", kind: "generates", source: "d2", target: "o1" },
          { id: "x1", kind: "external", source: "ext", target: "d1" },
        ],
      },
    }) as unknown as ProcessIndexEntry;

  const bakeEntry = (): ProcessIndexEntry =>
    ({
      ...procEntry("bake", []),
      graph: {
        steps: [
          { id: "b1", name: "成形", params: [] },
          { id: "b2", name: "焼く", params: [] },
        ],
        entities: [
          { id: "m2", label: "生地", kind: "material", attrs: [], rowIdentity: "row-recv" },
          { id: "o2", label: "パン", kind: "output", attrs: [], rowIdentity: "row-bread" },
        ],
        edges: [
          { id: "u2", kind: "used", source: "m2", target: "b1" },
          { id: "n2", kind: "orderOnly", source: "b1", target: "b2" },
          { id: "g2", kind: "generates", source: "b2", target: "o2" },
        ],
      },
      crossNoteLinks: [
        {
          type: "informed_by",
          sourceBlockId: "b1",
          sourceEntityId: "row-recv",
          targetNoteId: "dough",
          targetBlockId: "d2",
          targetEntityId: "row-dough",
          targetEntityStable: true,
        },
      ],
    }) as unknown as ProcessIndexEntry;

  const procStack = () =>
    stack([
      node("plan", { kind: "plan", groups: [{ key: "n", label: "ノート", children: ["dough", "bake", "tasting"] }] }),
      node("dough", { kind: "proc", groups: [{ key: "d", label: "派生", children: ["rye"] }] }),
      node("bake", { kind: "proc" }),
      node("tasting", { kind: "text" }),
      node("rye", { title: "ライ麦の生地" }),
    ]);

  function build(over: Partial<Parameters<typeof buildProcedureFlow>[0]> = {}) {
    const docs = new Map<string, GraphiumDocument>([
      ["plan", procPlan()],
      ["rye", doc("ライ麦の生地", { derivedFromBlockId: "d2" })],
    ]);
    return buildProcedureFlow({
      planId: "plan",
      docs,
      index,
      processIndex: pIndex([doughEntry(), bakeEntry()]),
      stack: procStack(),
      focusOperationId: "bake",
      currentId: null,
      labels: { derivedBand: "派生したノート", noSteps: "手順はまだありません", here: "現在地" },
      ...over,
    });
  }

  it("工程ごとの帯に、接頭辞付き id の手順・材料・出力が入る（entity にも group。外部由来の step は除く）", () => {
    const f = build();
    expect(f.kind).toBe("procedure");
    expect(f.layoutScope).toBe(procedureFlowScope("plan"));
    expect(f.operationIds).toEqual(["dough", "bake", "tasting"]);
    const ids = f.graph.steps.map((s) => s.id);
    expect(ids).toContain("dough::d1");
    expect(ids).toContain("bake::b2");
    expect(ids).not.toContain("dough::ext");
    expect(f.graph.steps.find((s) => s.id === "dough::d1")?.group).toMatchObject({ id: "dough", label: "生地", index: 0 });
    expect(f.graph.steps.find((s) => s.id === "bake::b1")?.group).toMatchObject({ id: "bake", index: 1 });
    const ent = f.graph.entities.find((e) => e.id === "dough::o1");
    expect(ent?.group?.id).toBe("dough");
    // 辺も同じ接頭辞。外部由来の辺は落ちる
    expect(f.graph.edges.find((e) => e.id === "dough::n1")).toMatchObject({ source: "dough::d1", target: "dough::d2" });
    expect(f.graph.edges.some((e) => e.id === "dough::x1")).toBe(false);
  });

  it("工程をまたぐ実際の受け渡しは、出力から受け取り先の材料への used の辺", () => {
    const f = build();
    const e = f.graph.edges.find((x) => x.id === "procedure-used:dough::o1->bake::m2");
    expect(e).toMatchObject({ kind: "used", source: "dough::o1", target: "bake::m2" });
  });

  it("予定の線は受け渡しの無い組だけ（線の名前付き）。受け渡しのある 生地→焼成 には出さない", () => {
    const f = build();
    const planned = f.graph.edges.filter((e) => e.kind === "planned");
    // 焼成→試食 と 生地→試食（どちらも受け渡しなし）。生地→焼成 は無い
    expect(planned.map((e) => e.id).sort()).toEqual(["procedure-planned:bake->tasting", "procedure-planned:dough->tasting"]);
    const bt = planned.find((e) => e.id === "procedure-planned:bake->tasting")!;
    expect(bt.userLabel).toBe("パン");
    // 焼成の最後の手順 → 試食の noteRef（手順の無い工程）
    expect(bt.source).toBe("bake::b2");
    expect(bt.target).toBe("tasting::note:tasting");
    expect(planned.find((e) => e.id === "procedure-planned:dough->tasting")?.userLabel).toBeUndefined();
  });

  it("手順の無い工程は、工程ノート自身の noteRef が 1 つ", () => {
    const f = build();
    const t = f.graph.steps.filter((s) => s.group?.id === "tasting");
    expect(t).toHaveLength(1);
    expect(t[0].noteRef?.noteId).toBe("tasting");
    expect(t[0].params[0].label).toBe("手順はまだありません");
  });

  it("派生ノートは手順から派生した derived の辺で帯に入る", () => {
    const f = build();
    const rye = f.graph.steps.find((s) => s.noteRef?.noteId === "rye");
    expect(rye?.group?.id).toBe("dough");
    expect(f.graph.edges.find((e) => e.kind === "derived")).toMatchObject({ source: "dough::d2", target: rye?.id });
  });

  it("focus の工程の帯は focus、現在地の工程の帯は here（label にも現在地）", () => {
    const f = build();
    expect(f.graph.steps.find((s) => s.group?.id === "bake")?.group?.highlight).toBe("focus");
    expect(f.graph.steps.find((s) => s.group?.id === "dough")?.group?.highlight).toBeUndefined();
    const g = build({ currentId: "bake" });
    const grp = g.graph.steps.find((s) => s.group?.id === "bake")?.group;
    expect(grp?.highlight).toBe("here");
    expect(grp?.label).toBe("焼成 · 現在地");
  });

  it("planHasOperation: 計画の段の工程だけ true（派生ノートの帯は false）", () => {
    const d = procPlan();
    const s = procStack();
    const flow = buildLevelFlow({ ...base(s), nodeId: "plan", docs: new Map([["plan", d]]), index, processIndex: null });
    expect(planHasOperation(flow, "bake")).toBe(true);
    expect(planHasOperation(flow, "unknown")).toBe(false);
    expect(planHasOperation({ kind: "none" }, "bake")).toBe(false);
  });
});
