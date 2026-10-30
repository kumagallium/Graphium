// resolveBlockMaterial（素材ブロック → 素材の索引項目）の挙動を担保する。
//
// 不変条件:
// - 対象は image / video / pdf だけ（audio / file / bookmark などは引かない）
// - 3 つのプロバイダのスキーム（local-media / file-media / media-server と旧 lh3 URL）から引ける
// - 素材に引けないもの（外部 URL・shared-blob:・別プロバイダのスキーム・索引に無い・url が空・
//   プロバイダ未設定）は null
// - 同じ素材を 2 回貼っても、ブロックごとに自分の url から同じ素材を引く

import { describe, it, expect } from "vitest";
import { resolveBlockMaterial, collectMaterialBlocks, MEMO_ANCHOR_BLOCK_TYPES } from "./block-material";
import type { MediaIndex, MediaIndexEntry } from "./media-index";
import { LocalStorageProvider } from "../../lib/storage/providers/local";
import { LocalFilesystemProvider } from "../../lib/storage/providers/filesystem";
import { ServerFilesystemProvider } from "../../lib/storage/providers/server-fs";

function entry(fileId: string, type: MediaIndexEntry["type"] = "image"): MediaIndexEntry {
  return {
    fileId,
    name: `${fileId}.bin`,
    type,
    mimeType: "application/octet-stream",
    url: "",
    thumbnailUrl: "",
    uploadedAt: "2026-10-30T00:00:00.000Z",
    usedIn: [],
  };
}

const INDEX: MediaIndex = {
  version: 10,
  updatedAt: "2026-10-30T00:00:00.000Z",
  media: [entry("img-1"), entry("vid-1", "video"), entry("doc-1", "pdf")],
};

// プロバイダの代役: local-media:// だけ fileId にする
const extract = (url: string) => {
  const m = url.match(/^local-media:\/\/(.+)$/);
  return m ? m[1] : null;
};

