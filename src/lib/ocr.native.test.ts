// @vitest-environment jsdom
// recognizeImage の振り分け（デスクトップ版の端末内 OCR ↔ Tesseract）のテスト。
//
// - 取得済み → ocr_recognize（Tesseract は起動しない）
// - 未取得 → 取得を 1 回だけ裏で始め、今回は Tesseract
// - 端末内 OCR が失敗 → その回は Tesseract
// - ブラウザ版 → 端末内 OCR には触れず Tesseract
//
// ocr-native と tesseract.js・isTauri はモック（実モデル・実 wasm には触れない）。

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  createWorker: vi.fn(),
  getOcrModelStatus: vi.fn(),
  downloadOcrModel: vi.fn(),
  recognizeNative: vi.fn(),
  tessRecognize: vi.fn(),
}));

vi.mock("./platform", () => ({ isTauri: h.isTauri }));
vi.mock("tesseract.js", () => ({ createWorker: h.createWorker }));
vi.mock("./ocr-native", () => ({
  OCR_MODEL_NOT_DOWNLOADED: "OCR_MODEL_NOT_DOWNLOADED",
  getOcrModelStatus: h.getOcrModelStatus,
  downloadOcrModel: h.downloadOcrModel,
  recognizeNative: h.recognizeNative,
}));

const status = (present: boolean) => ({ name: "pp-ocrv6-small", present, bytes: 0, expectedBytes: 1 });
const blob = () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

async function loadOcr() {
  return await import("./ocr");
}

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  h.isTauri.mockReset().mockReturnValue(true);
  h.getOcrModelStatus.mockReset();
  h.downloadOcrModel.mockReset().mockResolvedValue(undefined);
  h.recognizeNative.mockReset();
  h.tessRecognize.mockReset().mockResolvedValue({ data: { text: " tess ", confidence: 70.2 } });
  h.createWorker.mockReset().mockResolvedValue({ recognize: h.tessRecognize, terminate: vi.fn() });
});

