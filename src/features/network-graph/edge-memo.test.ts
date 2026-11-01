// 線（つながり）のメモ — 純関数のテスト
//
// 守る不変条件:
// - 手順の組は、順序のみの線と「手順が作った材料を別の手順が使う」2 本の線で同じになる
// - 手順が作っていない材料・道具、derived、external、broken の線は対象外
// - 同じ材料を複数の手順が使うとき、使う側の線（used）はその手順との組、作る側の線（generates）は対象外
// - 工程グラフは FlowEdge.pair の両端の行の安定 ID（noteRef.rowId）の組。ノート未作成の行（row:...）も対象。安定 ID が無い行は対象外
// - 件数は captureIndex を 1 回走査した Map。アーカイブ・ゴミ箱・別ノートのメモは数えない
// - edgeMemos を渡さない画面（memo 無し）のメニューの出し方は従来と同じ

import { describe, expect, it, vi } from "vitest";
import type { FlowEdge, FlowGraphData, FlowStep } from "./activity-graph-adapter";
import type { CaptureEntry, CaptureIndex } from "../mobile-capture";
import {
  buildEdgeMemoIndex,
  decideEdgeMenu,
  edgeMemoKey,
  resolveEdgeMemoTarget,
  resolvePlanPair,
  resolveStepPair,
  withEdgeMemo,
} from "./edge-memo";

const step = (id: string, name: string, extra: Partial<FlowStep> = {}): FlowStep => ({ id, name, params: [], ...extra });
const edge = (id: string, kind: FlowEdge["kind"], source: string, target: string, extra: Partial<FlowEdge> = {}): FlowEdge => ({
  id,
  kind,
  source,
  target,
  ...extra,
});

/** 混合 → 焼成（材料を挟む）/ 焼成 → 測定（順序のみ）/ 焼成 → 研磨・熱処理（同じ材料を 2 つの手順が使う） */
const graph: FlowGraphData = {
  steps: [
    step("s-mix", "混合"),
    step("s-fire", "焼成"),
    step("s-measure", "測定"),
    step("s-polish", "研磨"),
    step("s-heat", "熱処理"),
    step("s-ext", "外部の手順", { externalOrigin: { noteId: "n9", noteTitle: "他", stepId: "x", stepTitle: "x", outputLabel: "x", broken: false } }),
  ],
  entities: [],
  edges: [
    edge("gen-mix-powder", "generates", "s-mix", "powder"),
    edge("used-powder-fire", "used", "powder", "s-fire"),
    edge("order-fire-measure", "orderOnly", "s-fire", "s-measure"),
    // 焼成が作った試料を、研磨と熱処理の 2 つの手順が使う
    edge("gen-fire-pellet", "generates", "s-fire", "pellet"),
    edge("used-pellet-polish", "used", "pellet", "s-polish"),
    edge("used-pellet-heat", "used", "pellet", "s-heat"),
    // 手順が作っていない材料・道具
    edge("used-cu-mix", "used", "cu", "s-mix"),
    edge("derived-a-b", "derived", "powder", "pellet"),
    edge("ext-1", "external", "s-ext", "s-fire"),
  ],
};
const byId = (id: string) => graph.edges.find((e) => e.id === id)!;

