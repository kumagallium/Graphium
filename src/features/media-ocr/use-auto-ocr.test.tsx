// @vitest-environment jsdom
// useAutoImageOcr（貼付画像の自動 OCR フック）のテスト。
//
// 対象の不変条件（DnD × 大容量 IPC のフリーズ対策で入れた防御 3 点を含む）:
// - ノートを開いた直後の既存画像は OCR しない（既知集合の初期化）
// - 貼付直後に File が預けてあれば URL でなく File を runOcrForImage に渡す
//   （デスクトップの invoke Base64 往復 = 大容量 IPC を跳ばす）
// - ドラッグセッション中はジョブを開始せず、dragend 後に再開する
// - ジョブが失敗（タイムアウト含む）したら empty 扱いで先へ進む
//   （「文字認識中…」トーストが永久に残らない。タイムアウト自体は lib/ocr 側）
//
// runOcrForImage はモック（実 Tesseract には触れない）。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useAutoImageOcr, clearScannedAssets } from "./use-auto-ocr";
import { registerPendingOcrFile, takePendingOcrFile } from "./pending-files";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  runOcrForImage: vi.fn(),
  setEntry: vi.fn(),
  entries: new Map<string, { text: string }>(),
  /** 素材インデックス（fileId → 読み取り済みテキスト）の代役 */
  media: [] as { fileId: string; ocrText?: string }[],
}));

vi.mock("./run-ocr", () => ({ runOcrForImage: h.runOcrForImage }));
// 素材側への写しは別テストの担当（ここでは呼ばれても何もしない）
vi.mock("./mirror-to-media-index", () => ({ mirrorOcrToMediaIndex: vi.fn() }));
vi.mock("../asset-browser/media-index", () => ({
  getLatestMediaIndex: () => ({ media: h.media }),
}));
vi.mock("../../lib/storage/registry", () => ({
  getActiveProvider: () => ({
    extractFileId: (url: string) => url.replace("file-media://", "") || null,
  }),
}));
vi.mock("./store", () => ({
  useMediaOcrStore: () => ({
    setEntry: h.setEntry,
    getEntry: (id: string) => h.entries.get(id),
  }),
}));

function makeEditorRef(imageIds: string[]): { current: any } {
  return {
    current: {
      document: imageIds.map((id) => ({
        id,
        type: "image",
        props: { url: `file-media://${id}` },
        children: [],
      })),
    },
  };
}

