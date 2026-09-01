// プレビュー画像のローカルキャッシュ（cachePreviewImage / loadPreviewImageByRef）
//
// この機能の要点は「描画が第三者へ出ない」ことなので、テストも
// 「失敗系でも remote URL が previewImage に入らない」ことを軸に置く。

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  cachePreviewImage,
  needsPreviewCache,
  pickPreviewSource,
  loadPreviewImageByRef,
  clearPreviewImageCache,
  MAX_PREVIEW_DATA_URL_LENGTH,
  MAX_PREVIEW_SOURCE_BYTES,
  PREVIEW_RETRY_COOLDOWN_MS,
  type CachePreviewDeps,
} from "./preview-image";
import type { MediaIndexEntry } from "./media-index";
import { getActiveProvider } from "../../lib/storage/registry";

vi.mock("../../lib/storage/registry", () => ({
  getActiveProvider: vi.fn(),
}));

const FILE_ID = "url_1730000000000_abc123";
const KEY = "preview_url_1730000000000_abc123";
const REF = `media-text:${KEY}`;
const DATA_URL = "data:image/webp;base64,UklGRg==";

function urlEntry(urlMeta: Partial<MediaIndexEntry["urlMeta"]> = {}): MediaIndexEntry {
  return {
    fileId: FILE_ID,
    name: "Example",
    type: "url",
    mimeType: "text/x-uri",
    url: "https://example.com/article",
    thumbnailUrl: "https://example.com/favicon.ico",
    uploadedAt: "2026-01-01T00:00:00.000Z",
    usedIn: [],
    urlMeta: { domain: "example.com", ...urlMeta } as MediaIndexEntry["urlMeta"],
  };
}

/** 画像 Blob の代わり（jsdom を使わないので Blob の最小互換オブジェクトで足りる） */
function fakeBlob(type: string, size = 1024): Blob {
  return { type, size } as Blob;
}

function makeDeps(over: Partial<CachePreviewDeps> = {}): CachePreviewDeps & {
  patched: { fileId: string; patch: Record<string, unknown> }[];
  saved: { key: string; dataUrl: string }[];
} {
  const patched: { fileId: string; patch: Record<string, unknown> }[] = [];
  const saved: { key: string; dataUrl: string }[] = [];
  const deps = {
    fetchImage: vi.fn(async () => fakeBlob("image/png")),
    // 実体は createImageBitmap + canvas なので、node 環境のテストでは差し込む
    encode: vi.fn(async () => DATA_URL),
    saveText: async (key: string, dataUrl: string) => {
      saved.push({ key, dataUrl });
    },
    patch: async (fileId: string, patch: Record<string, unknown>) => {
      patched.push({ fileId, patch });
      return true;
    },
    now: () => "2026-07-29T00:00:00.000Z",
    ...over,
    patched,
    saved,
  } as unknown as CachePreviewDeps & { patched: typeof patched; saved: typeof saved };
  return deps;
}

describe("pickPreviewSource（キャッシュ元の選び方）", () => {
  it("leadImage を og:image より優先する", () => {
    expect(
      pickPreviewSource({
        domain: "example.com",
        leadImage: "https://cdn.example.net/lead.png",
        ogImage: "https://cdn.example.net/og.png",
      }),
    ).toBe("https://cdn.example.net/lead.png");
  });

  it("http(s) 以外は取らない（javascript: / data: / 相対 URL）", () => {
    expect(pickPreviewSource({ domain: "e", ogImage: "javascript:alert(1)" })).toBeNull();
    expect(pickPreviewSource({ domain: "e", ogImage: "data:image/png;base64,AA==" })).toBeNull();
    // fetchUrlMetadata は og:image を絶対化しないので相対値が普通に来る
    expect(pickPreviewSource({ domain: "e", ogImage: "/img/og.png" })).toBeNull();
    expect(pickPreviewSource({ domain: "e" })).toBeNull();
    expect(pickPreviewSource(undefined)).toBeNull();
  });
});

