// 素材の重複判定（contentHash）とハッシュの後追い付与

import { describe, it, expect, vi, beforeEach } from "vitest";
import { findSameAsset, computeAssetContentHash, backfillContentHashes } from "./dedupe";
import {
  clearMediaIndexCache,
  readMediaIndex,
  saveMediaIndex,
  CURRENT_MEDIA_INDEX_VERSION,
  type MediaIndex,
  type MediaIndexEntry,
} from "./media-index";
import { getActiveProvider } from "../../lib/storage/registry";

vi.mock("../../lib/storage/registry", () => ({
  getActiveProvider: vi.fn(),
}));

beforeEach(() => {
  clearMediaIndexCache();
  vi.clearAllMocks();
});

function entry(over: Partial<MediaIndexEntry> & { fileId: string }): MediaIndexEntry {
  return {
    name: `${over.fileId}.png`,
    type: "image",
    mimeType: "image/png",
    url: `local-media://${over.fileId}`,
    thumbnailUrl: "",
    uploadedAt: "2026-08-01T00:00:00.000Z",
    usedIn: [],
    ...over,
  };
}

function index(media: MediaIndexEntry[]): MediaIndex {
  return { version: CURRENT_MEDIA_INDEX_VERSION, updatedAt: "2026-08-01T00:00:00.000Z", media };
}

/** readAppData / writeAppData を持つプロバイダを差し込み、書き込み先の箱を返す */
function mockProvider(initial: MediaIndex | null) {
  const store = { value: initial };
  const writeAppData = vi.fn(async (_key: string, data: unknown) => {
    store.value = data as MediaIndex;
  });
  vi.mocked(getActiveProvider).mockReturnValue({
    readAppData: vi.fn(async () => store.value),
    writeAppData,
  } as never);
  return { store, writeAppData };
}

describe("findSameAsset", () => {
  const hash = "sha256:abc";

  it("同じ contentHash の素材を返す（名前が違っても中身で判定する）", () => {
    const idx = index([
      entry({ fileId: "a", name: "IMG_0001.jpg", contentHash: "sha256:other" }),
      entry({ fileId: "b", name: "実験結果.png", contentHash: hash }),
    ]);
    expect(findSameAsset(idx, hash)?.fileId).toBe("b");
  });

  it("ハッシュを持たない素材は候補にしない（判定できない ≠ 別物）", () => {
    const idx = index([entry({ fileId: "a", name: "same.png" })]);
    expect(findSameAsset(idx, hash)).toBeUndefined();
  });

  it("ハッシュが分からないときは判定しない", () => {
    const idx = index([entry({ fileId: "a", contentHash: hash })]);
    expect(findSameAsset(idx, undefined)).toBeUndefined();
  });

  it("アーカイブ済みの素材は使い回さない（一覧から外したものが戻ってくる）", () => {
    const idx = index([
      entry({ fileId: "a", contentHash: hash, archivedAt: "2026-08-02T00:00:00.000Z" }),
    ]);
    expect(findSameAsset(idx, hash)).toBeUndefined();
  });

  it("実体を持たない素材（URL・メモ）は候補にしない", () => {
    const idx = index([
      entry({ fileId: "u", type: "url", contentHash: hash }),
      entry({ fileId: "m", type: "memo", contentHash: hash }),
    ]);
    expect(findSameAsset(idx, hash)).toBeUndefined();
  });

  it("index が無くても落ちない", () => {
    expect(findSameAsset(null, hash)).toBeUndefined();
    expect(findSameAsset(undefined, hash)).toBeUndefined();
  });
});

