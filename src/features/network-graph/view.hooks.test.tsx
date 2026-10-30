// @vitest-environment jsdom
// NetworkGraphPanel の Hooks 順序の回帰テスト。
//
// 対象の不変条件:
// - ノード 0 件と 1 件以上の間を行き来して再描画しても落ちない
//   （凡例の useMemo が 0 件の早期 return の後ろにあると、行き来で
//   "Rendered more hooks than during the previous render" になる。
//   メモの引用で近傍グラフのノード数が増減するので、このテストで守る）

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// cytoscape は描画を持たないモックに差し替える（jsdom では canvas が無い）。
// このテストが見たいのは React の Hooks の呼び出し順だけ
vi.mock("cytoscape", () => {
  const cy = () => {
    const node: any = new Proxy(function () {}, {
      get: (_t, prop) => (prop === "length" || prop === "size" ? 0 : prop === "then" ? undefined : node),
      apply: () => node,
    });
    return node;
  };
  return { default: Object.assign(() => cy(), { use: () => {} }) };
});
vi.mock("../../lib/cytoscape-setup", () => ({ ensureCytoscapePlugins: () => {} }));

import { NetworkGraphPanel } from "./view";
import { LocaleProvider } from "../../i18n";
import type { NoteGraphData } from "./graph-builder";

afterEach(cleanup);

const empty: NoteGraphData = { nodes: [], edges: [] };
const one: NoteGraphData = {
  nodes: [{ id: "n1", title: "ノート", isCurrent: true, hop: 0 }],
  edges: [],
};
const withMemo: NoteGraphData = {
  nodes: [
    { id: "n1", title: "ノート", isCurrent: true, hop: 0 },
    { id: "memo:c1", title: "粒界のメモ", isCurrent: false, hop: 1, external: "memo" },
  ],
  edges: [{ source: "memo:c1", target: "n1", relation: "used" }],
};

describe("NetworkGraphPanel の Hooks 順序", () => {
  it("ノード 0 件 → 1 件 → 2 件（メモ付き）→ 0 件と再描画しても落ちない", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ui = (data: NoteGraphData) => (
      <LocaleProvider>
        <NetworkGraphPanel data={data} onNavigate={vi.fn()} />
      </LocaleProvider>
    );
    const { rerender } = render(ui(empty));
    expect(() => rerender(ui(one))).not.toThrow();
    expect(() => rerender(ui(withMemo))).not.toThrow();
    expect(() => rerender(ui(empty))).not.toThrow();
    expect(() => rerender(ui(withMemo))).not.toThrow();
    const hookErrors = spy.mock.calls.filter((c) => String(c[0]).includes("hooks"));
    spy.mockRestore();
    expect(hookErrors).toEqual([]);
  });
});
