// 「AI との会話」の記録を読むサーバーの口を呼ぶ。
//
// 合言葉は installApiAuthFetch が fetch に自動で付ける。ここでは AI を呼ばない。

import { apiBase } from "../../lib/platform";
import type { WorkdirSummary } from "../../lib/conversation/render";
import type { ConversationMaterial } from "../../lib/conversation/types";

export type ConversationSessionRef = { dirName: string; fileName: string };

/** 作業フォルダの要約と、そこにある（本人の発言がある）会話の参照 */
export type ConversationWorkdirItem = WorkdirSummary & { sessionRefs: ConversationSessionRef[] };

export type FetchWorkdirsResult =
  | { kind: "ok"; searchedPath: string; workdirs: ConversationWorkdirItem[] }
  /** デスクトップ版でない・サーバーが無い（ブラウザだけの版）。使えない場所として扱う */
  | { kind: "unavailable" }
  | { kind: "error" };

/** 作業フォルダの一覧を読む */
export async function fetchConversationWorkdirs(signal?: AbortSignal): Promise<FetchWorkdirsResult> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/conversations/claude-code/workdirs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal,
    });
  } catch (e) {
    // 中断は呼び出し側が扱う。それ以外のネットワーク失敗は「使えない」に倒す
    if (signal?.aborted) throw e;
    return { kind: "unavailable" };
  }
  if (res.status === 404) return { kind: "unavailable" };
  if (!res.ok) return { kind: "error" };
  try {
    const data = (await res.json()) as { searchedPath: string; workdirs: ConversationWorkdirItem[] };
    return { kind: "ok", searchedPath: data.searchedPath, workdirs: data.workdirs };
  } catch {
    return { kind: "error" };
  }
}

/** 会話を読む（1 回に 50 件まで）。失敗は投げる */
export async function fetchConversationMaterials(
  refs: ConversationSessionRef[],
  signal?: AbortSignal,
): Promise<{ materials: ConversationMaterial[]; failed: number }> {
  const res = await fetch(`${apiBase()}/conversations/claude-code/read`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessions: refs }),
    signal,
  });
  if (!res.ok) throw new Error(`conversation read failed: ${res.status}`);
  return (await res.json()) as { materials: ConversationMaterial[]; failed: number };
}