describe("recognizeImage の振り分け", () => {
  it("モデル取得済み → 端末内 OCR で読む（Tesseract は起動しない）", async () => {
    h.getOcrModelStatus.mockResolvedValue(status(true));
    h.recognizeNative.mockResolvedValue({ text: " 焼結 ", confidence: 93, engine: "pp-ocrv6-small" });
    const { recognizeImage } = await loadOcr();

    const r = await recognizeImage(blob());
    expect(r).toEqual({ text: "焼結", confidence: 93, engine: "pp-ocrv6-small" });
    expect(h.recognizeNative).toHaveBeenCalledTimes(1);
    expect(Array.from(h.recognizeNative.mock.calls[0][0] as Uint8Array)).toEqual([1, 2, 3]);
    expect(h.createWorker).not.toHaveBeenCalled();
    expect(h.downloadOcrModel).not.toHaveBeenCalled();
  });

  it("URL（string）は fetch してバイト列にして渡す", async () => {
    h.getOcrModelStatus.mockResolvedValue(status(true));
    h.recognizeNative.mockResolvedValue({ text: "x", confidence: 50, engine: "pp-ocrv6-small" });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob() });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { recognizeImage } = await loadOcr();
      await recognizeImage("blob:abc");
      expect(fetchMock).toHaveBeenCalledWith("blob:abc");
      expect(h.recognizeNative).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("URL の fetch が失敗 → Tesseract に落とす", async () => {
    h.getOcrModelStatus.mockResolvedValue(status(true));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    try {
      const { recognizeImage } = await loadOcr();
      const r = await recognizeImage("blob:gone");
      expect(r).toEqual({ text: "tess", confidence: 70, engine: "tesseract" });
      expect(h.recognizeNative).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("モデル未取得 → 取得を 1 回だけ始め、今回は Tesseract で読む", async () => {
    h.getOcrModelStatus.mockResolvedValue(status(false));
    // 取得が終わらない間に何度 OCR しても、取得は 1 回しか始めない
    let finish: () => void = () => {};
    h.downloadOcrModel.mockReturnValue(new Promise<void>((res) => (finish = res)));
    const { recognizeImage } = await loadOcr();

    const a = await recognizeImage(blob());
    const b = await recognizeImage(blob());
    expect(a.engine).toBe("tesseract");
    expect(b.text).toBe("tess");
    expect(h.recognizeNative).not.toHaveBeenCalled();
    expect(h.downloadOcrModel).toHaveBeenCalledTimes(1);

    // 取得が終われば（成功でも失敗でも）次の OCR で改めて始められる
    finish();
    await new Promise((r) => setTimeout(r, 0));
    await recognizeImage(blob());
    expect(h.downloadOcrModel).toHaveBeenCalledTimes(2);
  });

  it("取得に失敗しても黙って Tesseract で読み、10 分は再試行しない（過ぎたらまた試す）", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      h.getOcrModelStatus.mockResolvedValue(status(false));
      h.downloadOcrModel.mockRejectedValue(new Error("network"));
      const { recognizeImage, OCR_DOWNLOAD_RETRY_MS } = await loadOcr();

      const a = await recognizeImage(blob());
      expect(a.engine).toBe("tesseract");
      await new Promise((r) => setTimeout(r, 0));
      // 一括 OCR のように続けて読んでも、画像ごとに取得を始めない
      await recognizeImage(blob());
      await recognizeImage(blob());
      expect(h.downloadOcrModel).toHaveBeenCalledTimes(1);

      vi.setSystemTime(Date.now() + OCR_DOWNLOAD_RETRY_MS - 1000);
      await recognizeImage(blob());
      expect(h.downloadOcrModel).toHaveBeenCalledTimes(1);

      vi.setSystemTime(Date.now() + 2000);
      await recognizeImage(blob());
      expect(h.downloadOcrModel).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("端末内 OCR の開始と終了で進捗（recognizing text・0 → 1）を知らせる", async () => {
    h.getOcrModelStatus.mockResolvedValue(status(true));
    h.recognizeNative.mockResolvedValue({ text: "x", confidence: 50, engine: "pp-ocrv6-small" });
    const { recognizeImage } = await loadOcr();
    const onProgress = vi.fn();

    await recognizeImage(blob(), { onProgress });
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([
      { status: "recognizing text", progress: 0 },
      { status: "recognizing text", progress: 1 },
    ]);
  });

  it("端末内 OCR が失敗 → その回は Tesseract に落とす", async () => {
    h.getOcrModelStatus.mockResolvedValue(status(true));
    h.recognizeNative.mockRejectedValue("画像を読めません: unsupported format");
    const { recognizeImage } = await loadOcr();

    const r = await recognizeImage(blob());
    expect(r).toEqual({ text: "tess", confidence: 70, engine: "tesseract" });
    expect(h.recognizeNative).toHaveBeenCalledTimes(1);
    expect(h.downloadOcrModel).not.toHaveBeenCalled();
  });

  it("読む直前にモデルが消えていた（OCR_MODEL_NOT_DOWNLOADED）→ Tesseract＋取得を始める", async () => {
    h.getOcrModelStatus.mockResolvedValue(status(true));
    h.recognizeNative.mockRejectedValue("OCR_MODEL_NOT_DOWNLOADED");
    const { recognizeImage } = await loadOcr();

    const r = await recognizeImage(blob());
    expect(r.engine).toBe("tesseract");
    expect(h.downloadOcrModel).toHaveBeenCalledTimes(1);
  });

  it("ブラウザ版 → 端末内 OCR には触れず Tesseract で読む", async () => {
    h.isTauri.mockReturnValue(false);
    const { recognizeImage } = await loadOcr();

    const r = await recognizeImage(blob());
    expect(r).toEqual({ text: "tess", confidence: 70, engine: "tesseract" });
    expect(h.getOcrModelStatus).not.toHaveBeenCalled();
    expect(h.recognizeNative).not.toHaveBeenCalled();
    expect(h.downloadOcrModel).not.toHaveBeenCalled();
  });
});
