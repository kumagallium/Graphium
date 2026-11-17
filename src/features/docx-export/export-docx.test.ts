// export-docx.ts（入口）のユニットテスト

import { describe, it, expect, vi, beforeEach } from "vitest";

const downloadBlob = vi.fn();
vi.mock("../../lib/download-file", () => ({ downloadBlob: (...a: unknown[]) => downloadBlob(...a) }));

import { exportNoteToDocx, buildNoteDocxBlob, DOCX_MIME, bytesToDocxImage, defaultLoadMedia } from "./export-docx";
import { sanitizeFilename } from "../markdown-export/filenames";

const blocks = [{ type: "paragraph", content: [{ type: "text", text: "本文", styles: {} }], children: [] }];

describe("exportNoteToDocx", () => {
  beforeEach(() => downloadBlob.mockReset());

  it("ファイル名は sanitizeFilename(題) + .docx で、MIME は Word のもの", async () => {
    downloadBlob.mockResolvedValue(true);
    const title = 'A/B: "題"?';
    expect(await exportNoteToDocx({ title, blocks })).toBe(true);
    const [blob, name] = downloadBlob.mock.calls[0];
    expect(name).toBe(`${sanitizeFilename(title)}.docx`);
    expect((blob as Blob).type).toBe(DOCX_MIME);
  });

  it("保存がキャンセルされたら false", async () => {
    downloadBlob.mockResolvedValue(false);
    expect(await exportNoteToDocx({ title: "t", blocks })).toBe(false);
  });
});

describe("画像の既定の読み込み", () => {
  it("外部 URL は取りに行かず null", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await defaultLoadMedia("https://example.com/a.png")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("data:image/png は復号して縦横を読む", async () => {
    const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const img = await defaultLoadMedia(`data:image/png;base64,${b64}`);
    expect(img).toMatchObject({ type: "png", width: 1, height: 1 });
  });

  it("読めないバイト列は例外にせず null", async () => {
    expect(await bytesToDocxImage(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(await bytesToDocxImage(undefined)).toBeNull();
  });
});

describe("buildNoteDocxBlob", () => {
  it("題が空でも作れる", async () => {
    const blob = await buildNoteDocxBlob({ title: "", blocks: [] });
    expect(blob.size).toBeGreaterThan(0);
  });
});