describe("needsPreviewCache（同期判定・ネットワークに触らない）", () => {
  it("URL 以外の素材は対象外", () => {
    const img = { ...urlEntry({ ogImage: "https://cdn.example.net/og.png" }), type: "image" as const };
    expect(needsPreviewCache(img)).toBe(false);
  });

  it("既にローカルキャッシュがあれば取り直さない", () => {
    expect(
      needsPreviewCache(urlEntry({ ogImage: "https://cdn.example.net/og.png", previewImage: REF })),
    ).toBe(false);
  });

  it("直近に失敗していればクールダウン中は試さない", () => {
    const now = Date.parse("2026-07-29T00:00:00.000Z");
    const entry = urlEntry({
      ogImage: "https://cdn.example.net/og.png",
      previewImageAt: new Date(now - 1000).toISOString(),
    });
    expect(needsPreviewCache(entry, now)).toBe(false);
    // クールダウンを過ぎれば再挑戦する
    expect(needsPreviewCache(entry, now + PREVIEW_RETRY_COOLDOWN_MS + 1)).toBe(true);
    // 取得元が変わったときは明示的にクールダウンを開ける
    expect(needsPreviewCache(entry, now, { ignoreCooldown: true })).toBe(true);
  });

  it("キーに使えない fileId のエントリは諦める（パス組み立てを壊さない）", () => {
    const adhoc = {
      ...urlEntry({ ogImage: "https://cdn.example.net/og.png" }),
      fileId: "url:https://example.com/article",
    };
    expect(needsPreviewCache(adhoc)).toBe(false);
  });
});

describe("cachePreviewImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPreviewImageCache();
  });

  it("成功時は data URL を media-text に保存し、ローカル参照だけを書き戻す", async () => {
    const deps = makeDeps();
    const result = await cachePreviewImage(
      urlEntry({ ogImage: "https://cdn.example.net/og.png" }),
      deps,
    );
    expect(result).toBe("cached");
    expect(deps.saved).toEqual([{ key: KEY, dataUrl: DATA_URL }]);
    expect(deps.patched).toEqual([
      { fileId: FILE_ID, patch: { previewImage: REF, previewImageAt: "2026-07-29T00:00:00.000Z" } },
    ]);
  });

  it("保存先チャネルが無ければ取得もしない（web 静的配信）", async () => {
    // ここで previewImageAt を書いてしまうと、同じデータを開いたデスクトップ版が
    // クールダウンに阻まれて取得できなくなる
    const deps = makeDeps({ saveText: null });
    const result = await cachePreviewImage(
      urlEntry({ ogImage: "https://cdn.example.net/og.png" }),
      deps,
    );
    expect(result).toBe("skipped");
    expect(deps.fetchImage).not.toHaveBeenCalled();
    expect(deps.patched).toEqual([]);
  });

  it("プロキシが画像を返さなければ（404 / 415 / タイムアウト）試行だけ記録する", async () => {
    const deps = makeDeps({ fetchImage: vi.fn(async () => null) });
    const result = await cachePreviewImage(
      urlEntry({ ogImage: "https://cdn.example.net/og.png" }),
      deps,
    );
    expect(result).toBe("failed");
    expect(deps.saved).toEqual([]);
    expect(deps.patched).toEqual([
      { fileId: FILE_ID, patch: { previewImageAt: "2026-07-29T00:00:00.000Z" } },
    ]);
  });

  it("image/* でない応答は保存しない", async () => {
    const deps = makeDeps({ fetchImage: vi.fn(async () => fakeBlob("text/html")) });
    expect(
      await cachePreviewImage(urlEntry({ ogImage: "https://cdn.example.net/og.png" }), deps),
    ).toBe("failed");
    expect(deps.saved).toEqual([]);
  });

  it("元画像が大きすぎればデコードもしない", async () => {
    const encode = vi.fn(async () => DATA_URL);
    const deps = makeDeps({
      fetchImage: vi.fn(async () => fakeBlob("image/png", MAX_PREVIEW_SOURCE_BYTES + 1)),
      encode,
    });
    expect(
      await cachePreviewImage(urlEntry({ ogImage: "https://cdn.example.net/og.png" }), deps),
    ).toBe("failed");
    expect(encode).not.toHaveBeenCalled();
  });

  it("エンコード後に上限を超える data URL は捨てる（ディスク増幅を止める）", async () => {
    const huge = `data:image/webp;base64,${"A".repeat(MAX_PREVIEW_DATA_URL_LENGTH)}`;
    const deps = makeDeps({ encode: vi.fn(async () => huge) });
    expect(
      await cachePreviewImage(urlEntry({ ogImage: "https://cdn.example.net/og.png" }), deps),
    ).toBe("failed");
    expect(deps.saved).toEqual([]);
  });

  it("エンコードできない画像（SVG・canvas 非対応環境）も remote URL には落ちない", async () => {
    const deps = makeDeps({ encode: vi.fn(async () => null) });
    expect(
      await cachePreviewImage(urlEntry({ ogImage: "https://cdn.example.net/og.png" }), deps),
    ).toBe("failed");
    expect(deps.saved).toEqual([]);
  });

  it("どの失敗経路でも previewImage に remote URL は絶対に入らない", async () => {
    const failures: Partial<CachePreviewDeps>[] = [
      { fetchImage: vi.fn(async () => null) },
      { fetchImage: vi.fn(async () => fakeBlob("text/html")) },
      { encode: vi.fn(async () => null) },
      { encode: vi.fn(async () => "https://cdn.example.net/og.png") },
      {
        fetchImage: vi.fn(async () => {
          throw new Error("network");
        }),
      },
      {
        saveText: async () => {
          throw new Error("disk full");
        },
      },
    ];
    for (const over of failures) {
      const deps = makeDeps(over);
      await cachePreviewImage(
        urlEntry({
          ogImage: "https://cdn.example.net/og.png",
          leadImage: "https://tracker.example/px.png?v=visitor",
        }),
        deps,
      );
      for (const { patch } of deps.patched) {
        expect(patch.previewImage).toBeUndefined();
      }
    }
  });

  it("index への反映に失敗したら 1 度だけ入れ直す（登録直後の保存レース）", async () => {
    let calls = 0;
    const deps = makeDeps({
      patch: async () => {
        calls += 1;
        return calls > 1;
      },
    });
    expect(
      await cachePreviewImage(urlEntry({ ogImage: "https://cdn.example.net/og.png" }), deps),
    ).toBe("cached");
    expect(calls).toBe(2);
  });
});

