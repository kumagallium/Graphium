import { describe, it, expect, vi } from "vitest";
import { runInboxImport } from "./importer";
import { GRAPHIUM_CAPTURE_MIME } from "./capture-file";
import type { CaptureBundle, CaptureMeta, CaptureRef, InboxTransport } from "./types";

function makeBundle(mime: string, checksum: string): CaptureBundle {
  return {
    blob: new Blob([new Uint8Array([1, 2, 3]) as BlobPart], { type: mime }),
    meta: { id: checksum, checksum, mime, bytes: 3, kind: "image" },
  };
}

/** メモ / URL 捕獲ファイル（ネイティブ JSON）のバンドル。 */
function makeCaptureBundle(json: unknown, checksum: string): CaptureBundle {
  const body = JSON.stringify(json);
  return {
    blob: new Blob([body], { type: GRAPHIUM_CAPTURE_MIME }),
    meta: { id: checksum, checksum, mime: GRAPHIUM_CAPTURE_MIME, bytes: body.length },
  };
}

function fakeTransport(bundles: Record<string, CaptureBundle>) {
  const markImported = vi.fn(async (_ref: CaptureRef) => {});
  const transport: InboxTransport = {
    listPending: async () => Object.keys(bundles).map((name) => ({ name })),
    fetch: async (ref) => bundles[ref.name],
    markImported,
  };
  return { transport, markImported };
}

describe("runInboxImport", () => {
  it("imports each pending item, preserving the original file name", async () => {
    const { transport, markImported } = fakeTransport({
      "IMG_1.jpg": makeBundle("image/jpeg", "sha256:aaa"),
      "IMG_2.jpg": makeBundle("image/jpeg", "sha256:bbb"),
    });
    const uploadAsset = vi.fn(
      async (file: File, _options: { capture: CaptureMeta }) => ({
        fileId: `id-${file.name}`,
      }),
    );

    const res = await runInboxImport({ transport, uploadAsset });

    expect(res.imported).toHaveLength(2);
    expect(res.skipped).toHaveLength(0);
    expect(res.failed).toHaveLength(0);

    // File は元のファイル名を保持する（file.type ではなく file.name を検証する）
    const firstFile = uploadAsset.mock.calls[0][0];
    expect(firstFile.name).toBe("IMG_1.jpg");
    expect(firstFile.type).toBe("image/jpeg");

    // capture メタが uploadAsset に渡る
    expect(uploadAsset.mock.calls[0][1]).toEqual({
      capture: expect.objectContaining({ checksum: "sha256:aaa", mime: "image/jpeg" }),
    });

    // 取り込んだものは _imported/ へ退避
    expect(markImported).toHaveBeenCalledTimes(2);
    expect(res.imported[0]).toEqual({
      name: "IMG_1.jpg",
      fileId: "id-IMG_1.jpg",
      checksum: "sha256:aaa",
    });
  });

  it("skips already-imported items (dedup by checksum) without uploading", async () => {
    const { transport, markImported } = fakeTransport({
      "dup.jpg": makeBundle("image/jpeg", "sha256:known"),
    });
    const uploadAsset = vi.fn(async () => ({ fileId: "x" }));

    const res = await runInboxImport({
      transport,
      uploadAsset,
      isAlreadyImported: (c) => c === "sha256:known",
    });

    expect(uploadAsset).not.toHaveBeenCalled();
    expect(res.imported).toHaveLength(0);
    expect(res.skipped).toEqual([
      { name: "dup.jpg", checksum: "sha256:known", reason: "duplicate" },
    ]);
    // skip でも inbox からは退避する（次回列挙で再ヒットしないように）
    expect(markImported).toHaveBeenCalledWith({ name: "dup.jpg" });
  });

  it("imports only the selected refs when `only` is given", async () => {
    const { transport, markImported } = fakeTransport({
      "IMG_1.jpg": makeBundle("image/jpeg", "sha256:aaa"),
      "IMG_2.jpg": makeBundle("image/jpeg", "sha256:bbb"),
      "IMG_3.jpg": makeBundle("image/jpeg", "sha256:ccc"),
    });
    const uploadAsset = vi.fn(
      async (file: File, _options: { capture: CaptureMeta }) => ({
        fileId: `id-${file.name}`,
      }),
    );

    const res = await runInboxImport({
      transport,
      uploadAsset,
      only: [{ name: "IMG_2.jpg" }],
    });

    expect(res.imported.map((i) => i.name)).toEqual(["IMG_2.jpg"]);
    expect(uploadAsset).toHaveBeenCalledTimes(1);
    // 選ばれなかったものは _imported/ へ動かさない（受信箱に残す）
    expect(markImported).toHaveBeenCalledTimes(1);
    expect(markImported).toHaveBeenCalledWith({ name: "IMG_2.jpg" });
  });

  it("ignores selected refs that no longer exist in the inbox", async () => {
    // 選択後にファイルが外部（同期フォルダ）から消えたケース。
    const { transport } = fakeTransport({
      "IMG_1.jpg": makeBundle("image/jpeg", "sha256:aaa"),
    });
    const uploadAsset = vi.fn(async () => ({ fileId: "x" }));

    const res = await runInboxImport({
      transport,
      uploadAsset,
      only: [{ name: "GONE.jpg" }],
    });

    expect(uploadAsset).not.toHaveBeenCalled();
    expect(res.imported).toHaveLength(0);
    expect(res.failed).toHaveLength(0);
  });

  it("imports everything when `only` is omitted (unchanged default)", async () => {
    const { transport } = fakeTransport({
      "A.jpg": makeBundle("image/jpeg", "sha256:a"),
      "B.jpg": makeBundle("image/jpeg", "sha256:b"),
    });
    const uploadAsset = vi.fn(
      async (file: File, _options: { capture: CaptureMeta }) => ({
        fileId: `id-${file.name}`,
      }),
    );

    const res = await runInboxImport({ transport, uploadAsset });

    expect(res.imported.map((i) => i.name)).toEqual(["A.jpg", "B.jpg"]);
  });

  it("collects failures and continues importing the rest", async () => {
    const markImported = vi.fn(async (_ref: CaptureRef) => {});
    const good = makeBundle("image/jpeg", "sha256:ok");
    const transport: InboxTransport = {
      listPending: async () => [{ name: "bad.jpg" }, { name: "good.jpg" }],
      fetch: async (ref) => {
        if (ref.name === "bad.jpg") throw new Error("read failed");
        return good;
      },
      markImported,
    };
    const uploadAsset = vi.fn(
      async (file: File, _options: { capture: CaptureMeta }) => ({
        fileId: `id-${file.name}`,
      }),
    );

    const res = await runInboxImport({ transport, uploadAsset });

    expect(res.failed).toEqual([{ name: "bad.jpg", error: "read failed" }]);
    expect(res.imported).toHaveLength(1);
    expect(res.imported[0].name).toBe("good.jpg");
    // 失敗は退避しない・成功のみ退避
    expect(markImported).toHaveBeenCalledTimes(1);
    expect(markImported).toHaveBeenCalledWith({ name: "good.jpg" });
  });
});

