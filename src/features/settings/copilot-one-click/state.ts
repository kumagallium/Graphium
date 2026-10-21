// Copilot ワンクリック接続の状態遷移（純粋関数）。副作用は CopilotOneClick.tsx 側に置く。

import type { CopilotAuthResult, CopilotStatus } from "./api";

export type LoginMode = "web" | "device";

export type Phase =
  /** 最初の status を読んでいる（何も描かない） */
  | { kind: "loading" }
  /** CLI が無く、取得もできない環境（何も描かない） */
  | { kind: "unavailable" }
  | { kind: "idle" }
  /** ボタンを押した直後（status を読んで CLI の用意を始める） */
  | { kind: "preparing" }
  /** seen: 取得中の status を一度でも見たか（POST 直後の一瞬の missing と、取得が止まったことを見分ける） */
  | { kind: "installing"; received: number; total: number; seen: boolean }
  | { kind: "installError"; code: string | null; message: string | null }
  /** auth（モデル一覧）で接続を確かめている */
  | { kind: "verifying"; afterLogin: boolean }
  | { kind: "login"; mode: LoginMode; verificationUri: string | null; userCode: string | null }
  | { kind: "loginError"; code: string | null; message: string | null }
  | { kind: "noAccess" }
  /** 確認が済み、モデルを登録している */
  | { kind: "connected" };

export type Action =
  | { type: "init"; status: CopilotStatus | null }
  | { type: "click" }
  | { type: "prepared"; status: CopilotStatus }
  | { type: "status"; status: CopilotStatus }
  | { type: "auth"; result: CopilotAuthResult }
  | { type: "switchToDevice" }
  | { type: "recheck" }
  | { type: "error"; code: string | null; message: string | null; stage: "install" | "login" }
  | { type: "reset" };

/** 最初の status から開く画面を決める（取得や承認が裏で続いていれば復元する） */
function fromInit(status: CopilotStatus | null): Phase {
  if (!status) return { kind: "unavailable" };
  if (status.cli === "installing") {
    return { kind: "installing", received: status.install?.received ?? 0, total: status.install?.total ?? 0, seen: true };
  }
  if (status.cli === "missing" && !status.installable) return { kind: "unavailable" };
  if (status.cli === "ready" && status.login.state === "waiting") {
    return {
      kind: "login",
      mode: status.login.mode ?? "web",
      verificationUri: status.login.verificationUri,
      userCode: status.login.userCode,
    };
  }
  return { kind: "idle" };
}

export function reducer(phase: Phase, action: Action): Phase {
  switch (action.type) {
    case "init":
      return phase.kind === "loading" ? fromInit(action.status) : phase;
    case "click":
      return { kind: "preparing" };
    case "reset":
      return { kind: "idle" };
    case "prepared": {
      const s = action.status;
      if (s.cli === "ready") return { kind: "verifying", afterLogin: false };
      if (!s.installable) return { kind: "installError", code: "COPILOT_CLI_UNSUPPORTED_PLATFORM", message: null };
      return { kind: "installing", received: s.install?.received ?? 0, total: s.install?.total ?? 0, seen: s.install !== null };
    }
    case "status": {
      const s = action.status;
      if (phase.kind === "installing") {
        if (s.cli === "ready") return { kind: "verifying", afterLogin: false };
        if (s.cli === "installing") {
          return { kind: "installing", received: s.install?.received ?? 0, total: s.install?.total ?? 0, seen: true };
        }
        // 取得が止まった（cli が missing に戻った）
        if (s.installError) return { kind: "installError", code: null, message: s.installError };
        // 取得中の status を見たあとで取得が無くなった = キャンセル済み・裏で中断。最初に戻す
        // （まだ見ていなければ POST 直後の一瞬の missing なので待つ）
        if (phase.seen && s.install === null) return { kind: "idle" };
        return phase;
      }
      if (phase.kind === "login") {
        const l = s.login;
        // 別の mode（切り替え前のプロセス）の状態は無視する
        if (l.mode && l.mode !== phase.mode) return phase;
        if (l.state === "succeeded") return { kind: "verifying", afterLogin: true };
        if (l.state === "failed") return { kind: "loginError", code: null, message: l.error };
        if (l.state === "waiting") {
          if (l.verificationUri === phase.verificationUri && l.userCode === phase.userCode) return phase;
          return { kind: "login", mode: phase.mode, verificationUri: l.verificationUri, userCode: l.userCode };
        }
        return phase;
      }
      return phase;
    }
    case "auth": {
      if (phase.kind !== "verifying") return phase;
      const r = action.result;
      if (r.ok) return { kind: "connected" };
      if (r.code === "COPILOT_NO_ACCESS") return { kind: "noAccess" };
      // ログイン直後なのに未ログインなら、これ以上は進めない
      if (r.code === "COPILOT_NOT_SIGNED_IN" && !phase.afterLogin) {
        return { kind: "login", mode: "web", verificationUri: null, userCode: null };
      }
      return { kind: "loginError", code: r.code, message: r.message ?? null };
    }
    case "switchToDevice":
      return phase.kind === "login" ? { kind: "login", mode: "device", verificationUri: null, userCode: null } : phase;
    case "recheck":
      return phase.kind === "noAccess" ? { kind: "verifying", afterLogin: true } : phase;
    case "error":
      return action.stage === "install"
        ? { kind: "installError", code: action.code, message: action.message }
        : { kind: "loginError", code: action.code, message: action.message };
  }
}

/** 進捗の割合（%）。total が分からなければ null */
export function installPercent(received: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.min(100, Math.round((received / total) * 100));
}

/** ポーリングが要る状態か */
export function needsPolling(phase: Phase): boolean {
  return phase.kind === "installing" || phase.kind === "login";
}