describe("resolveStepPair（作業手順グラフの手順の組）", () => {
  it("orderOnly は source / target がそのまま手順の組", () => {
    expect(resolveStepPair(graph, byId("order-fire-measure"))).toEqual({ from: "s-fire", to: "s-measure" });
  });

  it("手順が作った材料を使う線は、generates の線を押しても used の線を押しても同じ組", () => {
    const expected = { from: "s-mix", to: "s-fire" };
    expect(resolveStepPair(graph, byId("gen-mix-powder"))).toEqual(expected);
    expect(resolveStepPair(graph, byId("used-powder-fire"))).toEqual(expected);
  });

  it("手順が作っていない材料・道具の線（used）は対象外", () => {
    expect(resolveStepPair(graph, byId("used-cu-mix"))).toBeNull();
  });

  it("同じ材料を複数の手順が使うとき、used の線は押した線の使う側の手順と組になる", () => {
    expect(resolveStepPair(graph, byId("used-pellet-polish"))).toEqual({ from: "s-fire", to: "s-polish" });
    expect(resolveStepPair(graph, byId("used-pellet-heat"))).toEqual({ from: "s-fire", to: "s-heat" });
  });

  it("同じ材料を複数の手順が使うとき、作る側の線（generates）はどの組か決められないので対象外", () => {
    expect(resolveStepPair(graph, byId("gen-fire-pellet"))).toBeNull();
  });

  it("使う手順が無い材料（最終生成物）の generates は対象外", () => {
    const g: FlowGraphData = { steps: [step("a", "A")], entities: [], edges: [edge("g", "generates", "a", "out")] };
    expect(resolveStepPair(g, g.edges[0])).toBeNull();
  });

  it("derived / external / broken は対象外。別ノート由来の手順は端点にしない", () => {
    expect(resolveStepPair(graph, byId("derived-a-b"))).toBeNull();
    expect(resolveStepPair(graph, byId("ext-1"))).toBeNull();
    expect(resolveStepPair(graph, { ...byId("order-fire-measure"), broken: true })).toBeNull();
    const withExt: FlowGraphData = {
      ...graph,
      edges: [...graph.edges, edge("order-ext-fire", "orderOnly", "s-ext", "s-fire")],
    };
    expect(resolveStepPair(withExt, withExt.edges[withExt.edges.length - 1])).toBeNull();
  });

  it("材料を作る手順が複数あるときは決められないので対象外", () => {
    const g: FlowGraphData = {
      steps: [step("a", "A"), step("b", "B"), step("c", "C")],
      entities: [],
      edges: [edge("g1", "generates", "a", "x"), edge("g2", "generates", "b", "x"), edge("u", "used", "x", "c")],
    };
    expect(resolveStepPair(g, g.edges[2])).toBeNull();
  });

  it("自分自身への線は対象外", () => {
    const g: FlowGraphData = {
      steps: [step("a", "A")],
      entities: [],
      edges: [edge("g", "generates", "a", "x"), edge("u", "used", "x", "a")],
    };
    expect(resolveStepPair(g, g.edges[1])).toBeNull();
  });
});

/** 工程の行（rowId = 行の安定 ID）。noteId が null = ノート未作成の行 */
const planStep = (id: string, name: string, rowId: string | undefined, noteId: string | null, rowIndex = 1): FlowStep =>
  step(id, name, { noteRef: { noteId, tableBlockId: "t", rowIndex, ...(rowId ? { rowId } : {}) } });
const planGraph = (steps: FlowStep[]): Pick<FlowGraphData, "steps"> => ({ steps });

describe("resolvePlanPair（工程グラフの工程の組 = 行の安定 ID）", () => {
  const g = planGraph([
    planStep("note:op-a", "混合", "row_a", "op-a"),
    planStep("note:op-b", "焼成", "row_b", "op-b", 2),
    planStep("row:t:3", "測定", "row_c", null, 3),
    planStep("row:t:4", "古い行", undefined, null, 4),
  ]);

  it("予定の線と実績の線で同じ行 ID の組", () => {
    const pair = { from: "note:op-a", to: "note:op-b" };
    expect(resolvePlanPair(g, edge("planned:x", "planned", "note:op-a", "note:op-b", { pair }))).toEqual({ from: "row_a", to: "row_b" });
    expect(resolvePlanPair(g, edge("used:y", "used", "note:op-a#out", "note:op-b", { pair }))).toEqual({ from: "row_a", to: "row_b" });
  });

  it("ノート未作成の行への予定の線にも付く", () => {
    const pair = { from: "note:op-b", to: "row:t:3" };
    expect(resolvePlanPair(g, edge("p", "planned", "note:op-b", "row:t:3", { pair }))).toEqual({ from: "row_b", to: "row_c" });
  });

  it("行にノートができても（線の端点 id が note: に変わっても）同じ組", () => {
    const before = planGraph([planStep("note:op-a", "混合", "row_a", "op-a"), planStep("row:t:2", "焼成", "row_b", null, 2)]);
    const after = planGraph([planStep("note:op-a", "混合", "row_a", "op-a"), planStep("note:new-b", "焼成", "row_b", "new-b", 2)]);
    const a = resolvePlanPair(before, edge("p", "planned", "note:op-a", "row:t:2", { pair: { from: "note:op-a", to: "row:t:2" } }));
    const b = resolvePlanPair(after, edge("p", "planned", "note:op-a", "note:new-b", { pair: { from: "note:op-a", to: "note:new-b" } }));
    expect(a).toEqual({ from: "row_a", to: "row_b" });
    expect(b).toEqual(a);
  });

  it("行の並べ替え・名前変更でも同じ組（行 ID だけで決まる）", () => {
    const moved = planGraph([planStep("row:t:1", "焼成（改）", "row_b", null, 1), planStep("row:t:2", "混合（改）", "row_a", null, 2)]);
    expect(
      resolvePlanPair(moved, edge("p", "planned", "row:t:2", "row:t:1", { pair: { from: "row:t:2", to: "row:t:1" } })),
    ).toEqual({ from: "row_a", to: "row_b" });
  });

  it("安定 ID が無い行が端点の線は対象外", () => {
    expect(
      resolvePlanPair(g, edge("p", "planned", "note:op-a", "row:t:4", { pair: { from: "note:op-a", to: "row:t:4" } })),
    ).toBeNull();
    expect(
      resolvePlanPair(g, edge("p", "planned", "row:t:4", "note:op-b", { pair: { from: "row:t:4", to: "note:op-b" } })),
    ).toBeNull();
  });

  it("pair が無い線（generates・生成元が分からない used）・broken・グラフに無い端点は対象外", () => {
    expect(resolvePlanPair(g, edge("g", "generates", "note:op-a", "note:op-a#out"))).toBeNull();
    expect(resolvePlanPair(g, edge("u", "used", "x", "note:op-b"))).toBeNull();
    expect(
      resolvePlanPair(g, edge("b", "used", "x", "note:op-b", { broken: true, pair: { from: "note:op-a", to: "note:op-b" } })),
    ).toBeNull();
    expect(
      resolvePlanPair(g, edge("z", "used", "x", "note:op-b", { pair: { from: "note:gone", to: "note:op-b" } })),
    ).toBeNull();
  });
});

