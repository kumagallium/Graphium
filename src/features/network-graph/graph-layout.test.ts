import { describe, it, expect, beforeEach, vi } from "vitest";

// appdata の読み書きはモックする（ストレージプロバイダに触らせない）
const readMock = vi.fn();
const writeMock = vi.fn();
vi.mock("../../lib/storage/app-data-file", () => ({
  readAppDataFile: (...args: unknown[]) => readMock(...args),
  writeAppDataFile: (...args: unknown[]) => writeMock(...args),
}));
vi.mock("../../lib/storage/registry", () => ({
  getActiveProvider: () => ({}) as never,
}));

import {
  GRAPH_LAYOUT_VERSION,
  clearGraphLayout,
  clearGraphLayoutCache,
  ensureGraphLayouts,
  flushGraphLayouts,
  getGraphLayout,
  globalGraphScope,
  hasGraphLayout,
  noteGraphScope,
  provFlowScope,
  saveGraphLayout,
} from "./graph-layout";

beforeEach(() => {
  readMock.mockReset();
  writeMock.mockReset();
  writeMock.mockResolvedValue(undefined);
  clearGraphLayoutCache();
});

describe("スコープキー", () => {
  it("ビューの種類ごとに別のキーになる（同じノートでも周辺グラフと手順フローは別）", () => {
    expect(noteGraphScope("note-1")).toBe("note:note-1");
    expect(provFlowScope("note-1")).toBe("prov:note-1");
    expect(noteGraphScope("note-1")).not.toBe(provFlowScope("note-1"));
    expect(globalGraphScope()).toBe("global");
  });
});

describe("読み込み", () => {
  it("保存済みの配置を読み出せる", async () => {
    readMock.mockResolvedValue({
      version: GRAPH_LAYOUT_VERSION,
      layouts: { "note:a": { positions: { n1: { x: 10, y: 20 } }, updatedAt: 1 } },
    });
    await ensureGraphLayouts();
    expect(getGraphLayout("note:a")).toEqual({ n1: { x: 10, y: 20 } });
    expect(hasGraphLayout("note:a")).toBe(true);
  });

  it("版が違えば捨てて空から始める（手動配置は失っても自動配置に戻るだけ）", async () => {
    readMock.mockResolvedValue({
      version: GRAPH_LAYOUT_VERSION + 1,
      layouts: { "note:a": { positions: { n1: { x: 1, y: 2 } }, updatedAt: 1 } },
    });
    await ensureGraphLayouts();
    expect(getGraphLayout("note:a")).toBeNull();
  });

  it("読み込みに失敗しても落ちない", async () => {
    readMock.mockRejectedValue(new Error("network"));
    await expect(ensureGraphLayouts()).resolves.toBeTruthy();
    expect(getGraphLayout("note:a")).toBeNull();
  });

  it("読み込みは 1 回だけ（2 回目はキャッシュ）", async () => {
    readMock.mockResolvedValue({ version: GRAPH_LAYOUT_VERSION, layouts: {} });
    await ensureGraphLayouts();
    await ensureGraphLayouts();
    expect(readMock).toHaveBeenCalledTimes(1);
  });

  it("未ロードのうちは同期取得が null を返す", () => {
    expect(getGraphLayout("note:a")).toBeNull();
  });
});

describe("保存", () => {
  it("保存した座標をすぐ同期で引ける（書き込み完了を待たない）", async () => {
    readMock.mockResolvedValue(null);
    await ensureGraphLayouts();
    saveGraphLayout("note:a", { n1: { x: 5, y: 6 } });
    expect(getGraphLayout("note:a")).toEqual({ n1: { x: 5, y: 6 } });
  });

  it("flush で appdata に書き込む", async () => {
    readMock.mockResolvedValue(null);
    await ensureGraphLayouts();
    saveGraphLayout("note:a", { n1: { x: 5, y: 6 } });
    await flushGraphLayouts();
    expect(writeMock).toHaveBeenCalledTimes(1);
    const written = writeMock.mock.calls[0][2] as { layouts: Record<string, unknown> };
    expect(written.layouts["note:a"]).toBeTruthy();
  });

  it("空の座標で保存するとスコープごと消える（自動配置に戻した状態を残さない）", async () => {
    readMock.mockResolvedValue(null);
    await ensureGraphLayouts();
    saveGraphLayout("note:a", { n1: { x: 5, y: 6 } });
    saveGraphLayout("note:a", {});
    expect(getGraphLayout("note:a")).toBeNull();
    expect(hasGraphLayout("note:a")).toBe(false);
  });

  it("clearGraphLayout でそのグラフだけ自動配置に戻る（他は残る）", async () => {
    readMock.mockResolvedValue(null);
    await ensureGraphLayouts();
    saveGraphLayout("note:a", { n1: { x: 1, y: 1 } });
    saveGraphLayout("note:b", { n2: { x: 2, y: 2 } });
    clearGraphLayout("note:a");
    expect(getGraphLayout("note:a")).toBeNull();
    expect(getGraphLayout("note:b")).toEqual({ n2: { x: 2, y: 2 } });
  });

  it("スコープが増え続けても上限で頭打ちになり、古いものから落ちる", async () => {
    readMock.mockResolvedValue(null);
    await ensureGraphLayouts();
    // 上限（300）より多く積む。溢れた分は updatedAt の古い順に落ちる
    for (let i = 0; i < 320; i++) {
      saveGraphLayout(`note:${i}`, { n: { x: i, y: i } });
    }
    await flushGraphLayouts();
    const calls = writeMock.mock.calls;
    const written = calls[calls.length - 1][2] as { layouts: Record<string, unknown> };
    expect(Object.keys(written.layouts).length).toBe(300);
    // 最後に保存したものは残っている
    expect(written.layouts["note:319"]).toBeTruthy();
  });
});
