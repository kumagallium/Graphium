// ネイティブ走査のテスト。
//
// ここで一番守りたいのは「走査した時点ではファイルを読まない」ことと、
// "intake-scan-progress" の購読が invoke より前に済んでいて、かつ
// 成功・失敗どちらの経路でも確実に解除されること（NAS 越しの長い走査では
// 購読漏れ・解除漏れがそのままリスナーのリークや取りこぼしに直結する）。

import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
const openMock = vi.fn();
const listenMock = vi.fn();
const unlistenMock = vi.fn();
// listen → invoke の順で呼ばれているかを見るための呼び出し順の記録
const callOrder: string[] = [];

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => {
    callOrder.push("invoke");
    return invokeMock(...args);
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => openMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => {
    callOrder.push("listen");
    return listenMock(...args);
  },
}));

import {
  cancelFolderScanNative,
  createFolderScanId,
  pickFolderNative,
  scanFolderNative,
} from "./native-scan";

const scanned = {
  files: [
    { path: "/Volumes/NAS/work/note.md", relativePath: "work/note.md", name: "note.md" },
    { path: "/Volumes/NAS/work/fig.png", relativePath: "work/fig.png", name: "fig.png" },
  ],
  truncated: false,
  cancelled: false,
};

beforeEach(() => {
  invokeMock.mockReset();
  openMock.mockReset();
  listenMock.mockReset();
  unlistenMock.mockReset();
  callOrder.length = 0;
  // 既定では listen は unlisten 関数を返す（イベントは発火しない）
  listenMock.mockResolvedValue(unlistenMock);
});