describe("resolveEdgeMemoTarget（付け先とスナップショットの名前）", () => {
  it("steps: 手順名を fromLabel / toLabel に入れる", () => {
    expect(resolveEdgeMemoTarget("steps", graph, byId("used-powder-fire"))).toEqual({
      graph: "steps",
      from: "s-mix",
      to: "s-fire",
      fromLabel: "混合",
      toLabel: "焼成",
    });
  });

  it("plan: 行の安定 ID の組に、行の名前を入れる。名前が空ならキーごと省く", () => {
    const pg: FlowGraphData = {
      steps: [planStep("note:op-a", "混合", "row_a", "op-a"), planStep("row:t:2", "  ", "row_b", null, 2)],
      entities: [],
      edges: [],
    };
    const e = edge("p", "planned", "note:op-a", "row:t:2", { pair: { from: "note:op-a", to: "row:t:2" } });
    expect(resolveEdgeMemoTarget("plan", pg, e)).toEqual({ graph: "plan", from: "row_a", to: "row_b", fromLabel: "混合" });
  });

  it("対象外の線は null", () => {
    expect(resolveEdgeMemoTarget("steps", graph, byId("used-cu-mix"))).toBeNull();
  });
});

const memo = (id: string, over: Partial<CaptureEntry> = {}): CaptureEntry => ({
  id,
  text: id,
  createdAt: `2026-10-0${id.length}T00:00:00Z`,
  ...over,
});
const index = (captures: CaptureEntry[]): CaptureIndex => ({ version: 1, updatedAt: "2026-10-30T00:00:00Z", captures });

