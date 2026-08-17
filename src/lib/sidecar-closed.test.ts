// sidecar-closed（Rust から届く「子プロセスが終了した」通知）の状態遷移。
//
// 不変条件:
// - ready 中の closed だけが「予期せぬ終了」= failed + unexpectedExit
// - それ以外の状態で届いた closed は無視する。特に starting 中: 起動時に Rust が
//   前の子を kill してから spawn するので、必ず 1 回 closed が飛んでくる。これを
//   予期せぬ終了と誤判定すると、起動のたびにバナーが一瞬出る。

import { describe, it, expect } from "vitest";
import { reduceSidecarClosed, type SidecarState } from "./sidecar";
import { shouldShowBackendDownBanner } from "../components/BackendDownBanner";

const base = (status: SidecarState["status"]): SidecarState => ({
  status,
  lastError: null,
  lastErrorAt: null,
  unexpectedExit: false,
});

describe("reduceSidecarClosed", () => {
  it("ready 中の closed → failed + unexpectedExit + 終了情報を lastError に", () => {
    const next = reduceSidecarClosed(base("ready"), "exit code=None success=false", 1234);
    expect(next.status).toBe("failed");
    expect(next.unexpectedExit).toBe(true);
    expect(next.lastError).toBe("exit code=None success=false");
    expect(next.lastErrorAt).toBe(1234);
  });

  it("starting 中の closed は無視（起動時の入れ替えで必ず 1 回来る）", () => {
    const cur = base("starting");
    expect(reduceSidecarClosed(cur, "exit code=None success=false", 1)).toBe(cur);
  });

  it("idle 中の closed は無視（自分で止めた後）", () => {
    const cur = base("idle");
    expect(reduceSidecarClosed(cur, "exit code=Some(0)", 1)).toBe(cur);
  });

  it("failed 中の closed は無視（既に失敗扱い。上書きしない）", () => {
    const cur: SidecarState = { ...base("failed"), lastError: "first", lastErrorAt: 10 };
    const next = reduceSidecarClosed(cur, "second", 20);
    expect(next).toBe(cur);
    expect(next.lastError).toBe("first");
  });

  it("入力を破壊しない", () => {
    const cur = base("ready");
    const snapshot = { ...cur };
    reduceSidecarClosed(cur, "x", 1);
    expect(cur).toEqual(snapshot);
  });
});

describe("shouldShowBackendDownBanner", () => {
  it("failed かつ unexpectedExit のときだけ出す", () => {
    expect(shouldShowBackendDownBanner({ status: "failed", unexpectedExit: true })).toBe(true);
  });

  it("起動失敗（failed だが unexpectedExit でない）は出さない — 設定画面の領分", () => {
    expect(shouldShowBackendDownBanner({ status: "failed", unexpectedExit: false })).toBe(false);
  });

  it("ready / starting / idle では出さない", () => {
    for (const status of ["ready", "starting", "idle"] as const) {
      expect(shouldShowBackendDownBanner({ status, unexpectedExit: true })).toBe(false);
    }
  });
});
