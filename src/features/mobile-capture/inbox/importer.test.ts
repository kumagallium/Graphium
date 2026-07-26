import { describe, it, expect, vi } from "vitest";
import { runInboxImport } from "./importer";
import type { CaptureBundle, CaptureMeta, CaptureRef, InboxTransport } from "./types";

function makeBundle(mime: string, checksum: string): CaptureBundle {
  return {
    blob: new Blob([new Uint8Array([1, 2, 3]) as BlobPart], { type: mime }),
    meta: { id: checksum, checksum, mime, bytes: 3, kind: "image" },
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
