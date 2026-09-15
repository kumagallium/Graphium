// @vitest-environment jsdom
// holdBackgroundWork のテスト。
// 要点は「処理が重なってもオン/オフが 1 回ずつ、この順で届くこと」。オフが先に
// 届いたり、途中の処理が終わった時点でオフになったりすると、隠れたウィンドウで
// 取り込みがまた止まる回帰に戻る（background-work.ts のコメント参照）。

import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
const isTauriMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("./platform", () => ({ isTauri: isTauriMock }));

import {
  holdBackgroundWork,
  resetBackgroundWorkForTest,
  flushBackgroundWorkForTest,
} from "./background-work";

describe("holdBackgroundWork", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    isTauriMock.mockReset();
    isTauriMock.mockReturnValue(true);
    resetBackgroundWorkForTest();
  });

  it("最初の 1 つでオン、最後の 1 つが終わったらオフにする", async () => {
    const releaseIntake = holdBackgroundWork();
    const releaseOcr = holdBackgroundWork();
    releaseIntake();
    await flushBackgroundWorkForTest();
    expect(invokeMock.mock.calls).toEqual([["set_background_work_active", { active: true }]]);

    releaseOcr();
    await flushBackgroundWorkForTest();
    expect(invokeMock.mock.calls).toEqual([
      ["set_background_work_active", { active: true }],
      ["set_background_work_active", { active: false }],
    ]);
  });

  it("同じ release を 2 回呼んでも 1 回分しか減らさない", async () => {
    const releaseA = holdBackgroundWork();
    const releaseB = holdBackgroundWork();
    releaseA();
    releaseA();
    await flushBackgroundWorkForTest();
    // B がまだ持っているのでオフは送らない
    expect(invokeMock).toHaveBeenCalledTimes(1);
    releaseB();
    await flushBackgroundWorkForTest();
    expect(invokeMock).toHaveBeenLastCalledWith("set_background_work_active", { active: false });
  });

  it("オンの invoke が遅くても、オフは必ずその後に届く", async () => {
    let resolveOn: () => void = () => {};
    invokeMock.mockImplementationOnce(() => new Promise<void>((r) => (resolveOn = r)));
    const release = holdBackgroundWork();
    release();
    await Promise.resolve();
    // オンが終わっていないので、オフはまだ送られていない
    expect(invokeMock).toHaveBeenCalledTimes(1);
    resolveOn();
    await flushBackgroundWorkForTest();
    expect(invokeMock.mock.calls.map((c) => c[1])).toEqual([{ active: true }, { active: false }]);
  });

  it("切り替えに失敗しても投げず、次の切り替えは続けて送る", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    invokeMock.mockRejectedValueOnce("WebView の状態を切り替えられません");
    const release = holdBackgroundWork();
    release();
    await flushBackgroundWorkForTest();
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("Web 版では Tauri のコマンドを呼ばない", async () => {
    isTauriMock.mockReturnValue(false);
    const release = holdBackgroundWork();
    release();
    await flushBackgroundWorkForTest();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
