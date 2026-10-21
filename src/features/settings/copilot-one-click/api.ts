// Copilot ワンクリック接続の API クライアント（/api/models/copilot/*）。

import { apiBase } from "../../../lib/platform";

export type CopilotStatus = {
  cli: "ready" | "missing" | "installing";
  source: "configured" | "detected" | "managed" | null;
  installable: boolean;
  install: { received: number; total: number } | null;
  installError: string | null;
  login: {
    state: "idle" | "waiting" | "succeeded" | "failed";
    mode: "web" | "device" | null;
    verificationUri: string | null;
    userCode: string | null;
    error: string | null;
  };
};

export type CopilotAuthResult =
  | { ok: true; models: string[] }
  | { ok: false; code: "COPILOT_NOT_SIGNED_IN" | "COPILOT_NO_ACCESS" | "COPILOT_CLI_MISSING" | "COPILOT_CHECK_FAILED"; message?: string };

/** サーバーが返した code 付きのエラー */
export class CopilotApiError extends Error {
  code: string | null;
  constructor(code: string | null, message: string) {
    super(message);
    this.code = code;
  }
}

const base = () => `${apiBase()}/models/copilot`;

async function post(path: string, body?: unknown): Promise<void> {
  const res = await fetch(`${base()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // サーバーは application/json 以外を 415 で断るため、body が無くても {} を送る
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new CopilotApiError(data.code ?? null, data.error ?? data.message ?? `Error ${res.status}`);
  }
}

export async function getStatus(): Promise<CopilotStatus> {
  const res = await fetch(`${base()}/status`);
  if (!res.ok) throw new CopilotApiError(null, `Error ${res.status}`);
  return res.json();
}

export const startInstall = () => post("/install");
export const cancelInstall = () => post("/install/cancel");
export const startLogin = (mode: "web" | "device") => post("/login", { mode });
export const cancelLogin = () => post("/login/cancel");

/** CLI を起動してモデル一覧を取る（重い。ボタン操作時だけ呼ぶ） */
export async function getAuth(): Promise<CopilotAuthResult> {
  const res = await fetch(`${base()}/auth`);
  if (!res.ok) throw new CopilotApiError(null, `Error ${res.status}`);
  return res.json();
}