describe("scanFolderNative", () => {
  it("Rust の走査結果を IntakeFile に写す（path は相対パス、type は拡張子から）。size は持たない", async () => {
    invokeMock.mockResolvedValueOnce(scanned);

    const { files, truncated, cancelled } = await scanFolderNative("/Volumes/NAS/work", {
      scanId: "scan-1",
    });

    expect(invokeMock).toHaveBeenCalledWith("scan_directory", {
      root: "/Volumes/NAS/work",
      scanId: "scan-1",
    });
    expect(truncated).toBe(false);
    expect(cancelled).toBe(false);
    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({ path: "work/note.md", name: "note.md" });
    expect(files[0]).not.toHaveProperty("size");
    // .md は EXTENSION_TO_MIME に無いので空文字。Markdown の判定は
    // classify 側が拡張子（isMarkdownFile）で行うので MIME は要らない
    expect(files[0].type).toBe("");
    expect(files[1].type).toBe("image/png");
  });

  it("走査しただけではファイルを読まない", async () => {
    invokeMock.mockResolvedValueOnce(scanned);

    await scanFolderNative("/Volumes/NAS/work", { scanId: "scan-1" });

    // scan_directory の 1 回だけ。read_scanned_file は呼ばれていない
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls.every(([cmd]) => cmd !== "read_scanned_file")).toBe(true);
  });

  it("getFile() を呼んだときに初めて絶対パスで読み込む", async () => {
    invokeMock.mockResolvedValueOnce(scanned);
    const { files } = await scanFolderNative("/Volumes/NAS/work", { scanId: "scan-1" });

    // Rust は生バイト（ArrayBuffer）で返す
    invokeMock.mockResolvedValueOnce(new TextEncoder().encode("hello").buffer);
    const file = await files[0].getFile();

    expect(invokeMock).toHaveBeenLastCalledWith("read_scanned_file", {
      path: "/Volumes/NAS/work/note.md",
    });
    expect(file.name).toBe("note.md");
    expect(file.type).toBe("");
    await expect(file.text()).resolves.toBe("hello");
  });

  it("上限で打ち切られたことをそのまま返す", async () => {
    invokeMock.mockResolvedValueOnce({ ...scanned, truncated: true });

    const { truncated } = await scanFolderNative("/Volumes/NAS/work", { scanId: "scan-1" });

    expect(truncated).toBe(true);
  });

  it("cancelled をそのまま返す", async () => {
    invokeMock.mockResolvedValueOnce({ ...scanned, cancelled: true, files: [] });

    const { cancelled, files } = await scanFolderNative("/Volumes/NAS/work", { scanId: "scan-1" });

    expect(cancelled).toBe(true);
    expect(files).toHaveLength(0);
  });

  it("intake-scan-progress の購読を invoke より前に済ませる", async () => {
    invokeMock.mockResolvedValueOnce(scanned);

    await scanFolderNative("/Volumes/NAS/work", { scanId: "scan-1" });

    expect(listenMock).toHaveBeenCalledWith("intake-scan-progress", expect.any(Function));
    expect(callOrder).toEqual(["listen", "invoke"]);
  });

  it("イベントの found / folders を onProgress にそのまま渡す", async () => {
    let handler:
      | ((event: { payload: { scanId: string; found: number; folders: number } }) => void)
      | undefined;
    listenMock.mockImplementationOnce((_event: string, cb: typeof handler) => {
      handler = cb;
      return Promise.resolve(unlistenMock);
    });
    invokeMock.mockImplementationOnce(async () => {
      // Rust 側は走査完了より前にイベントを発火しうる。購読が invoke 前に
      // 済んでいなければここで取りこぼす
      handler?.({ payload: { scanId: "scan-1", found: 128, folders: 12 } });
      return scanned;
    });
    const onProgress = vi.fn();

    await scanFolderNative("/Volumes/NAS/work", { scanId: "scan-1", onProgress });

    expect(onProgress).toHaveBeenCalledWith({ found: 128, folders: 12 });
  });

  it("別の scanId の進捗イベントは onProgress に渡らない（並行走査の混線防止）", async () => {
    let handler:
      | ((event: { payload: { scanId: string; found: number; folders: number } }) => void)
      | undefined;
    listenMock.mockImplementationOnce((_event: string, cb: typeof handler) => {
      handler = cb;
      return Promise.resolve(unlistenMock);
    });
    invokeMock.mockImplementationOnce(async () => {
      // 別インスタンスが並行して走らせている走査（別の scanId）のイベント
      handler?.({ payload: { scanId: "other-scan", found: 999, folders: 30 } });
      return scanned;
    });
    const onProgress = vi.fn();

    await scanFolderNative("/Volumes/NAS/work", { scanId: "scan-1", onProgress });

    expect(onProgress).not.toHaveBeenCalled();
  });

  it("走査を終えたら購読を解除する", async () => {
    invokeMock.mockResolvedValueOnce(scanned);

    await scanFolderNative("/Volumes/NAS/work", { scanId: "scan-1" });

    expect(unlistenMock).toHaveBeenCalledTimes(1);
  });

  it("invoke が失敗しても購読を解除する", async () => {
    invokeMock.mockRejectedValueOnce(new Error("scan failed"));

    await expect(
      scanFolderNative("/Volumes/NAS/work", { scanId: "scan-1" }),
    ).rejects.toThrow("scan failed");

    expect(unlistenMock).toHaveBeenCalledTimes(1);
  });
});

describe("cancelFolderScanNative", () => {
  it("cancel_scan を scanId 付きで呼ぶ", async () => {
    invokeMock.mockResolvedValueOnce(undefined);

    await cancelFolderScanNative("scan-1");

    expect(invokeMock).toHaveBeenCalledWith("cancel_scan", { scanId: "scan-1" });
  });
});

describe("createFolderScanId", () => {
  it("呼ぶたびに異なる値を返す", () => {
    const first = createFolderScanId();
    const second = createFolderScanId();

    expect(first).not.toBe(second);
    expect(typeof first).toBe("string");
    expect(first.length).toBeGreaterThan(0);
  });
});

describe("pickFolderNative", () => {
  it("選ばれたフォルダのパスを返す", async () => {
    openMock.mockResolvedValueOnce("/Volumes/NAS/work");
    await expect(pickFolderNative()).resolves.toBe("/Volumes/NAS/work");
    expect(openMock).toHaveBeenCalledWith({ directory: true, multiple: false });
  });

  it("キャンセルされたら null", async () => {
    openMock.mockResolvedValueOnce(null);
    await expect(pickFolderNative()).resolves.toBeNull();
  });

  it("配列で返ってきても先頭を取る", async () => {
    openMock.mockResolvedValueOnce(["/Volumes/NAS/work"]);
    await expect(pickFolderNative()).resolves.toBe("/Volumes/NAS/work");
  });
});
