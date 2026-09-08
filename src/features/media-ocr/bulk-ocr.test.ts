// runBulkOcr（一括 OCR 実行器）のテスト
//
// AssetGalleryView の handleBulkOcr から切り出した純関数。runOcrForImage /
// persistOcrTextPatch はモックし、実 Tesseract には触れない。

import { describe, it, expect, vi, beforeEach } from "vitest";
import { OcrTimeoutError } from "../../lib/ocr";

const h = vi.hoisted(() => ({
  runOcrForImage: vi.fn(),
  persistOcrTextPatch: vi.fn(),
}));

vi.mock("./run-ocr", () => ({ runOcrForImage: h.runOcrForImage }));
vi.mock("../asset-browser/media-index", () => ({ persistOcrTextPatch: h.persistOcrTextPatch }));

import { runBulkOcr, BULK_OCR_MAX_CONSECUTIVE_TIMEOUTS } from "./bulk-ocr";

beforeEach(() => {
  h.runOcrForImage.mockReset();
  h.persistOcrTextPatch.mockReset();
});

describe("runBulkOcr", () => {
  it("読み取れた文字数・空・失敗を集計する", async () => {
    h.runOcrForImage
      .mockResolvedValueOnce({ text: "hello world" })
      .mockResolvedValueOnce({ text: "" })
      .mockRejectedValueOnce(new Error("boom"));

    const progresses: unknown[] = [];
    const result = await runBulkOcr(
      [
        { fileId: "a", url: "u-a", name: "a.png" },
        { fileId: "b", url: "u-b", name: "b.png" },
        { fileId: "c", url: "u-c", name: "c.png" },
      ],
      { onProgress: (p) => progresses.push(p) },
    );

    expect(result).toEqual({ running: 0, chars: 10, empty: 1, failed: 1, aborted: false });
    expect(h.persistOcrTextPatch).toHaveBeenCalledTimes(2);
    expect(h.persistOcrTextPatch).toHaveBeenCalledWith("a", "hello world");
    // 進捗が最初（running=total）と各件ごとに流れている
    expect(progresses[0]).toEqual({ running: 3, chars: 0, empty: 0, failed: 0, aborted: false });
    expect(progresses[progresses.length - 1]).toEqual({ running: 0, chars: 10, empty: 1, failed: 1, aborted: false });
  });

  it("1 件失敗しても続行する", async () => {
    h.runOcrForImage
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ text: "ok" });

    const result = await runBulkOcr(
      [
        { fileId: "a", url: "u-a", name: "a.png" },
        { fileId: "b", url: "u-b", name: "b.png" },
      ],
      { onProgress: () => {} },
    );

    expect(h.runOcrForImage).toHaveBeenCalledTimes(2);
    expect(result.failed).toBe(1);
    expect(result.chars).toBe(2);
    expect(result.aborted).toBe(false);
  });

  it("連続タイムアウトで打ち切る", async () => {
    expect(BULK_OCR_MAX_CONSECUTIVE_TIMEOUTS).toBe(2);
    h.runOcrForImage
      .mockRejectedValueOnce(new OcrTimeoutError())
      .mockRejectedValueOnce(new OcrTimeoutError())
      .mockResolvedValueOnce({ text: "unreached" });

    const result = await runBulkOcr(
      [
        { fileId: "a", url: "u-a", name: "a.png" },
        { fileId: "b", url: "u-b", name: "b.png" },
        { fileId: "c", url: "u-c", name: "c.png" },
      ],
      { onProgress: () => {} },
    );

    // 3 件目には進まない（打ち切り）
    expect(h.runOcrForImage).toHaveBeenCalledTimes(2);
    expect(result.aborted).toBe(true);
    expect(result.failed).toBe(2);
  });

  it("タイムアウトが連続しなければ打ち切らない", async () => {
    h.runOcrForImage
      .mockRejectedValueOnce(new OcrTimeoutError())
      .mockResolvedValueOnce({ text: "ok" })
      .mockRejectedValueOnce(new OcrTimeoutError());

    const result = await runBulkOcr(
      [
        { fileId: "a", url: "u-a", name: "a.png" },
        { fileId: "b", url: "u-b", name: "b.png" },
        { fileId: "c", url: "u-c", name: "c.png" },
      ],
      { onProgress: () => {} },
    );

    expect(h.runOcrForImage).toHaveBeenCalledTimes(3);
    expect(result.aborted).toBe(false);
    expect(result.failed).toBe(2);
  });
});
