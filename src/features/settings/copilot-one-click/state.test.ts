import { describe, expect, it } from "vitest";
import type { CopilotStatus } from "./api";
import { installPercent, needsPolling, reducer, type Phase } from "./state";

const base: CopilotStatus = {
  cli: "missing",
  source: null,
  installable: true,
  install: null,
  installError: null,
  login: { state: "idle", mode: null, verificationUri: null, userCode: null, error: null },
};
const st = (p: Partial<CopilotStatus>): CopilotStatus => ({ ...base, ...p });

describe("copilot-one-click reducer", () => {
  it("init: 何も無ければ idle、取得不可なら unavailable", () => {
    expect(reducer({ kind: "loading" }, { type: "init", status: base })).toEqual({ kind: "idle" });
    expect(reducer({ kind: "loading" }, { type: "init", status: st({ installable: false }) })).toEqual({ kind: "unavailable" });
    expect(reducer({ kind: "loading" }, { type: "init", status: null })).toEqual({ kind: "unavailable" });
  });

  it("init: CLI が使えるなら installable が false でも idle", () => {
    expect(reducer({ kind: "loading" }, { type: "init", status: st({ cli: "ready", installable: false }) })).toEqual({ kind: "idle" });
  });

  it("init: 裏で続いている取得・承認待ちを復元する", () => {
    expect(
      reducer({ kind: "loading" }, { type: "init", status: st({ cli: "installing", install: { received: 5, total: 10 } }) }),
    ).toEqual({ kind: "installing", received: 5, total: 10, seen: true });
    const waiting = st({
      cli: "ready",
      login: { state: "waiting", mode: "device", verificationUri: "https://github.com/login/device", userCode: "ABCD-1234", error: null },
    });
    expect(reducer({ kind: "loading" }, { type: "init", status: waiting })).toEqual({
      kind: "login",
      mode: "device",
      verificationUri: "https://github.com/login/device",
      userCode: "ABCD-1234",
    });
  });

  it("init: loading 以外では上書きしない", () => {
    expect(reducer({ kind: "idle" }, { type: "init", status: st({ installable: false }) })).toEqual({ kind: "idle" });
  });

  it("prepared: ready は確認へ、missing は取得へ、非対応はエラー", () => {
    const p: Phase = { kind: "preparing" };
    expect(reducer(p, { type: "prepared", status: st({ cli: "ready" }) })).toEqual({ kind: "verifying", afterLogin: false });
    expect(reducer(p, { type: "prepared", status: base })).toEqual({ kind: "installing", received: 0, total: 0, seen: false });
    expect(reducer(p, { type: "prepared", status: st({ installable: false }) })).toMatchObject({
      kind: "installError",
      code: "COPILOT_CLI_UNSUPPORTED_PLATFORM",
    });
  });

  it("status(installing): 進捗更新 → ready で確認へ、失敗はエラー", () => {
    const p: Phase = { kind: "installing", received: 0, total: 0, seen: false };
    expect(reducer(p, { type: "status", status: st({ cli: "installing", install: { received: 42, total: 100 } }) })).toEqual({
      kind: "installing",
      received: 42,
      total: 100,
      seen: true,
    });
    expect(reducer(p, { type: "status", status: st({ cli: "ready" }) })).toEqual({ kind: "verifying", afterLogin: false });
    expect(reducer(p, { type: "status", status: st({ installError: "boom" }) })).toEqual({
      kind: "installError",
      code: null,
      message: "boom",
    });
    // 開始直後の遅れ（取得中をまだ見ていない missing）は据え置き
    expect(reducer(p, { type: "status", status: base })).toBe(p);
    // 取得中を見たあとで missing（install なし・エラーなし）なら止まったとみなして最初に戻す
    const seen: Phase = { kind: "installing", received: 10, total: 100, seen: true };
    expect(reducer(seen, { type: "status", status: base })).toEqual({ kind: "idle" });
    // prepared で install が見えていれば、最初から seen
    expect(reducer({ kind: "preparing" }, { type: "prepared", status: st({ install: { received: 1, total: 2 } }) })).toMatchObject({ seen: true });
  });

  it("status(login): コード更新・成功・失敗・別 mode の無視", () => {
    const p: Phase = { kind: "login", mode: "device", verificationUri: null, userCode: null };
    const login = (l: Partial<CopilotStatus["login"]>) => st({ cli: "ready", login: { ...base.login, ...l } });
    expect(
      reducer(p, { type: "status", status: login({ state: "waiting", mode: "device", verificationUri: "u", userCode: "C" }) }),
    ).toEqual({ kind: "login", mode: "device", verificationUri: "u", userCode: "C" });
    expect(reducer(p, { type: "status", status: login({ state: "succeeded", mode: "device" }) })).toEqual({
      kind: "verifying",
      afterLogin: true,
    });
    expect(reducer(p, { type: "status", status: login({ state: "failed", mode: "device", error: "x" }) })).toEqual({
      kind: "loginError",
      code: null,
      message: "x",
    });
    // 切り替え前の web プロセスの失敗は無視
    expect(reducer(p, { type: "status", status: login({ state: "failed", mode: "web", error: "x" }) })).toBe(p);
  });

  it("auth: ok / NO_ACCESS / 未ログイン（初回は承認へ、ログイン後はエラー）", () => {
    const v0: Phase = { kind: "verifying", afterLogin: false };
    const v1: Phase = { kind: "verifying", afterLogin: true };
    expect(reducer(v0, { type: "auth", result: { ok: true, models: [] } })).toEqual({ kind: "connected" });
    expect(reducer(v1, { type: "auth", result: { ok: false, code: "COPILOT_NO_ACCESS" } })).toEqual({ kind: "noAccess" });
    expect(reducer(v0, { type: "auth", result: { ok: false, code: "COPILOT_NOT_SIGNED_IN" } })).toEqual({
      kind: "login",
      mode: "web",
      verificationUri: null,
      userCode: null,
    });
    expect(reducer(v1, { type: "auth", result: { ok: false, code: "COPILOT_NOT_SIGNED_IN" } })).toMatchObject({
      kind: "loginError",
      code: "COPILOT_NOT_SIGNED_IN",
    });
    // 確認中でなければ無視
    expect(reducer({ kind: "idle" }, { type: "auth", result: { ok: true, models: [] } })).toEqual({ kind: "idle" });
  });

  it("auth: 理由不明の失敗(CHECK_FAILED)は勝手にログインを始めずエラーにする", () => {
    for (const afterLogin of [false, true]) {
      expect(
        reducer({ kind: "verifying", afterLogin }, { type: "auth", result: { ok: false, code: "COPILOT_CHECK_FAILED", message: "offline" } }),
      ).toEqual({ kind: "loginError", code: "COPILOT_CHECK_FAILED", message: "offline" });
    }
  });

  it("switchToDevice / recheck / error / reset", () => {
    expect(reducer({ kind: "login", mode: "web", verificationUri: "u", userCode: null }, { type: "switchToDevice" })).toEqual({
      kind: "login",
      mode: "device",
      verificationUri: null,
      userCode: null,
    });
    expect(reducer({ kind: "noAccess" }, { type: "recheck" })).toEqual({ kind: "verifying", afterLogin: true });
    expect(reducer({ kind: "preparing" }, { type: "error", code: "X", message: "m", stage: "install" })).toEqual({
      kind: "installError",
      code: "X",
      message: "m",
    });
    expect(reducer({ kind: "verifying", afterLogin: false }, { type: "error", code: null, message: "m", stage: "login" })).toEqual({
      kind: "loginError",
      code: null,
      message: "m",
    });
    expect(reducer({ kind: "connected" }, { type: "reset" })).toEqual({ kind: "idle" });
  });

  it("installPercent / needsPolling", () => {
    expect(installPercent(45, 108)).toBe(42);
    expect(installPercent(5, 0)).toBeNull();
    expect(installPercent(200, 100)).toBe(100);
    expect(needsPolling({ kind: "installing", received: 0, total: 0, seen: false })).toBe(true);
    expect(needsPolling({ kind: "login", mode: "web", verificationUri: null, userCode: null })).toBe(true);
    expect(needsPolling({ kind: "idle" })).toBe(false);
  });
});
