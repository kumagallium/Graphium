// Sign in with ChatGPT 接続の状態遷移（純粋関数）。副作用は ChatGptPlanConnect.tsx 側に置く。

import type { ChatGptModelsResult, ChatGptStatus } from "./api";

export type ChatGptModel = { id: string; name: string };

export type Phase =
  /** 最初の status を読んでいる（何も描かない） */
  | { kind: "loading" }
  /** デスクトップ版でない・使えない環境（何も描かない） */
  | { kind: "unavailable" }
  | { kind: "idle" }
  /** ボタンを押した直後（サインインを始めてブラウザを開く） */
  | { kind: "starting" }
  /** ブラウザで続けてもらっている */
  | { kind: "waiting" }
  /** モデル一覧で接続とプラン利用の許可を確かめている。welcomed: 初回の案内を済ませているか */
  | { kind: "verifying"; welcomed: boolean }
  /** 初回だけの案内（閉じたら登録に進む） */
  | { kind: "welcome"; model: ChatGptModel }
  /** 確認が済み、モデルを登録している */
  | { kind: "connected"; model: ChatGptModel }
  /** サインインはできたが、プランの利用が許可されていない */
  | { kind: "notGranted" }
  /** 127.0.0.1:1455 を別のアプリが使っている */
  | { kind: "portInUse" }
  /** 利用者がブラウザで断った */
  | { kind: "denied" }
  /** このアカウントでは使えない（繰り返しサインインさせない） */
  | { kind: "notEligible" }
  /** 状態を確認できなかった */
  | { kind: "checkFailed"; message: string | null };

export type Action =
  | { type: "init"; status: ChatGptStatus | null }
  | { type: "click" }
  /** サインインを始められた（ブラウザを開いた） */
  | { type: "started" }
  /** 別の流れがすでに進行中だった（409） */
  | { type: "alreadySigningIn" }
  | { type: "status"; status: ChatGptStatus }
  | { type: "models"; result: ChatGptModelsResult }
  | { type: "error"; code: string | null; message: string | null }
  | { type: "welcomeDone" }
  | { type: "reset" };

/** サーバーのエラーコードから失敗の画面を決める */
export function failurePhase(code: string | null, message: string | null): Phase {
  switch (code) {
    case "CHATGPT_PORT_IN_USE":
      return { kind: "portInUse" };
    case "CHATGPT_ACCESS_DENIED":
      return { kind: "denied" };
    case "CHATGPT_NOT_ELIGIBLE":
      return { kind: "notEligible" };
    case "CHATGPT_PLAN_USAGE_NOT_GRANTED":
      return { kind: "notGranted" };
    default:
      return { kind: "checkFailed", message };
  }
}

/** 最初の status から開く画面を決める（承認待ちが裏で続いていれば復元する） */
function fromInit(status: ChatGptStatus | null): Phase {
  if (!status || !status.available) return { kind: "unavailable" };
  if (status.signIn.state === "waiting") return { kind: "waiting" };
  return { kind: "idle" };
}

export function reducer(phase: Phase, action: Action): Phase {
  switch (action.type) {
    case "init":
      return phase.kind === "loading" ? fromInit(action.status) : phase;
    case "click":
      return { kind: "starting" };
    case "reset":
      return { kind: "idle" };
    case "started":
    case "alreadySigningIn":
      return phase.kind === "starting" ? { kind: "waiting" } : phase;
    case "status": {
      if (phase.kind !== "waiting") return phase;
      const s = action.status;
      // 待っている間に idle へ戻った（サーバーの再起動・別の画面での取り消し）: 未接続の表示に戻す
      if (s.signIn.state === "idle") return { kind: "idle" };
      if (s.signIn.state === "succeeded") {
        // プラン利用の許可が付いていなければ、モデル一覧を取りに行かずここで伝える
        if (s.account && !s.account.planUsage) return { kind: "notGranted" };
        return { kind: "verifying", welcomed: s.account?.welcomed ?? true };
      }
      if (s.signIn.state === "failed") return failurePhase(s.signIn.errorCode, s.signIn.error);
      return phase;
    }
    case "models": {
      if (phase.kind !== "verifying") return phase;
      const r = action.result;
      if (!r.ok) return failurePhase(r.code, r.message ?? null);
      const first = r.models[0];
      if (!first) return { kind: "checkFailed", message: null };
      const model = { id: first.id, name: first.name || first.id };
      return phase.welcomed ? { kind: "connected", model } : { kind: "welcome", model };
    }
    case "welcomeDone":
      return phase.kind === "welcome" ? { kind: "connected", model: phase.model } : phase;
    case "error":
      // 開始の失敗は、そのコードに応じた画面へ。使えない環境（CHATGPT_UNAVAILABLE）は何も描かない
      if (action.code === "CHATGPT_UNAVAILABLE") return { kind: "unavailable" };
      return failurePhase(action.code, action.message);
  }
}

/** ポーリングが要る状態か */
export function needsPolling(phase: Phase): boolean {
  return phase.kind === "waiting";
}
