// @vitest-environment jsdom
// 全体グラフの来歴パネルの描画テスト
//
// 対象の不変条件:
// - sources が null の間は読み込み中の 1 行を出す（「ノートを開いて」の空表示にしない）
// - sources があれば起点ノートの札が出る
// - × で onClose が呼ばれる

import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { GraphLineageSidePanel } from "./graph-lineage-side-panel";
import { LocaleProvider } from "../../i18n";
import type { LineageSources } from "./lineage-stack-panel";
import type { GraphiumDocument, GraphiumFile } from "../../lib/document-types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom に ResizeObserver が無いので、線の描画（lineage-stack-view）用に何もしない実装を置く
beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(cleanup);

const file = { id: "bread-1", name: "春のカンパーニュ試作.graphium.json" } as unknown as GraphiumFile;
const doc = { title: "春のカンパーニュ試作", blocks: [] } as unknown as GraphiumDocument;
const sources: LineageSources = {
  files: [file],
  docs: new Map([["bread-1", doc]]),
  mediaIndex: null,
};

const renderPanel = (s: LineageSources | null, onClose = vi.fn()) =>
  render(
    <LocaleProvider>
      <GraphLineageSidePanel selectedId="bread-1" sources={s} onOpenNote={vi.fn()} onClose={onClose} />
    </LocaleProvider>,
  );

describe("GraphLineageSidePanel", () => {
  it("sources が null の間は読み込み中を出す", () => {
    const { container } = renderPanel(null);
    expect(container.textContent).toMatch(/Loading lineage|来歴を読み込んでいます/);
  });

  it("sources があれば起点ノートの札が出る", () => {
    const { container } = renderPanel(sources);
    expect(container.textContent).toContain("春のカンパーニュ試作");
    expect(container.textContent).not.toMatch(/Loading lineage|来歴を読み込んでいます/);
  });

  it("× で onClose が呼ばれる", () => {
    const onClose = vi.fn();
    const { getByRole } = renderPanel(sources, onClose);
    fireEvent.click(getByRole("button", { name: /Close|閉じる/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
