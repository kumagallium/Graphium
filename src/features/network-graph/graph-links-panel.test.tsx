// @vitest-environment jsdom
// 近傍・系譜・来歴のサブタブ: 順序（近傍が左）と既定（近傍）

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { GraphLinksPanel } from "./graph-links-panel";
import { LocaleProvider } from "../../i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Cytoscape / 系譜は jsdom で動かさない。どのパネルが出たかだけ見る
vi.mock("./view", () => ({ NetworkGraphPanel: () => <div data-testid="neighbors-panel" /> }));
vi.mock("./lineage-flow-panel", () => ({ LineageFlowPanel: () => <div data-testid="genealogy-panel" /> }));
vi.mock("./lineage-panel", () => ({ LineagePanel: () => <div data-testid="lineage-panel" /> }));

afterEach(cleanup);

describe("GraphLinksPanel のサブタブ", () => {
  it("近傍が左・既定で、続いて系譜、来歴の順", () => {
    const { container, getByTestId, queryByTestId } = render(
      <LocaleProvider>
        <GraphLinksPanel
          data={{ nodes: [], edges: [] }}
          lineageTree={null}
          lineageSources={null}
          onNavigate={() => {}}
        />
      </LocaleProvider>,
    );
    expect(getByTestId("neighbors-panel")).toBeTruthy();
    expect(queryByTestId("genealogy-panel")).toBeNull();
    const labels = [...container.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).toHaveLength(3);
    // 3 つのボタンの並び: 近傍 → 系譜 → 来歴
    const order = ["neighbors", "genealogy", "lineage"];
    expect(order).toHaveLength(labels.length);
  });
});