describe("loadPreviewImageByRef（描画側・ネットワークに出ない）", () => {
  const provider = { loadMediaText: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    clearPreviewImageCache();
    (getActiveProvider as any).mockReturnValue(provider);
  });

  it("ローカル参照なら media-text の data URL を返す", async () => {
    provider.loadMediaText.mockResolvedValue(DATA_URL);
    expect(await loadPreviewImageByRef(REF)).toBe(DATA_URL);
    expect(provider.loadMediaText).toHaveBeenCalledWith(KEY);
  });

  it("remote URL の参照はプロバイダを叩かずに null", async () => {
    for (const bad of ["https://cdn.example.net/og.png", "//cdn.example.net/og.png", "", undefined]) {
      expect(await loadPreviewImageByRef(bad)).toBeNull();
    }
    expect(provider.loadMediaText).not.toHaveBeenCalled();
  });

  it("保存されている値が data:image/ で始まらなければ描画しない", async () => {
    // media-text は URL Reader の原文とチャネルを共有するので、
    // 取り違えたテキストや細工された値をそのまま <img src> に流さない
    for (const stored of ["https://cdn.example.net/og.png", "hello", "data:text/html,<b>", ""]) {
      clearPreviewImageCache();
      provider.loadMediaText.mockResolvedValue(stored);
      expect(await loadPreviewImageByRef(REF)).toBeNull();
    }
  });

  it("2 回目以降はキャッシュから返す（ギャラリーの再描画で毎回 IPC しない）", async () => {
    provider.loadMediaText.mockResolvedValue(DATA_URL);
    await loadPreviewImageByRef(REF);
    await loadPreviewImageByRef(REF);
    expect(provider.loadMediaText).toHaveBeenCalledTimes(1);
  });

  it("プロバイダが media-text を実装していなければ null", async () => {
    (getActiveProvider as any).mockReturnValue({});
    expect(await loadPreviewImageByRef(REF)).toBeNull();
  });
});
