// sidecar の health 応答の扱い
//
// 不変条件:
// - 相手が自分の sidecar かは、合言葉を知っている証明で確かめる（api-auth-fetch-tauri.test.ts）。
//   health の dataDir・version は相手の言い値なので、判定に使わない
// - 確かめられなかった相手の応答からは、止める候補の pid だけを取る
// - pid が取れない相手は 0（止められない。spawn に進んで失敗の表示に任せる）

import { describe, it, expect } from "vitest";
import { healthPid } from "./sidecar";

describe("healthPid", () => {
  it("正の整数の pid だけを取り出す", () => {
    expect(healthPid({ status: "healthy", pid: 9, desktop: true })).toBe(9);
    expect(healthPid({ pid: 9, dataDir: "/data/server-data", version: "1.2.3" })).toBe(9);
  });

  it("取れないときは 0", () => {
    for (const body of [null, undefined, "x", {}, { pid: 0 }, { pid: -1 }, { pid: 1.5 }, { pid: "9" }, { pid: Number.NaN }]) {
      expect(healthPid(body)).toBe(0);
    }
  });
});
