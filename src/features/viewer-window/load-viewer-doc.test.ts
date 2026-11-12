import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphiumDocument } from "../../lib/document-types";

const provider = {
  init: vi.fn(async () => {}),
  loadFile: vi.fn(async (id: string) => ({ title: `note:${id}`, pages: [] }) as unknown as GraphiumDocument),
  loadWikiFile: vi.fn(async (id: string) => ({ title: `wiki:${id}`, pages: [] }) as unknown as GraphiumDocument),
  loadSkillFile: vi.fn(async (id: string) => ({ title: `skill:${id}`, pages: [] }) as unknown as GraphiumDocument),
};
const loadSnapshot = vi.fn();

vi.mock("../../lib/storage/registry", () => ({
  getActiveProvider: () => provider,
  probeServerProvider: vi.fn(async () => {}),
}));
vi.mock("../version-snapshots/snapshot-store", () => ({
  loadSnapshot: (...args: unknown[]) => loadSnapshot(...args),
}));
// エディタ一式は読み込まない（ここで確かめるのは読み込みの振り分けと比較だけ）
vi.mock("../../base/editor", () => ({ SandboxEditor: () => null }));
vi.mock("../../blocks/registry", () => ({ customBlockEntries: [], sanitizeBlocksForLoad: (b: unknown[]) => b }));

import { loadViewerDoc, resetViewerProviderForTest, viewerDocSignature } from "./ViewerWindow";

describe("loadViewerDoc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("通常のノートは loadFile で読む", async () => {
    const doc = await loadViewerDoc("n1");
    expect(provider.loadFile).toHaveBeenCalledWith("n1");
    expect(doc.title).toBe("note:n1");
  });

  it("wiki: / skill: はプレフィックスを外して専用の読み込みへ回す", async () => {
    expect((await loadViewerDoc("wiki:w1")).title).toBe("wiki:w1");
    expect(provider.loadWikiFile).toHaveBeenCalledWith("w1");
    expect((await loadViewerDoc("skill:s1")).title).toBe("skill:s1");
    expect(provider.loadSkillFile).toHaveBeenCalledWith("s1");
    expect(provider.loadFile).not.toHaveBeenCalled();
  });

  it("snapshot: は版のスナップショットを読み、無ければ失敗にする", async () => {
    loadSnapshot.mockResolvedValueOnce({ title: "snap", pages: [] });
    expect((await loadViewerDoc("snapshot:v1")).title).toBe("snap");
    expect(loadSnapshot).toHaveBeenCalledWith(provider, "v1");
    loadSnapshot.mockResolvedValueOnce(null);
    await expect(loadViewerDoc("snapshot:v2")).rejects.toThrow();
  });

  it("保存先の準備は 1 度だけ（読み直しのたびに一覧を取り直さない）", async () => {
    resetViewerProviderForTest();
    await loadViewerDoc("n1");
    await loadViewerDoc("n1");
    expect(provider.init).toHaveBeenCalledTimes(1);
  });

  it("準備に失敗したら、次の読み込みでやり直す", async () => {
    resetViewerProviderForTest();
    provider.init.mockRejectedValueOnce(new Error("not ready"));
    await expect(loadViewerDoc("n1")).rejects.toThrow("not ready");
    expect((await loadViewerDoc("n1")).title).toBe("note:n1");
  });
});

describe("viewerDocSignature", () => {
  const base = { title: "T", pages: [{ blocks: [{ id: "b1", type: "paragraph" }] }] } as unknown as GraphiumDocument;

  it("題と本文が同じなら同じ（保存時刻などが変わっても描き直さない）", () => {
    const later = { ...base, modifiedAt: "2026-11-12T00:00:00Z" } as unknown as GraphiumDocument;
    expect(viewerDocSignature(later)).toBe(viewerDocSignature(base));
  });

  it("題か本文が変われば変わる", () => {
    expect(viewerDocSignature({ ...base, title: "U" } as GraphiumDocument)).not.toBe(viewerDocSignature(base));
    const edited = { ...base, pages: [{ blocks: [{ id: "b1", type: "heading" }] }] } as unknown as GraphiumDocument;
    expect(viewerDocSignature(edited)).not.toBe(viewerDocSignature(base));
  });
});
