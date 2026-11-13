// Sign in with ChatGPT 接続の API クライアント（/api/models/chatgpt/*）。
// authUrl は機微なので、ここでは返すだけ（ログに出さない・保持しない）。

import { apiBase } from "../../../lib/platform";

export type ChatGptSignInState = "idle" | "waiting" | "succeeded" | "failed";

export type ChatGptStatus = {
  available: boolean;
  signIn: {
    state: ChatGptSignInState;
    error: string | null;
    errorCode: string | null;
  };
  account: { email: string | null; planUsage: boolean; welcomed: boolean } | null;
};

export type ChatGptModelsResult =
  | { ok: true; models: { id: string; name: string }[] }
  | {
      ok: false;
      code: "CHATGPT_NOT_SIGNED_IN" | "CHATGPT_PLAN_USAGE_NOT_GRANTED" | "CHATGPT_NOT_ELIGIBLE" | "CHATGPT_CHECK_FAILED";
      message?: string;
    };

/** サーバーが返した code 付きのエラー */
export class ChatGptApiError extends Error {
  code: string | null;
  constructor(code: string | null, message: string) {
    super(message);
    this.code = code;
  }
}

const base = () => `${apiBase()}/models/chatgpt`;

async function post<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // サーバーは application/json 以外を 415 で断るため、body が無くても {} を送る
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ChatGptApiError(data.code ?? null, data.error ?? data.message ?? `Error ${res.status}`);
  }
  return (await res.json().catch(() => ({}))) as T;
}

export async function getStatus(): Promise<ChatGptStatus> {
  const res = await fetch(`${base()}/status`);
  if (!res.ok) throw new ChatGptApiError(null, `Error ${res.status}`);
  return res.json();
}

/** サインインを始める。返った authUrl はシステムブラウザで開くだけに使う */
export const startSignIn = () => post<{ authUrl: string }>("/sign-in");
export const cancelSignIn = () => post("/sign-in/cancel");
export const signOut = () => post<{ revoked: boolean }>("/sign-out");
export const markWelcomed = () => post("/welcomed");

/** 使えるモデルの一覧（サインインとプラン利用の許可の確認も兼ねる） */
export async function getModels(): Promise<ChatGptModelsResult> {
  const res = await fetch(`${base()}/models`);
  if (!res.ok) throw new ChatGptApiError(null, `Error ${res.status}`);
  return res.json();
}
