import { describe, it, expect, beforeEach, vi } from "vitest";

// appdata の読み書きはモックする（ストレージプロバイダに触らせない）
const readMock = vi.fn();
const writeMock = vi.fn();
vi.mock("../../lib/storage/app-data-file", () => ({
  readAppDataFile: (...args: unknown[]) => readMock(...args),
  writeAppDataFile: (...args: unknown[]) => writeMock(...args),
}));
vi.mock("../../lib/storage/registry", () => ({
  getActiveProvider: () => ({}) as never,
}));

import {
  FOLDER_DEFS_VERSION,
  addFolderDefinition,
  clearFolderDefinitionsCache,
  ensureFolderDefinitions,
  removeFolderDefinition,
} from "./folder-store";

beforeEach(() => {
  readMock.mockReset();
  writeMock.mockReset();
  writeMock.mockResolvedValue(undefined);
  clearFolderDefinitionsCache();
});

describe("読み込み", () => {
  it("保存済みの定義を読み出せる", async () => {
    readMock.mockResolvedValue({ version: FOLDER_DEFS_VERSION, folders: ["プロジェクトB", "下書き"] });
    expect(await ensureFolderDefinitions()).toEqual(["プロジェクトB", "下書き"]);
  });

  it("版違い・壊れたファイルは空として扱う（空フォルダは失っても軽傷）", async () => {
    readMock.mockResolvedValue({ version: FOLDER_DEFS_VERSION + 1, folders: ["x"] });
    expect(await ensureFolderDefinitions()).toEqual([]);
    clearFolderDefinitionsCache();
    readMock.mockResolvedValue({ version: FOLDER_DEFS_VERSION, folders: [1, "ok", null] });
    expect(await ensureFolderDefinitions()).toEqual(["ok"]);
    clearFolderDefinitionsCache();
    readMock.mockRejectedValue(new Error("read failed"));
    expect(await ensureFolderDefinitions()).toEqual([]);
  });

  it("読み込み失敗はキャッシュを確定せず、次の呼び出しで再試行する（起動直後のプロバイダ未初期化対策）", async () => {
    readMock.mockRejectedValueOnce(new Error("provider not ready"));
    expect(await ensureFolderDefinitions()).toEqual([]);
    readMock.mockResolvedValue({ version: FOLDER_DEFS_VERSION, folders: ["プロジェクトB"] });
    expect(await ensureFolderDefinitions()).toEqual(["プロジェクトB"]);
  });
});

describe("追加", () => {
  it("追加すると保存され、一覧に反映される", async () => {
    readMock.mockResolvedValue(null);
    const result = await addFolderDefinition("プロジェクトB/構想");
    expect(result).toEqual(["プロジェクトB/構想"]);
    expect(writeMock).toHaveBeenCalledTimes(1);
    expect(writeMock.mock.calls[0][2]).toEqual({
      version: FOLDER_DEFS_VERSION,
      folders: ["プロジェクトB/構想"],
    });
  });

  it("小文字比較の既存は追加しない（保存も走らない）", async () => {
    readMock.mockResolvedValue({ version: FOLDER_DEFS_VERSION, folders: ["Eureco"] });
    const result = await addFolderDefinition("eureco");
    expect(result).toEqual(["Eureco"]);
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("書き込みに失敗してもメモリ上は追加済み（セッション中は見える）", async () => {
    readMock.mockResolvedValue(null);
    writeMock.mockRejectedValue(new Error("write failed"));
    expect(await addFolderDefinition("下書き")).toEqual(["下書き"]);
    expect(await ensureFolderDefinitions()).toEqual(["下書き"]);
  });
});

describe("削除", () => {
  it("小文字比較で除いて保存する", async () => {
    readMock.mockResolvedValue({ version: FOLDER_DEFS_VERSION, folders: ["Eureco", "下書き"] });
    const result = await removeFolderDefinition("eureco");
    expect(result).toEqual(["下書き"]);
    expect(writeMock).toHaveBeenCalledTimes(1);
  });

  it("無いものを除いても何も起きない", async () => {
    readMock.mockResolvedValue({ version: FOLDER_DEFS_VERSION, folders: ["下書き"] });
    expect(await removeFolderDefinition("存在しない")).toEqual(["下書き"]);
    expect(writeMock).not.toHaveBeenCalled();
  });
});
