import { describe, expect, it } from "vitest";
import type { ChatGptStatus } from "./api";
import { needsPolling, reducer, type Phase } from "./state";

const base: ChatGptStatus = {
  available: true,
  signIn: { state: "idle", error: null, errorCode: null },
  account: null,
};
const st = (p: Partial<ChatGptStatus>): ChatGptStatus => ({ ...base, ...p });
const signIn = (state: ChatGptStatus["signIn"]["state"], errorCode: string | null = null): ChatGptStatus["signIn"] => ({
  state,
  error: errorCode ? "x" : null,
  errorCode,
});

describe("chatgpt-plan reducer", () => {
  it("init: 使えなければ unavailable、何も無ければ idle、待ちが続いていれば復元する", () => {
    expect(reducer({ kind: "loading" }, { type: "init", status: null })).toEqual({ kind: "unavailable" });
    expect(reducer({ kind: "loading" }, { type: "init", status: st({ available: false }) })).toEqual({ kind: "unavailable" });
    expect(reducer({ kind: "loading" }, { type: "init", status: base })).toEqual({ kind: "idle" });
    expect(reducer({ kind: "loading" }, { type: "init", status: st({ signIn: signIn("waiting") }) })).toEqual({ kind: "waiting" });
  });

  it("click → starting → started で waiting", () => {
    const starting = reducer({ kind: "idle" }, { type: "click" });
    expect(starting).toEqual({ kind: "starting" });
    expect(reducer(starting, { type: "started" })).toEqual({ kind: "waiting" });
    expect(reducer(starting, { type: "alreadySigningIn" })).toEqual({ kind: "waiting" });
  });

  it("開始の失敗: 1455 使用中・使えない環境を出し分ける", () => {
    const starting: Phase = { kind: "starting" };
    expect(reducer(starting, { type: "error", code: "CHATGPT_PORT_IN_USE", message: "x" })).toEqual({ kind: "portInUse" });
    expect(reducer(starting, { type: "error", code: "CHATGPT_UNAVAILABLE", message: "x" })).toEqual({ kind: "unavailable" });
    expect(reducer(starting, { type: "error", code: null, message: "boom" })).toEqual({ kind: "checkFailed", message: "boom" });
  });

  it("waiting の status: 成功は verifying（案内の済み・未済を引き継ぐ）", () => {
    const account = { email: null, planUsage: true, welcomed: false };
    expect(reducer({ kind: "waiting" }, { type: "status", status: st({ signIn: signIn("succeeded"), account }) })).toEqual({
      kind: "verifying",
      welcomed: false,
    });
  });

  it("waiting の status: プラン利用が許可されていなければ notGranted", () => {
    const account = { email: null, planUsage: false, welcomed: true };
    expect(reducer({ kind: "waiting" }, { type: "status", status: st({ signIn: signIn("succeeded"), account }) })).toEqual({
      kind: "notGranted",
    });
  });

  it("waiting の status: 失敗はコードで出し分け、待ちの間は何もしない", () => {
    const w: Phase = { kind: "waiting" };
    expect(reducer(w, { type: "status", status: st({ signIn: signIn("failed", "CHATGPT_ACCESS_DENIED") }) })).toEqual({ kind: "denied" });
    expect(reducer(w, { type: "status", status: st({ signIn: signIn("failed", "CHATGPT_PORT_IN_USE") }) })).toEqual({ kind: "portInUse" });
    expect(reducer(w, { type: "status", status: st({ signIn: signIn("failed", "CHATGPT_NOT_ELIGIBLE") }) })).toEqual({ kind: "notEligible" });
    expect(reducer(w, { type: "status", status: st({ signIn: signIn("failed") }) })).toEqual({ kind: "checkFailed", message: null });
    expect(reducer(w, { type: "status", status: st({ signIn: signIn("waiting") }) })).toBe(w);
  });

  it("waiting の間に status が idle に戻ったら idle に戻り、ポーリングが止まる", () => {
    const next = reducer({ kind: "waiting" }, { type: "status", status: st({ signIn: signIn("idle") }) });
    expect(next).toEqual({ kind: "idle" });
    expect(needsPolling(next)).toBe(false);
  });

  it("status は waiting 以外では無視する（古い succeeded に引きずられない）", () => {
    const idle: Phase = { kind: "idle" };
    expect(reducer(idle, { type: "status", status: st({ signIn: signIn("succeeded") }) })).toBe(idle);
  });

  it("models: 成功は先頭のモデルで connected、初回は welcome を挟む", () => {
    const ok = { ok: true as const, models: [{ id: "m1", name: "Model One" }, { id: "m2", name: "Two" }] };
    expect(reducer({ kind: "verifying", welcomed: true }, { type: "models", result: ok })).toEqual({
      kind: "connected",
      model: { id: "m1", name: "Model One" },
    });
    const welcome = reducer({ kind: "verifying", welcomed: false }, { type: "models", result: ok });
    expect(welcome).toEqual({ kind: "welcome", model: { id: "m1", name: "Model One" } });
    expect(reducer(welcome, { type: "welcomeDone" })).toEqual({ kind: "connected", model: { id: "m1", name: "Model One" } });
  });

  it("models: 名前が空なら ID を使う。空の一覧は確認失敗", () => {
    expect(
      reducer({ kind: "verifying", welcomed: true }, { type: "models", result: { ok: true, models: [{ id: "m1", name: "" }] } }),
    ).toEqual({ kind: "connected", model: { id: "m1", name: "m1" } });
    expect(reducer({ kind: "verifying", welcomed: true }, { type: "models", result: { ok: true, models: [] } })).toEqual({
      kind: "checkFailed",
      message: null,
    });
  });

  it("models の失敗: 許可なし・使えない・確認失敗を出し分ける", () => {
    const v: Phase = { kind: "verifying", welcomed: true };
    expect(reducer(v, { type: "models", result: { ok: false, code: "CHATGPT_PLAN_USAGE_NOT_GRANTED" } })).toEqual({ kind: "notGranted" });
    expect(reducer(v, { type: "models", result: { ok: false, code: "CHATGPT_NOT_ELIGIBLE" } })).toEqual({ kind: "notEligible" });
    expect(reducer(v, { type: "models", result: { ok: false, code: "CHATGPT_CHECK_FAILED", message: "m" } })).toEqual({
      kind: "checkFailed",
      message: "m",
    });
  });

  it("reset は idle、ポーリングは waiting のときだけ", () => {
    expect(reducer({ kind: "denied" }, { type: "reset" })).toEqual({ kind: "idle" });
    expect(needsPolling({ kind: "waiting" })).toBe(true);
    expect(needsPolling({ kind: "verifying", welcomed: true })).toBe(false);
  });
});
