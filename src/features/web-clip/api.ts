// sidecar の /api/clip（server/routes/clip.ts）を呼ぶ。アプリ向けの口だけ使う。

import { apiBase } from "../../lib/platform";
import { serverAuthHeaders } from "../../lib/storage/providers/server-fs";
import type { WebClip } from "./clip-note";

/**
 * 受け取り待ちのクリップ。sidecar が無い環境（Pages 版・Vercel）では null —
 * 呼び出し側は null を見たら見張りを止める。
 */
export async function fetchClipInbox(): Promise<WebClip[] | null> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/clip/inbox`, { headers: serverAuthHeaders() });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const ct = res.headers.get("content-type") ?? "";
  // 静的配信の SPA フォールバックが index.html を返す環境を弾く
  if (!ct.includes("application/json")) return null;
  const body = (await res.json()) as { clips?: WebClip[] };
  return Array.isArray(body.clips) ? body.clips : [];
}

/** 受け取り済みにする（sidecar の受け取り待ちから消す） */
export async function ackClip(id: string): Promise<void> {
  await fetch(`${apiBase()}/clip/inbox/${encodeURIComponent(id)}`, { method: "DELETE", headers: serverAuthHeaders() });
}

/** 設定画面に出すペアリングコード（"<port>.<token>"）。sidecar が無ければ null */
export async function fetchPairingCode(): Promise<string | null> {
  try {
    const res = await fetch(`${apiBase()}/clip/pairing`, { headers: serverAuthHeaders() });
    if (!res.ok) return null;
    const body = (await res.json()) as { code?: string };
    return typeof body.code === "string" ? body.code : null;
  } catch {
    return null;
  }
}

/** ペアリングコードを作り直す（つないでいた拡張機能はコードの入れ直しが要る） */
export async function resetPairingCode(): Promise<string | null> {
  try {
    const res = await fetch(`${apiBase()}/clip/pairing/reset`, { method: "POST", headers: serverAuthHeaders() });
    if (!res.ok) return null;
    const body = (await res.json()) as { code?: string };
    return typeof body.code === "string" ? body.code : null;
  } catch {
    return null;
  }
}

/** 拡張機能からの接続の申し込み（承認するペアリング） */
export type ClipPairRequest = {
  id: string;
  /** 拡張機能の画面にも出ている 4 桁の番号 */
  number: string;
  extensionId: string;
  requestedAt: string;
};

/** 待っている申し込み。sidecar が無ければ null */
export async function fetchPairRequests(): Promise<ClipPairRequest[] | null> {
  try {
    const res = await fetch(`${apiBase()}/clip/pair-requests`, { headers: serverAuthHeaders() });
    if (!res.ok) return null;
    if (!(res.headers.get("content-type") ?? "").includes("application/json")) return null;
    const body = (await res.json()) as { requests?: ClipPairRequest[] };
    return Array.isArray(body.requests) ? body.requests : [];
  } catch {
    return null;
  }
}

/** 申し込みを許可する・断る */
export async function decidePairRequest(id: string, approve: boolean): Promise<void> {
  await fetch(`${apiBase()}/clip/pair-requests/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { ...serverAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ approve }),
  });
}