describe("buildEdgeMemoIndex（組ごとの件数）", () => {
  const fireMeasure = { graph: "steps" as const, from: "s-fire", to: "s-measure" };
  it("このノートの sourceEdge 付きメモだけを組ごとに集める（新しい順）", () => {
    const idx = buildEdgeMemoIndex(
      index([
        memo("a", { sourceNote: { fileId: "n1" }, sourceEdge: fireMeasure, createdAt: "2026-10-01T00:00:00Z" }),
        memo("bb", { sourceNote: { fileId: "n1" }, sourceEdge: fireMeasure, createdAt: "2026-10-02T00:00:00Z" }),
        memo("c", { sourceNote: { fileId: "n1" }, sourceEdge: { graph: "steps", from: "s-mix", to: "s-fire" } }),
        // 数えないもの: 別ノート / 線ではない（ブロックのメモ）/ アーカイブ / ゴミ箱 / 向きが逆
        memo("other", { sourceNote: { fileId: "n2" }, sourceEdge: fireMeasure }),
        memo("block", { sourceNote: { fileId: "n1", blockId: "b" } }),
        memo("arch", { sourceNote: { fileId: "n1" }, sourceEdge: fireMeasure, archivedAt: "2026-10-03T00:00:00Z" }),
        memo("trash", { sourceNote: { fileId: "n1" }, sourceEdge: fireMeasure, deletedAt: "2026-10-03T00:00:00Z" }),
        memo("rev", { sourceNote: { fileId: "n1" }, sourceEdge: { graph: "steps", from: "s-measure", to: "s-fire" } }),
        memo("plan", { sourceNote: { fileId: "n1" }, sourceEdge: { graph: "plan", from: "s-fire", to: "s-measure" } }),
      ]),
      "n1",
    );
    expect(idx.get(edgeMemoKey(fireMeasure))!.map((m) => m.id)).toEqual(["bb", "a"]);
    expect(idx.get(edgeMemoKey({ graph: "steps", from: "s-mix", to: "s-fire" }))!.map((m) => m.id)).toEqual(["c"]);
    // 向き・グラフの種類が違えば別の組
    expect(idx.get(edgeMemoKey({ graph: "steps", from: "s-measure", to: "s-fire" }))!.map((m) => m.id)).toEqual(["rev"]);
    expect(idx.get(edgeMemoKey({ graph: "plan", from: "s-fire", to: "s-measure" }))!.map((m) => m.id)).toEqual(["plan"]);
    expect(idx.size).toBe(4);
  });

  it("wiki: / skill: の接頭辞の有無は区別しない", () => {
    const idx = buildEdgeMemoIndex(
      index([memo("a", { sourceNote: { fileId: "wiki:n1" }, sourceEdge: fireMeasure })]),
      "n1",
    );
    expect(idx.get(edgeMemoKey(fireMeasure))).toHaveLength(1);
    expect(
      buildEdgeMemoIndex(index([memo("a", { sourceNote: { fileId: "n1" }, sourceEdge: fireMeasure })]), "wiki:n1").size,
    ).toBe(1);
  });

  it("captureIndex / noteFileId が無ければ空", () => {
    expect(buildEdgeMemoIndex(null, "n1").size).toBe(0);
    expect(buildEdgeMemoIndex(index([]), null).size).toBe(0);
  });
});

describe("decideEdgeMenu（線を押したときに何を開くか）", () => {
  const base = { kind: "used", deletable: false, canRemoveOrder: true, canRemovePlanned: true, pair: null };
  const target = { graph: "steps" as const, from: "a", to: "b" };

  it("memo を渡さない画面（edgeMemos 無し）は従来と同じ: 出すものが無ければ開かない。開くのはメニュー", () => {
    expect(decideEdgeMenu(base)).toBeNull();
    expect(decideEdgeMenu({ ...base, kind: "orderOnly", deletable: true })).toEqual({ mode: "menu", remove: "orderOnly", pair: null, memo: null });
    expect(decideEdgeMenu({ ...base, kind: "orderOnly", deletable: true, canRemoveOrder: false })).toBeNull();
    expect(decideEdgeMenu({ ...base, kind: "planned", deletable: true })).toEqual({ mode: "menu", remove: "planned", pair: null, memo: null });
    const pair = { from: "note:a", to: "note:b" };
    expect(decideEdgeMenu({ ...base, pair })).toEqual({ mode: "menu", remove: null, pair, memo: null });
    // memo: null / 付け先なしでも従来と同じ
    expect(decideEdgeMenu({ ...base, memo: null })).toBeNull();
    expect(decideEdgeMenu({ ...base, memo: { target: null, count: 3, canWrite: true } })).toBeNull();
  });

  it("付け先の無い線（target が null）で削除・名前が出せるなら、従来どおりメニュー（メモの項目は無い）", () => {
    expect(decideEdgeMenu({ ...base, kind: "orderOnly", deletable: true, memo: { target: null, count: 0, canWrite: true } })).toEqual({
      mode: "menu",
      remove: "orderOnly",
      pair: null,
      memo: null,
    });
  });

  it("付け先があれば、ほかに操作が無い線でも小窓を直接開く", () => {
    expect(decideEdgeMenu({ ...base, memo: { target, count: 0, canWrite: true } })).toEqual({
      mode: "popover",
      remove: null,
      pair: null,
      memo: { target, count: 0 },
    });
  });

  it("付け先があって削除・名前も出せる線: 小窓を開き、操作は小窓の見出し用に残る（メニューにしない）", () => {
    const pair = { from: "note:a", to: "note:b" };
    expect(decideEdgeMenu({ ...base, kind: "orderOnly", deletable: true, pair, memo: { target, count: 2, canWrite: true } })).toEqual({
      mode: "popover",
      remove: "orderOnly",
      pair,
      memo: { target, count: 2 },
    });
  });

  it("読むだけの画面: メモが 0 件なら小窓を開かない（1 件以上なら読めるので開く）", () => {
    expect(decideEdgeMenu({ ...base, memo: { target, count: 0, canWrite: false } })).toBeNull();
    expect(decideEdgeMenu({ ...base, memo: { target, count: 1, canWrite: false } })).toEqual({
      mode: "popover",
      remove: null,
      pair: null,
      memo: { target, count: 1 },
    });
  });
});

