// 書き換えるかもしれない MCP の道具を、実行の前に利用者に確かめる。
//
// MCP の道具は AI が自分で選んで呼ぶ。Slack への投稿や、ファイルの削除のような
// 取り返しのつかない操作も、確かめなしで走ってしまう。そこで道具の execute を包み、
// 呼ぶ直前に approval_request をストリーム（NDJSON）に書き出して、画面からの返事を待つ。
//
// - 確かめるのは annotations で readOnlyHint: true が付いていない道具（印の無いものを含む。
//   MCP の仕様では readOnlyHint の既定は false）。利用者が「今後確認しない」と決めた
//   サーバーの道具は確かめない
// - 返事が来ないまま TOOL_APPROVAL_TIMEOUT_MS が過ぎたら、やめたことにする
// - やめたときは道具を呼ばず、その旨を AI に返す（AI は回答の中で利用者に伝える）
//
// 待ち合わせの作りは client-tool-bridge.ts と同じ（run_id → call_id → 待ち）。

import type { MCPToolInfo } from "./mcp.js";

/** 返事を待つ上限。利用者が席を外しても、run がいつまでも残らないようにする */
export const TOOL_APPROVAL_TIMEOUT_MS = 5 * 60_000;

export const DECLINED_RESULT =
  "The user declined to run this tool, so it was not run. Do not call it again in this answer; " +
  "tell the user what you would have done instead.";
export const CANCELLED_RESULT = "The run was cancelled before the tool ran.";

/**
 * 道具を呼ばなかったときの戻り値。MCP の道具は結果を mcpToModelOutput（content 配列を読む）で
 * AI に渡すので、ただの文字列ではなく MCP の結果の形で返す
 */
export function skippedToolResult(text: string): { content: { type: "text"; text: string }[]; isError: true } {
  return { content: [{ type: "text", text }], isError: true };
}

export type ApprovalRequestEvent = {
  type: "approval_request";
  run_id: string;
  call_id: string;
  /** 道具の名前（AI が呼んだ名前） */
  name: string;
  /** 道具の見出し（サーバーが付けていれば） */
  title?: string;
  /** どの MCP サーバーの道具か（設定の登録名） */
  server: string;
  input: unknown;
};

type Pending = { resolve: (approved: boolean) => void; timer: ReturnType<typeof setTimeout> };

// run_id -> call_id -> pending
const pendingByRun = new Map<string, Map<string, Pending>>();

/** 返事を届ける。待っている呼び出しが無ければ false（呼び出し側が 404 を返す） */
export function resolveToolApproval(runId: string, callId: string, approved: boolean): boolean {
  const calls = pendingByRun.get(runId);
  const pending = calls?.get(callId);
  if (!calls || !pending) return false;
  clearTimeout(pending.timer);
  calls.delete(callId);
  if (calls.size === 0) pendingByRun.delete(runId);
  pending.resolve(approved);
  return true;
}

/** テスト用: 待ち合わせ中の run 数 */
export function pendingApprovalRunCountForTest(): number {
  return pendingByRun.size;
}

/** 確かめが要る道具の名前（読むだけの印があるもの・確認しないサーバーのものを除く） */
export function toolsNeedingApproval(
  tools: Record<string, unknown>,
  toolInfo: Record<string, MCPToolInfo>,
  skipServers: ReadonlySet<string>,
): string[] {
  return Object.keys(tools).filter((name) => {
    const info = toolInfo[name];
    // 出どころの分からない道具（MCP 以外）は対象外
    if (!info) return false;
    return !info.readOnly && !skipServers.has(info.server);
  });
}

type ExecutableTool = { execute?: (input: unknown, options?: unknown) => Promise<unknown> | unknown };

/**
 * names の道具の execute を「確かめてから呼ぶ」ものに差し替えた道具一式を返す。
 * 元の tools は書き換えない（プールの道具を使い回しているため）
 */
export function withToolApproval(params: {
  runId: string;
  tools: Record<string, unknown>;
  toolInfo: Record<string, MCPToolInfo>;
  names: readonly string[];
  emit: (event: ApprovalRequestEvent) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}): { tools: Record<string, unknown>; dispose: () => void } {
  const { runId, toolInfo, names, emit, signal, timeoutMs = TOOL_APPROVAL_TIMEOUT_MS } = params;
  let disposed = false;

  const dispose = () => {
    disposed = true;
    const calls = pendingByRun.get(runId);
    if (calls) {
      for (const p of calls.values()) {
        clearTimeout(p.timer);
        p.resolve(false);
      }
      pendingByRun.delete(runId);
    }
  };
  if (signal) {
    if (signal.aborted) dispose();
    else signal.addEventListener("abort", dispose, { once: true });
  }

  const ask = (name: string, input: unknown): Promise<boolean> => {
    if (disposed) return Promise.resolve(false);
    const callId = crypto.randomUUID();
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        const calls = pendingByRun.get(runId);
        calls?.delete(callId);
        if (calls && calls.size === 0) pendingByRun.delete(runId);
        resolve(false);
      }, timeoutMs);
      let calls = pendingByRun.get(runId);
      if (!calls) {
        calls = new Map();
        pendingByRun.set(runId, calls);
      }
      calls.set(callId, { resolve, timer });
      const info = toolInfo[name];
      emit({
        type: "approval_request",
        run_id: runId,
        call_id: callId,
        name,
        ...(info?.title ? { title: info.title } : {}),
        server: info?.server ?? "",
        input,
      });
    });
  };

  const tools: Record<string, unknown> = { ...params.tools };
  for (const name of names) {
    const original = params.tools[name] as ExecutableTool | undefined;
    if (!original || typeof original.execute !== "function") continue;
    const execute = original.execute.bind(original);
    tools[name] = {
      ...original,
      execute: async (input: unknown, options?: unknown) => {
        if (!(await ask(name, input))) return skippedToolResult(disposed ? CANCELLED_RESULT : DECLINED_RESULT);
        return execute(input, options);
      },
    };
  }

  return { tools, dispose };
}
