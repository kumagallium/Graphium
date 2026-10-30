// data-preview-store: 依頼・取り消し・同時実行数・失敗の再試行
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pending = new Map<string, { resolve: (t: string) => void; reject: (e: unknown) => void }>();
const loadAssetText = vi.fn(
  (id: string) =>
    new Promise<string>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    }),
);
vi.mock("../../features/data-import/asset-text", () => ({ loadAssetText: (id: string) => loadAssetText(id) }));

// 保存済みの下見（既定は無し）と保存の記録
const saved = new Map<string, unknown>();
const savePreview = vi.fn(async (id: string, p: unknown) => {
  saved.set(id, p);
});
vi.mock("./data-preview-persist", () => ({
  loadSavedPreview: async (id: string) => saved.get(id) ?? null,
  savePreview: (id: string, p: unknown) => savePreview(id, p),
}));

import {
  clearDataPreviewCache,
  getDataPreviewState,
  requestDataPreview,
  retryFailedDataPreviews,
} from "./data-preview-store";

const CSV = "x,y\n1,2\n2,4\n3,8";

/** 読み込み → 解析の Promise 連鎖が進みきるのを待つ */
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  pending.clear();
  saved.clear();
  savePreview.mockClear();
  loadAssetText.mockClear();
  clearDataPreviewCache();
});

afterEach(async () => {
  // 次のテストに読み込み中を持ち越さない（保存済みの確認を経て本文の読み込みに入ってから止める）
  await flush();
  for (const p of pending.values()) p.reject(new Error("teardown"));
  await flush();
});

describe("data-preview-store", () => {
  it("読み終えたら ready になり、同じ fileId は読み直さない", async () => {
    requestDataPreview("a");
    expect(getDataPreviewState("a").kind).toBe("loading");
    await flush();
    pending.get("a")!.resolve(CSV);
    await flush();
    const s = getDataPreviewState("a");
    expect(s.kind).toBe("ready");
    if (s.kind === "ready") expect(s.preview.usable).toBe(true);
    requestDataPreview("a");
    expect(loadAssetText).toHaveBeenCalledTimes(1);
  });

  it("計算した下見は保存し、保存済みがあれば本文を読まない", async () => {
    requestDataPreview("a");
    // 保存済みの確認（非同期）を経てから本文を読みに行く
    await flush();
    pending.get("a")!.resolve(CSV);
    await flush();
    expect(savePreview).toHaveBeenCalledTimes(1);
    expect(savePreview.mock.calls[0][0]).toBe("a");

    // 次の起動（メモリのキャッシュが空）では保存から出す
    clearDataPreviewCache();
    loadAssetText.mockClear();
    requestDataPreview("a");
    await flush();
    expect(getDataPreviewState("a").kind).toBe("ready");
    expect(loadAssetText).not.toHaveBeenCalled();
  });

  it("同時に読むのは 4 本まで。始まる前に取り消した依頼は読まない", async () => {
    const cancels = ["a", "b", "c", "d", "e", "f"].map((id) => requestDataPreview(id));
    await flush();
    expect(loadAssetText).toHaveBeenCalledTimes(4);
    cancels[4](); // e を取り消す
    pending.get("a")!.resolve(CSV);
    await flush();
    await flush();
    // e は飛ばして f が始まる
    expect(loadAssetText.mock.calls.map((c) => c[0])).toEqual(["a", "b", "c", "d", "f"]);
    expect(getDataPreviewState("e").kind).toBe("idle");
  });

  it("2 か所から依頼した素材は、両方が取り消したときだけ行列から外れる", () => {
    ["a", "b", "c", "d"].forEach((id) => requestDataPreview(id));
    const c1 = requestDataPreview("e");
    const c2 = requestDataPreview("e");
    c1();
    expect(getDataPreviewState("e").kind).toBe("loading");
    c2();
    expect(getDataPreviewState("e").kind).toBe("idle");
  });

  it("失敗は覚え、retryFailedDataPreviews の後の依頼で読み直す", async () => {
    requestDataPreview("a");
    await flush();
    pending.get("a")!.reject(new Error("x"));
    await flush();
    expect(getDataPreviewState("a").kind).toBe("failed");
    requestDataPreview("a");
    await flush();
    expect(loadAssetText).toHaveBeenCalledTimes(1);
    retryFailedDataPreviews();
    requestDataPreview("a");
    await flush();
    expect(loadAssetText).toHaveBeenCalledTimes(2);
  });
});