describe("computeAssetContentHash", () => {
  it("同じ中身なら同じ、違えば違うハッシュになる", async () => {
    const a = new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });
    const b = new File([new Uint8Array([1, 2, 3])], "まったく別名.png", { type: "image/png" });
    const c = new File([new Uint8Array([1, 2, 4])], "a.png", { type: "image/png" });
    expect(await computeAssetContentHash(a)).toBe(await computeAssetContentHash(b));
    expect(await computeAssetContentHash(a)).not.toBe(await computeAssetContentHash(c));
  });

  it("上限を超えるファイルは計算しない（丸ごとメモリに載せない）", async () => {
    const big = new File([new Uint8Array(1)], "big.mp4", { type: "video/mp4" });
    Object.defineProperty(big, "size", { value: 129 * 1024 * 1024 });
    expect(await computeAssetContentHash(big)).toBeUndefined();
  });
});

describe("backfillContentHashes", () => {
  const bytesOf = (n: number) => new Uint8Array([n, n, n]);

  it("ハッシュを持たない既存素材に後から付ける", async () => {
    const { store } = mockProvider(
      index([entry({ fileId: "a" }), entry({ fileId: "b", contentHash: "sha256:already" })]),
    );
    await readMediaIndex(); // 最新をモジュールに読み込ませる

    const filled = await backfillContentHashes(async (id) => bytesOf(id.charCodeAt(0)));

    expect(filled).toBe(1);
    expect(store.value!.media.find((m) => m.fileId === "a")!.contentHash).toMatch(/^sha256:/);
    // 既に持っている素材は触らない
    expect(store.value!.media.find((m) => m.fileId === "b")!.contentHash).toBe("sha256:already");
  });

  it("実体を持たない素材（URL・メモ）は対象にしない", async () => {
    mockProvider(index([entry({ fileId: "u", type: "url" }), entry({ fileId: "m", type: "memo" })]));
    await readMediaIndex();
    const readBytes = vi.fn(async () => bytesOf(1));

    expect(await backfillContentHashes(readBytes)).toBe(0);
    expect(readBytes).not.toHaveBeenCalled();
  });

  it("読めない素材・上限超過の素材は飛ばして先へ進む", async () => {
    const { store } = mockProvider(
      index([entry({ fileId: "gone" }), entry({ fileId: "big" }), entry({ fileId: "ok" })]),
    );
    await readMediaIndex();

    const filled = await backfillContentHashes(async (id) => {
      if (id === "gone") throw new Error("消えている");
      if (id === "big") return undefined; // 上限超過
      return bytesOf(3);
    });

    expect(filled).toBe(1);
    expect(store.value!.media.find((m) => m.fileId === "ok")!.contentHash).toMatch(/^sha256:/);
    expect(store.value!.media.find((m) => m.fileId === "gone")!.contentHash).toBeUndefined();
    expect(store.value!.media.find((m) => m.fileId === "big")!.contentHash).toBeUndefined();
  });

  it("走査中に消えた素材は復活させない", async () => {
    const { store } = mockProvider(index([entry({ fileId: "a" }), entry({ fileId: "b" })]));
    await readMediaIndex();

    const filled = await backfillContentHashes(async (id) => {
      if (id === "a") {
        // a を読んでいる最中に b が削除された、という状況を作る
        await saveMediaIndex(index([entry({ fileId: "a" })]));
      }
      return bytesOf(1);
    });

    expect(filled).toBe(1);
    expect(store.value!.media.map((m) => m.fileId)).toEqual(["a"]);
  });

  it("中断されたらそこで止める", async () => {
    mockProvider(index([entry({ fileId: "a" }), entry({ fileId: "b" }), entry({ fileId: "c" })]));
    await readMediaIndex();
    const signal = { aborted: false };
    const readBytes = vi.fn(async () => {
      signal.aborted = true;
      return bytesOf(1);
    });

    await backfillContentHashes(readBytes, signal);
    expect(readBytes).toHaveBeenCalledTimes(1);
  });

  it("インデックスが無ければ何もしない", async () => {
    mockProvider(null);
    const readBytes = vi.fn(async () => bytesOf(1));
    expect(await backfillContentHashes(readBytes)).toBe(0);
    expect(readBytes).not.toHaveBeenCalled();
  });
});
