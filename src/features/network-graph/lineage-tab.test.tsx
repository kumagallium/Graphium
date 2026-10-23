// @vitest-environment jsdom
// 来歴サブタブの見せ方の切り替えテスト
//
// 対象の不変条件:
// - 既定はツリー（上流へ遡る旧来の表示）。保存値が無い・読めないときもツリー
// - 「段」を選ぶと段の表示に替わり、選んだ方を localStorage に覚える

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { LineageTab, LineageViewToggle, readLineageViewMode, useLineageViewMode } from "./lineage-tab";
import { LocaleProvider } from "../../i18n";
import type { LineageNode } from "./lineage-builder";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = "graphium.lineage.viewMode";

function makeTree(): LineageNode {
  const parent: LineageNode = {
    id: "dough",
    title: "仕込み A",
    navId: "dough",
    isCurrent: false,
    kind: "note",
    depth: 1,
    relations: ["derivedFrom"],
    parents: [],
  };
  return {
    id: "bake",
    title: "焼成 1 回目",
    navId: "bake",
    isCurrent: true,
    kind: "note",
    depth: 0,
    relations: [],
    parents: [parent],
  };
}

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

// graph-links-panel.tsx と同じ組み合わせ（切り替え + 中身）
function Harness() {
  const [mode, setMode] = useLineageViewMode();
  return (
    <>
      <LineageViewToggle mode={mode} onChange={setMode} />
      <LineageTab mode={mode} tree={makeTree()} sources={null} onNavigate={() => {}} />
    </>
  );
}

function renderTab() {
  return render(
    <LocaleProvider>
      <Harness />
    </LocaleProvider>,
  );
}

describe("LineageTab: ツリー / 段の切り替え", () => {
  it("保存値が無ければツリー", () => {
    expect(readLineageViewMode()).toBe("tree");
    const { getAllByRole, getByText } = renderTab();
    const radios = getAllByRole("radio");
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
    // ツリーは上流の「仕込み A」を行として出す
    expect(getByText("仕込み A")).toBeTruthy();
  });

  it("知らない保存値もツリー", () => {
    localStorage.setItem(KEY, "something-else");
    expect(readLineageViewMode()).toBe("tree");
  });

  it("段を選ぶと覚えて、次に開いたときも段", () => {
    const { getAllByRole } = renderTab();
    fireEvent.click(getAllByRole("radio")[1]);
    expect(localStorage.getItem(KEY)).toBe("stack");
    expect(getAllByRole("radio")[1].getAttribute("aria-checked")).toBe("true");
    cleanup();
    const second = renderTab();
    expect(second.getAllByRole("radio")[1].getAttribute("aria-checked")).toBe("true");
  });
});
