import { describe, expect, it } from "vitest";
import { nextStandalonePanelTab, resolveStandalonePanelTab } from "./standalone-panel-tab";

const ids = ["prov", "graph", "memos"];

describe("resolveStandalonePanelTab", () => {
  it("覚えた id が一覧にあれば開く", () => {
    expect(resolveStandalonePanelTab("graph", null, ids)).toBe("graph");
  });
  it("空文字（閉じている）・一覧に無い id は閉じた状態", () => {
    expect(resolveStandalonePanelTab("", "1", ids)).toBeNull();
    expect(resolveStandalonePanelTab("prov", null, ["graph", "memos"])).toBeNull();
  });
  it("新しいキーが無く旧キーが開いていれば、ステップを開く（無ければ先頭のタブ）", () => {
    expect(resolveStandalonePanelTab(null, "1", ["graph", "prov", "memos"])).toBe("prov");
    expect(resolveStandalonePanelTab(null, "1", ["graph", "memos"])).toBe("graph");
    expect(resolveStandalonePanelTab(null, "1", [])).toBeNull();
  });
  it("どちらも無い・旧キーが閉じていれば閉じたまま", () => {
    expect(resolveStandalonePanelTab(null, null, ids)).toBeNull();
    expect(resolveStandalonePanelTab(null, "0", ids)).toBeNull();
  });
});

describe("nextStandalonePanelTab", () => {
  it("開いているタブをもう一度押すと閉じ、別のタブを押すとそれを開く", () => {
    expect(nextStandalonePanelTab("graph", "graph")).toBe("");
    expect(nextStandalonePanelTab("graph", "memos")).toBe("memos");
    expect(nextStandalonePanelTab(null, "prov")).toBe("prov");
  });
});
