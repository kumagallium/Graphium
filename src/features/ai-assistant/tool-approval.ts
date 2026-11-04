// 実行前の確認（MCP の道具）の待ち行列。
//
// サーバーが approval_request を流すと、runAgent がここに頼みを積む。画面の
// ToolApprovalHost が先頭の 1 件をダイアログで出し、返事で Promise を解く。
// 同時に複数来たら 1 件ずつ順に出す。
//
// 画面（ホスト）が無いときは聞きようがないので、やめたことにする（黙って実行しない）。

import { useSyncExternalStore } from "react";

export type ToolApprovalRequest = {
  /** どの MCP サーバーの道具か（設定の登録名） */
  server: string;
  /** 道具の名前 */
  name: string;
  /** 道具の見出し（サーバーが付けていれば） */
  title?: string;
  /** AI が道具に渡そうとしている値 */
  input: unknown;
};

export type ToolApprovalAnswer = {
  approved: boolean;
  /** 「このサーバーは今後確認しない」 */
  remember: boolean;
};

export type PendingToolApproval = {
  id: string;
  request: ToolApprovalRequest;
};

type Entry = PendingToolApproval & { resolve: (answer: ToolApprovalAnswer) => void };

const DECLINE: ToolApprovalAnswer = { approved: false, remember: false };

let queue: Entry[] = [];
let hosts = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function current(): PendingToolApproval | null {
  return queue[0] ?? null;
}

/** 確認を頼む。中断（signal）されたら、やめたことにして行列から外す */
export function requestToolApproval(request: ToolApprovalRequest, signal?: AbortSignal): Promise<ToolApprovalAnswer> {
  if (hosts === 0 || signal?.aborted) return Promise.resolve(DECLINE);
  return new Promise<ToolApprovalAnswer>((resolve) => {
    const id = crypto.randomUUID();
    const entry: Entry = { id, request, resolve };
    queue = [...queue, entry];
    notify();
    signal?.addEventListener(
      "abort",
      () => {
        if (!queue.some((e) => e.id === id)) return;
        queue = queue.filter((e) => e.id !== id);
        notify();
        resolve(DECLINE);
      },
      { once: true },
    );
  });
}

/** 返事を届けて行列から外す */
export function answerToolApproval(id: string, answer: ToolApprovalAnswer): void {
  const entry = queue.find((e) => e.id === id);
  if (!entry) return;
  queue = queue.filter((e) => e.id !== id);
  notify();
  entry.resolve(answer);
}

/** ホスト（ダイアログを出す部品）がいる間だけ確認を受け付ける。戻り値で外す */
export function registerToolApprovalHost(): () => void {
  hosts += 1;
  return () => {
    hosts -= 1;
    if (hosts === 0) {
      // 聞ける画面が無くなったら、残りは全部やめたことにする
      const rest = queue;
      queue = [];
      notify();
      for (const e of rest) e.resolve(DECLINE);
    }
  };
}

/** 今出すべき 1 件（無ければ null） */
export function usePendingToolApproval(): PendingToolApproval | null {
  return useSyncExternalStore(subscribe, current, current);
}
