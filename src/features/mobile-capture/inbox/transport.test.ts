import { describe, it, expect, beforeEach, vi } from "vitest";

// invoke モック（local-folder.test.ts と同じ vi.hoisted パターン）
const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { FolderInbox } from "./transport";

/** バイト列 → base64（Rust inbox_read の返り値を模す）。 */
function toB64(bytes: number[]): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

describe("FolderInbox", () => {
  // 注意: 必ずブロック本体にすること。mockReset() は mock 自身を返すため、
  // アロー関数の暗黙 return で返すと vitest がその返り値をテスト後クリーンアップ関数と
  // みなし、各テスト後に invoke() を引数なしで呼ぶ。throw する mock だと unhandled
  // rejection になって別の失敗として計上される。
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("rejects an empty root", () => {
    expect(() => new FolderInbox("")).toThrow();
    expect(() => new FolderInbox("   ")).toThrow();
  });

  it("listPending passes through the { name, bytes, modifiedAt } items from inbox_list", async () => {
    invokeMock.mockResolvedValue([
      { name: "IMG_1.jpg", bytes: 1234, modifiedAt: "2026-07-24T10:00:00Z" },
      { name: "REC_1.m4a", bytes: 5678 }, // modifiedAt が取れない FS
    ]);
    const inbox = new FolderInbox("/sync/root");
    const refs = await inbox.listPending();
    expect(refs).toEqual([
      { name: "IMG_1.jpg", bytes: 1234, modifiedAt: "2026-07-24T10:00:00Z" },
      { name: "REC_1.m4a", bytes: 5678 },
    ]);
    expect(invokeMock).toHaveBeenCalledWith("inbox_list", { root: "/sync/root" });
  });

  it("fetch decodes base64, prefers the extension mime, and computes a sha256 checksum", async () => {
    const bytes = [0xff, 0xd8, 0xff, 0x00]; // 中身は問わない（拡張子優先を検証）
    invokeMock.mockImplementation(async (cmd: string, args: any) => {
      if (cmd === "inbox_read") {
        expect(args).toEqual({ root: "/sync/root", name: "photo.jpg" });
        return toB64(bytes);
      }
      throw new Error(`unexpected ${cmd}`);
    });
    const inbox = new FolderInbox("/sync/root");
    const bundle = await inbox.fetch({ name: "photo.jpg" });

    expect(bundle.meta.mime).toBe("image/jpeg"); // 拡張子から
    expect(bundle.meta.kind).toBe("image");
    expect(bundle.meta.bytes).toBe(4);
    expect(bundle.meta.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(bundle.meta.id).toBe(bundle.meta.checksum);
    expect(bundle.blob.type).toBe("image/jpeg");
    expect(bundle.blob.size).toBe(4);
  });

  it("fetch falls back to magic-byte sniff for an unknown extension", async () => {
    const png = [0x89, 0x50, 0x4e, 0x47]; // PNG magic
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "inbox_read") return toB64(png);
      throw new Error(`unexpected ${cmd}`);
    });
    const inbox = new FolderInbox("/sync/root");
    const bundle = await inbox.fetch({ name: "capture.bin" }); // 未知拡張子
    expect(bundle.meta.mime).toBe("image/png"); // sniff で判定
    expect(bundle.meta.kind).toBe("image");
  });

  it("markImported invokes inbox_mark_imported with root and name", async () => {
    invokeMock.mockResolvedValue(undefined);
    const inbox = new FolderInbox("/sync/root");
    await inbox.markImported({ name: "photo.jpg" });
    expect(invokeMock).toHaveBeenCalledWith("inbox_mark_imported", {
      root: "/sync/root",
      name: "photo.jpg",
    });
  });
});
