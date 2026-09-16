// ネイティブ走査のテスト。
//
// ここで一番守りたいのは「走査した時点ではファイルを読まない」こと。
// 読んでしまうと、NAS 越しに数千件を先読みすることになり、
// webkitdirectory を置き換えた意味が無くなる。

import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
const openMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => openMock(...args),
}));

import { pickFolderNative, scanFolderNative } from "./native-scan";

const scanned = {
  files: [
    { path: "/Volumes/NAS/work/note.md", relativePath: "work/note.md", name: "note.md", size: 12 },
    { path: "/Volumes/NAS/work/fig.png", relativePath: "work/fig.png", name: "fig.png", size: 34 },
  ],
  truncated: false,
};

beforeEach(() => {
  invokeMock.mockReset();
  openMock.mockReset();
});

describe("scanFolderNative", () => {
  it("Rust の走査結果を IntakeFile に写す（path は相対パス、type は拡張子から）", async () => {
    invokeMock.mockResolvedValueOnce(scanned);

    const { files, truncated } = await scanFolderNative("/Volumes/NAS/work");

    expect(invokeMock).toHaveBeenCalledWith("scan_directory", { root: "/Volumes/NAS/work" });
    expect(truncated).toBe(false);
    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({ path: "work/note.md", name: "note.md", size: 12 });
    // .md は EXTENSION_TO_MIME に無いので空文字。Markdown の判定は
    // classify 側が拡張子（isMarkdownFile）で行うので MIME は要らない
    expect(files[0].type).toBe("");
    expect(files[1].type).toBe("image/png");
  });

  it("走査しただけではファイルを読まない", async () => {
    invokeMock.mockResolvedValueOnce(scanned);

    await scanFolderNative("/Volumes/NAS/work");

    // scan_directory の 1 回だけ。read_scanned_file は呼ばれていない
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls.every(([cmd]) => cmd !== "read_scanned_file")).toBe(true);
  });

  it("getFile() を呼んだときに初めて絶対パスで読み込む", async () => {
    invokeMock.mockResolvedValueOnce(scanned);
    const { files } = await scanFolderNative("/Volumes/NAS/work");

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

    const { truncated } = await scanFolderNative("/Volumes/NAS/work");

    expect(truncated).toBe(true);
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