describe("resolveBlockMaterial", () => {
  it("image / video / pdf の url から素材を引く", () => {
    expect(resolveBlockMaterial({ type: "image", props: { url: "local-media://img-1" } }, INDEX, extract)?.fileId).toBe("img-1");
    expect(resolveBlockMaterial({ type: "video", props: { url: "local-media://vid-1" } }, INDEX, extract)?.fileId).toBe("vid-1");
    expect(resolveBlockMaterial({ type: "pdf", props: { url: "local-media://doc-1" } }, INDEX, extract)?.fileId).toBe("doc-1");
  });

  it("対象外のブロック型（audio / file / bookmark / paragraph）は引かない", () => {
    for (const type of ["audio", "file", "bookmark", "paragraph"]) {
      expect(MEMO_ANCHOR_BLOCK_TYPES.has(type)).toBe(false);
      expect(resolveBlockMaterial({ type, props: { url: "local-media://img-1" } }, INDEX, extract)).toBeNull();
    }
  });

  it("外部 URL・shared-blob:・別プロバイダのスキームは null", () => {
    for (const url of [
      "https://example.com/a.png",
      "shared-blob:abc",
      "media-server://img-1",
      "file-media://img-1",
    ]) {
      expect(resolveBlockMaterial({ type: "image", props: { url } }, INDEX, extract)).toBeNull();
    }
  });

  it("索引に無い fileId・索引が無い・url が空・props が無いブロックは null", () => {
    expect(resolveBlockMaterial({ type: "image", props: { url: "local-media://nope" } }, INDEX, extract)).toBeNull();
    expect(resolveBlockMaterial({ type: "image", props: { url: "local-media://img-1" } }, null, extract)).toBeNull();
    expect(resolveBlockMaterial({ type: "image", props: { url: "" } }, INDEX, extract)).toBeNull();
    expect(resolveBlockMaterial({ type: "image", props: {} }, INDEX, extract)).toBeNull();
    expect(resolveBlockMaterial({ type: "image" }, INDEX, extract)).toBeNull();
    expect(resolveBlockMaterial(null, INDEX, extract)).toBeNull();
  });

  it("url が文字列でないときは null", () => {
    expect(resolveBlockMaterial({ type: "image", props: { url: 42 } }, INDEX, extract)).toBeNull();
  });

  it("extractFileId が投げても落ちずに null", () => {
    const boom = () => {
      throw new Error("provider not set");
    };
    expect(resolveBlockMaterial({ type: "image", props: { url: "local-media://img-1" } }, INDEX, boom)).toBeNull();
  });

  it("同じ素材を 2 ブロックに貼っても、どちらも同じ素材を引く", () => {
    const a = resolveBlockMaterial({ type: "image", props: { url: "local-media://img-1" } }, INDEX, extract);
    const b = resolveBlockMaterial({ type: "image", props: { url: "local-media://img-1" } }, INDEX, extract);
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  it("索引の引きは find と同じ結果（同じ fileId が複数あれば先頭）で、索引を差し替えれば引き直す", () => {
    const first = entry("dup");
    const second = { ...entry("dup"), name: "second.bin" };
    const idx1: MediaIndex = { ...INDEX, media: [first, second] };
    const block = { type: "image", props: { url: "local-media://dup" } };
    expect(resolveBlockMaterial(block, idx1, extract)).toBe(first);
    const idx2: MediaIndex = { ...INDEX, media: [second] };
    expect(resolveBlockMaterial(block, idx2, extract)).toBe(second);
  });

  describe("collectMaterialBlocks", () => {
    const node = (name: string, attrs: Record<string, unknown>, firstChild?: unknown) => ({ type: { name }, attrs, firstChild });
    const docOf = (...nodes: unknown[]) => ({ descendants: (fn: (n: unknown) => boolean) => nodes.forEach((n) => fn(n)) });

    it("素材ブロックだけを id から引ける形で集める（段落などは含めない）", () => {
      const editor = {
        _tiptapEditor: {
          state: {
            doc: docOf(
              node("blockContainer", { id: "a" }, node("image", { url: "local-media://img-1" })),
              node("blockContainer", { id: "b" }, node("paragraph", {})),
              node("blockContainer", { id: "c" }, node("pdf", { url: "local-media://pdf-1" })),
            ),
          },
        },
      };
      const map = collectMaterialBlocks(editor)!;
      expect([...map.keys()]).toEqual(["a", "c"]);
      expect(map.get("a")).toEqual({ type: "image", props: { url: "local-media://img-1" } });
    });

    it("tiptap が無い・走査が投げるときは null（呼び出し側が getBlock に戻す）", () => {
      expect(collectMaterialBlocks({})).toBeNull();
      expect(collectMaterialBlocks(null)).toBeNull();
      expect(
        collectMaterialBlocks({ _tiptapEditor: { state: { doc: { descendants: () => { throw new Error("x"); } } } } }),
      ).toBeNull();
    });
  });

  describe("実際のプロバイダのスキーム", () => {
    it("ブラウザ保存（local-media://）", () => {
      const p = new LocalStorageProvider();
      expect(resolveBlockMaterial({ type: "image", props: { url: "local-media://img-1" } }, INDEX, (u) => p.extractFileId(u))?.fileId).toBe("img-1");
    });

    it("デスクトップ（file-media://）", () => {
      const p = new LocalFilesystemProvider();
      expect(resolveBlockMaterial({ type: "image", props: { url: "file-media://img-1" } }, INDEX, (u) => p.extractFileId(u))?.fileId).toBe("img-1");
      // 別プロバイダのスキームは引けない
      expect(resolveBlockMaterial({ type: "image", props: { url: "media-server://img-1" } }, INDEX, (u) => p.extractFileId(u))).toBeNull();
    });

    it("サーバー保存（media-server:// と旧 lh3 URL）", () => {
      const p = new ServerFilesystemProvider();
      expect(resolveBlockMaterial({ type: "image", props: { url: "media-server://img-1" } }, INDEX, (u) => p.extractFileId(u))?.fileId).toBe("img-1");
      expect(
        resolveBlockMaterial({ type: "image", props: { url: "https://lh3.googleusercontent.com/d/img-1=s0" } }, INDEX, (u) => p.extractFileId(u))?.fileId,
      ).toBe("img-1");
      expect(resolveBlockMaterial({ type: "image", props: { url: "https://example.com/d/img-1" } }, INDEX, (u) => p.extractFileId(u))).toBeNull();
    });
  });
});