describe("runInboxImport — graphium capture routing (memo / url)", () => {
  const memoName = "graphium-20260727-153000-01-memo.graphium.json";
  const urlName = "graphium-20260727-153000-02-url.graphium.json";
  const memoJson = {
    graphium: 1,
    kind: "memo",
    createdAt: "2026-07-27T06:30:00.000Z",
    text: "queued thought",
  };
  const urlJson = {
    graphium: 1,
    kind: "url",
    createdAt: "2026-07-27T06:31:00.000Z",
    url: "https://example.com/read",
    title: "Example Read",
  };

  it("routes memo/url capture files to their injected handlers, not uploadAsset", async () => {
    const { transport, markImported } = fakeTransport({
      [memoName]: makeCaptureBundle(memoJson, "sha256:memo"),
      [urlName]: makeCaptureBundle(urlJson, "sha256:url"),
      "IMG_1.jpg": makeBundle("image/jpeg", "sha256:img"),
    });
    const uploadAsset = vi.fn(
      async (file: File, _options: { capture: CaptureMeta }) => ({
        fileId: `asset-${file.name}`,
      }),
    );
    const memo = vi.fn(async (_payload: unknown, _ctx: unknown) => ({ fileId: "cap_123" }));
    const url = vi.fn(async (_payload: unknown, _ctx: unknown) => ({ fileId: "url_456" }));

    const res = await runInboxImport({ transport, uploadAsset, handlers: { memo, url } });

    // メモ → memo ハンドラ（パース済みペイロード + 配送メタ）
    expect(memo).toHaveBeenCalledTimes(1);
    expect(memo.mock.calls[0][0]).toEqual(memoJson);
    expect(memo.mock.calls[0][1]).toMatchObject({
      name: memoName,
      meta: expect.objectContaining({ checksum: "sha256:memo" }),
    });
    // URL → url ハンドラ
    expect(url).toHaveBeenCalledTimes(1);
    expect(url.mock.calls[0][0]).toEqual(urlJson);
    // メディアは従来どおり uploadAsset（捕獲ファイルは uploadAsset に流れない）
    expect(uploadAsset).toHaveBeenCalledTimes(1);
    expect(uploadAsset.mock.calls[0][0].name).toBe("IMG_1.jpg");
    // 3 件とも取り込み済み扱いで退避し、結果に kind が付く
    expect(markImported).toHaveBeenCalledTimes(3);
    expect(res.imported).toEqual(
      expect.arrayContaining([
        { name: memoName, fileId: "cap_123", checksum: "sha256:memo", kind: "memo" },
        { name: urlName, fileId: "url_456", checksum: "sha256:url", kind: "url" },
        { name: "IMG_1.jpg", fileId: "asset-IMG_1.jpg", checksum: "sha256:img" },
      ]),
    );
  });

  it("imports capture files as plain assets when no handlers are injected (unchanged callers)", async () => {
    const { transport } = fakeTransport({
      [memoName]: makeCaptureBundle(memoJson, "sha256:memo"),
    });
    const uploadAsset = vi.fn(
      async (file: File, _options: { capture: CaptureMeta }) => ({
        fileId: `asset-${file.name}`,
      }),
    );

    const res = await runInboxImport({ transport, uploadAsset });

    expect(uploadAsset).toHaveBeenCalledTimes(1);
    expect(res.imported[0]).toEqual({
      name: memoName,
      fileId: `asset-${memoName}`,
      checksum: "sha256:memo",
    });
  });

  it("falls back to plain asset import for malformed or unknown-version .graphium.json (no data loss)", async () => {
    const { transport } = fakeTransport({
      // 形状不正（text 欠落）と未知バージョン — どちらも素材として保全する
      "graphium-20260727-153000-01-memo.graphium.json": makeCaptureBundle(
        { graphium: 1, kind: "memo" },
        "sha256:bad",
      ),
      "graphium-20260727-153000-02-memo.graphium.json": makeCaptureBundle(
        { graphium: 99, kind: "memo", text: "future format" },
        "sha256:future",
      ),
    });
    const uploadAsset = vi.fn(
      async (file: File, _options: { capture: CaptureMeta }) => ({
        fileId: `asset-${file.name}`,
      }),
    );
    const memo = vi.fn(async () => ({ fileId: "cap_x" }));

    const res = await runInboxImport({ transport, uploadAsset, handlers: { memo } });

    expect(memo).not.toHaveBeenCalled();
    expect(uploadAsset).toHaveBeenCalledTimes(2);
    expect(res.imported).toHaveLength(2);
    expect(res.imported.every((i) => i.kind === undefined)).toBe(true);
  });

  it("never hijacks a user-placed plain .json (extension gate)", async () => {
    const { transport } = fakeTransport({
      "settings.json": makeCaptureBundle(memoJson, "sha256:plain"),
    });
    const uploadAsset = vi.fn(
      async (file: File, _options: { capture: CaptureMeta }) => ({
        fileId: `asset-${file.name}`,
      }),
    );
    const memo = vi.fn(async () => ({ fileId: "cap_x" }));

    await runInboxImport({ transport, uploadAsset, handlers: { memo } });

    expect(memo).not.toHaveBeenCalled();
    expect(uploadAsset).toHaveBeenCalledTimes(1);
  });

  it("counts a throwing handler as failed and leaves the file in the inbox for retry", async () => {
    const { transport, markImported } = fakeTransport({
      [memoName]: makeCaptureBundle(memoJson, "sha256:memo"),
    });
    const uploadAsset = vi.fn(async () => ({ fileId: "x" }));
    const memo = vi.fn(async () => {
      throw new Error("capture index save failed");
    });

    const res = await runInboxImport({ transport, uploadAsset, handlers: { memo } });

    expect(res.failed).toEqual([{ name: memoName, error: "capture index save failed" }]);
    expect(res.imported).toHaveLength(0);
    // 失敗は退避しない — 次回の取り込みで再試行できる（データを落とさない）
    expect(markImported).not.toHaveBeenCalled();
  });

  it("dedups capture files by checksum like any other item", async () => {
    const { transport, markImported } = fakeTransport({
      [memoName]: makeCaptureBundle(memoJson, "sha256:known"),
    });
    const uploadAsset = vi.fn(async () => ({ fileId: "x" }));
    const memo = vi.fn(async () => ({ fileId: "cap_x" }));

    const res = await runInboxImport({
      transport,
      uploadAsset,
      handlers: { memo },
      isAlreadyImported: (c) => c === "sha256:known",
    });

    expect(memo).not.toHaveBeenCalled();
    expect(res.skipped).toEqual([
      { name: memoName, checksum: "sha256:known", reason: "duplicate" },
    ]);
    expect(markImported).toHaveBeenCalledTimes(1);
  });
});