describe("withEdgeMemo（描画の線へのメモの付与）", () => {
  const rf = { id: "order", label: "順序のみ", data: { kind: "orderOnly", deletable: true } };
  const flow = graph.edges.find((e) => e.id === "order-fire-measure")!;
  const target = { graph: "steps" as const, from: "s-fire", to: "s-measure" };

  it("edgeMemos を渡さない画面: 線を同じ参照のまま返す（type もメモ用のデータも足さない）", () => {
    expect(withEdgeMemo(rf, flow, undefined, "memo")).toBe(rf);
  });

  it("付け先の無い線（対象外）は同じ参照のまま返す", () => {
    const memos = { target: () => null, count: () => 5, canWrite: true, onOpen: () => {} };
    expect(withEdgeMemo(rf, flow, memos, "memo")).toBe(rf);
  });

  it("付け先があってメモが 0 件: type は標準のまま、メニュー用に付け先と件数だけ持たせる", () => {
    const memos = { target: () => target, count: () => 0, canWrite: true, onOpen: () => {} };
    const out = withEdgeMemo(rf, flow, memos, "memo");
    expect(out).not.toBe(rf);
    expect((out as { type?: string }).type).toBeUndefined();
    expect(out.data).toMatchObject({ kind: "orderOnly", deletable: true, memoTarget: target, memoCount: 0 });
    expect(out.data).not.toHaveProperty("onOpenMemo");
  });

  it("メモが 1 件以上: 印つきの種類にし、印を押すと onOpen に付け先と位置が渡る。元の線は書き換えない", () => {
    const calls: unknown[] = [];
    const memos = { target: () => target, count: () => 2, canWrite: true, onOpen: (...a: unknown[]) => calls.push(a) };
    const out = withEdgeMemo(rf, flow, memos, "memo");
    expect((out as { type?: string }).type).toBe("memo");
    expect(out.data).toMatchObject({ memoCount: 2, hasLabel: true });
    (out.data as unknown as { onOpenMemo: (p: { x: number; y: number }) => void }).onOpenMemo({ x: 3, y: 4 });
    expect(calls).toEqual([[target, { x: 3, y: 4 }, undefined]]);
    expect(rf).toEqual({ id: "order", label: "順序のみ", data: { kind: "orderOnly", deletable: true } });
  });

  it("beforeOpen を渡すと、印を押したときに呼ばれ、返した線の操作が onOpen の 3 つ目に渡る", () => {
    const calls: unknown[] = [];
    const memos = { target: () => target, count: () => 1, canWrite: true, onOpen: (...a: unknown[]) => calls.push(a) };
    const actions = { pair: null, userLabel: "", remove: "orderOnly" as const };
    const beforeOpen = vi.fn(() => actions);
    const out = withEdgeMemo(rf, flow, memos, "memo", beforeOpen);
    (out.data as unknown as { onOpenMemo: (p: unknown) => void }).onOpenMemo({ x: 1, y: 2 });
    expect(beforeOpen).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([[target, { x: 1, y: 2 }, actions]]);
  });

  it("線の中央に文字が無ければ hasLabel は false", () => {
    const memos = { target: () => target, count: () => 1, canWrite: false, onOpen: () => {} };
    expect(withEdgeMemo({ id: "x", data: { kind: "used" } }, flow, memos, "memo").data).toMatchObject({ hasLabel: false });
    expect(withEdgeMemo({ id: "x", label: "", data: { kind: "used" } }, flow, memos, "memo").data).toMatchObject({ hasLabel: false });
  });
});
