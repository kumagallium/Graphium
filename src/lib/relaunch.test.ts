// @vitest-environment jsdom
// relaunchApp のテスト。
// 要点は「macOS で relaunch() を直に呼ばないこと」。ここが崩れると、アップデート
// 直後の初回起動だけ書類フォルダが読めなくなる回帰に戻る（relaunch.ts のコメント参照）。

import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
const relaunchMock = vi.hoisted(() => vi.fn());
const isTauriMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: relaunchMock }));
vi.mock("./platform", () => ({ isTauri: isTauriMock }));

import { relaunchApp } from "./relaunch";

describe("relaunchApp", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    relaunchMock.mockReset();
    isTauriMock.mockReset();
    isTauriMock.mockReturnValue(true);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("デスクトップでは launchd 経由のコマンドを呼び、relaunch() には落ちない", async () => {
    invokeMock.mockResolvedValue(undefined);

    await relaunchApp();

    expect(invokeMock).toHaveBeenCalledWith("relaunch_via_launchd");
    expect(relaunchMock).not.toHaveBeenCalled();
  });

  it("macOS 以外やバンドル外実行で失敗したら relaunch() に切り替える", async () => {
    invokeMock.mockRejectedValue("launchd 経由の再起動は macOS 専用です");

    await relaunchApp();

    expect(invokeMock).toHaveBeenCalledWith("relaunch_via_launchd");
    expect(relaunchMock).toHaveBeenCalledTimes(1);
  });

  it("Web 版では Tauri のコマンドを呼ばずリロードする", async () => {
    isTauriMock.mockReturnValue(false);
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });

    await relaunchApp();

    expect(invokeMock).not.toHaveBeenCalled();
    expect(relaunchMock).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