/** マイクロタスクを吐き切る（fake timers 中でも安全） */
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  h.runOcrForImage.mockReset();
  h.setEntry.mockReset();
  h.entries.clear();
  h.media = [];
  // 「読み終えた素材」はモジュールシングルトンなのでテストごとに捨てる
  clearScannedAssets();
  // 前のテストが預けた File を掃除（レジストリはモジュールシングルトン）
  for (const id of ["a", "b", "c", "new"]) takePendingOcrFile(`file-media://${id}`);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useAutoImageOcr", () => {
  it("ノートを開いた直後の既存画像は OCR しない", async () => {
    const editorRef = makeEditorRef(["a", "b"]);
    const { result } = renderHook(() =>
      useAutoImageOcr({ editorRef, noteKey: "note-1" }),
    );
    await act(async () => {
      result.current.scan();
      await flush();
    });
    expect(h.runOcrForImage).not.toHaveBeenCalled();
  });

  it("新しく入った画像だけ OCR し、預けた File があれば URL でなく File を渡す", async () => {
    h.runOcrForImage.mockResolvedValue({
      text: "hello",
      confidence: 90,
      lang: "jpn+eng",
      extractedAt: "2026-01-01T00:00:00Z",
    });
    const editorRef = makeEditorRef(["a"]);
    const { result } = renderHook(() =>
      useAutoImageOcr({ editorRef, noteKey: "note-1" }),
    );
    await act(async () => {
      result.current.scan(); // 既知集合を初期化
      await flush();
    });

    const pasted = new File(["x"], "pasted.png", { type: "image/png" });
    registerPendingOcrFile("file-media://new", pasted);
    editorRef.current = makeEditorRef(["a", "new"]).current;

    await act(async () => {
      result.current.scan();
      await flush();
    });

    expect(h.runOcrForImage).toHaveBeenCalledTimes(1);
    // File 実体が渡る（URL 経由の読み戻し = デスクトップの invoke 往復を跳ばす）
    expect(h.runOcrForImage).toHaveBeenCalledWith(pasted);
    expect(h.setEntry).toHaveBeenCalledWith("new", expect.objectContaining({ text: "hello" }));
    // 預けた File は 1 回きりで消費される
    expect(takePendingOcrFile("file-media://new")).toBeUndefined();
  });

  it("File が預けられていない画像は従来どおり URL で OCR する", async () => {
    h.runOcrForImage.mockResolvedValue({
      text: "",
      confidence: 0,
      lang: "jpn+eng",
      extractedAt: "2026-01-01T00:00:00Z",
    });
    const editorRef = makeEditorRef([]);
    const { result } = renderHook(() =>
      useAutoImageOcr({ editorRef, noteKey: "note-1" }),
    );
    await act(async () => {
      result.current.scan();
      await flush();
    });
    editorRef.current = makeEditorRef(["new"]).current;
    await act(async () => {
      result.current.scan();
      await flush();
    });
    expect(h.runOcrForImage).toHaveBeenCalledWith("file-media://new");
  });

  it("ドラッグ中はジョブを開始せず、dragend 後に再開する", async () => {
    h.runOcrForImage.mockResolvedValue({
      text: "t",
      confidence: 90,
      lang: "jpn+eng",
      extractedAt: "2026-01-01T00:00:00Z",
    });
    const editorRef = makeEditorRef([]);
    const { result } = renderHook(() =>
      useAutoImageOcr({ editorRef, noteKey: "note-1" }),
    );
    await act(async () => {
      result.current.scan();
      await flush();
    });

    // ドラッグセッション開始（画像ブロックを掴んだ状態）
    window.dispatchEvent(new Event("dragstart"));

    editorRef.current = makeEditorRef(["new"]).current;
    await act(async () => {
      result.current.scan();
      await flush();
    });
    // ドラッグが続いている間は開始しない（IPC 競合ウィンドウを閉じる）
    expect(h.runOcrForImage).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new Event("dragend"));
      await flush();
    });
    expect(h.runOcrForImage).toHaveBeenCalledTimes(1);
  });

  it("素材側に読み取り済みのテキストがあれば、読み直さず結果だけ写す", async () => {
    h.media = [{ fileId: "new", ocrText: "すでに読んだ文字" }];
    const editorRef = makeEditorRef([]);
    const { result } = renderHook(() =>
      useAutoImageOcr({ editorRef, noteKey: "note-1" }),
    );
    await act(async () => {
      result.current.scan();
      await flush();
    });
    editorRef.current = makeEditorRef(["new"]).current;
    await act(async () => {
      result.current.scan();
      await flush();
    });
    expect(h.runOcrForImage).not.toHaveBeenCalled();
    expect(h.setEntry).toHaveBeenCalledWith(
      "new",
      expect.objectContaining({ text: "すでに読んだ文字" }),
    );
  });

  it("一度読んだ素材は、ブロックが作り直されても読み直さない", async () => {
    // テーブルへの出し入れで画像ブロックは作り直され、id が変わる。文字が無かった
    // 画像でも、そのたびに読み直すと「出し入れごとに文字認識が走る」ことになる
    h.runOcrForImage.mockResolvedValue({
      text: "",
      confidence: 0,
      lang: "jpn+eng",
      extractedAt: "2026-01-01T00:00:00Z",
    });
    const editorRef = makeEditorRef([]);
    const { result } = renderHook(() =>
      useAutoImageOcr({ editorRef, noteKey: "note-1" }),
    );
    await act(async () => {
      result.current.scan();
      await flush();
    });
    editorRef.current = makeEditorRef(["new"]).current;
    await act(async () => {
      result.current.scan();
      await flush();
    });
    expect(h.runOcrForImage).toHaveBeenCalledTimes(1);

    // 同じ素材が別のブロック id で戻ってくる（セルから出した直後の状態）
    editorRef.current = {
      document: [
        { id: "new-again", type: "image", props: { url: "file-media://new" }, children: [] },
      ],
    };
    await act(async () => {
      result.current.scan();
      await flush();
    });
    expect(h.runOcrForImage).toHaveBeenCalledTimes(1);
  });

  it("失敗（タイムアウト含む）したジョブは empty 扱いで先へ進み、トーストが完了する", async () => {
    // 宙吊りの検知（タイムアウト）と worker の作り直しは lib/ocr の recognizeImage が
    // 持つ（ocr.test.ts）。hook から見えるのは「reject された」ことだけ
    let rejectJob: (e: unknown) => void = () => {};
    h.runOcrForImage.mockReturnValue(new Promise((_, rej) => { rejectJob = rej; }));
    const editorRef = makeEditorRef([]);
    const { result } = renderHook(() =>
      useAutoImageOcr({ editorRef, noteKey: "note-1" }),
    );
    await act(async () => {
      result.current.scan();
      await flush();
    });
    editorRef.current = makeEditorRef(["new"]).current;
    await act(async () => {
      result.current.scan();
      await flush();
    });
    expect(result.current.toast).toEqual(expect.objectContaining({ running: 1 }));

    await act(async () => {
      rejectJob(new Error("OCR がタイムアウトしました"));
      await flush();
    });

    // トーストは完了状態（running: 0, empty: 1）になり、永久に残らない
    expect(result.current.toast).toEqual(expect.objectContaining({ running: 0, empty: 1 }));
  });
});
