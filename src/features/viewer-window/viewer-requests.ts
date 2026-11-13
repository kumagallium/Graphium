// 別ウィンドウ側から、メインへ頼みごとをして返事を待つ（グラフ・メモの作成・メモの削除）。
// 頼みごとには nonce を付け、同じ nonce の返事だけを受ける。返事が来なければ時間切れとして扱う
// （決まりごとは lib/viewer-window.ts の「グラフとメモ」）。

import {
  onMessageFromMain,
  sendToMain,
  type MainToViewerMessage,
  type ViewerMemoCreateRequest,
  type ViewerNoteGraph,
  type ViewerToMainMessage,
} from "../../lib/viewer-window";

/** 返事を待つ上限。過ぎたら、グラフは null・メモは false として扱う */
export const VIEWER_REQUEST_TIMEOUT_MS = 8000;

/** テスト用の差し替え口 */
export type ViewerRequestDeps = {
  send?: (msg: ViewerToMainMessage) => void;
  subscribe?: (fn: (msg: MainToViewerMessage) => void) => () => void;
  timeoutMs?: number;
};

function newNonce(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 受け口を先に張ってから送り、match が返事を見つけるか、時間切れになるまで待つ */
function request<T>(
  build: (nonce: string) => ViewerToMainMessage,
  match: (msg: MainToViewerMessage, nonce: string) => { value: T } | null,
  fallback: T,
  deps: ViewerRequestDeps,
): Promise<T> {
  const send = deps.send ?? sendToMain;
  const subscribe = deps.subscribe ?? onMessageFromMain;
  const timeoutMs = deps.timeoutMs ?? VIEWER_REQUEST_TIMEOUT_MS;
  const nonce = newNonce();
  return new Promise<T>((resolve) => {
    let off: () => void = () => {};
    let settled = false;
    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      off();
      resolve(value);
    };
    const timer = setTimeout(() => finish(fallback), timeoutMs);
    off = subscribe((msg) => {
      const hit = match(msg, nonce);
      if (hit) finish(hit.value);
    });
    if (settled) off();
    send(build(nonce));
  });
}

/** メインにこのノートのグラフを作ってもらう。作れなかった・返事が来なかったときは null */
export function requestNoteGraph(id: string, deps: ViewerRequestDeps = {}): Promise<ViewerNoteGraph | null> {
  return request<ViewerNoteGraph | null>(
    (nonce) => ({ type: "graph-request", nonce, id }),
    (msg, nonce) => {
      if (msg.type !== "graph-data" || msg.nonce !== nonce) return null;
      return { value: msg.data ? { data: msg.data, lineageTree: msg.lineageTree } : null };
    },
    null,
    deps,
  );
}

function matchMemoResult(msg: MainToViewerMessage, nonce: string): { value: boolean } | null {
  return msg.type === "memo-result" && msg.nonce === nonce ? { value: msg.ok } : null;
}

/** メインにメモを作ってもらう。作れた true。失敗・返事が来なかったときは false */
export function requestMemoCreate(req: ViewerMemoCreateRequest, deps: ViewerRequestDeps = {}): Promise<boolean> {
  return request<boolean>((nonce) => ({ type: "memo-create", nonce, ...req }), matchMemoResult, false, deps);
}

/** メインにメモを消してもらう。消せた true。失敗・返事が来なかったときは false */
export function requestMemoDelete(memoId: string, deps: ViewerRequestDeps = {}): Promise<boolean> {
  return request<boolean>((nonce) => ({ type: "memo-delete", nonce, memoId }), matchMemoResult, false, deps);
}
