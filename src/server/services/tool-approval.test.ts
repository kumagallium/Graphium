// 実行前の確認（書き換えるかもしれない MCP の道具）のテスト

import { describe, expect, it, vi } from "vitest";
import {
  CANCELLED_RESULT,
  DECLINED_RESULT,
  pendingApprovalRunCountForTest,
  resolveToolApproval,
  skippedToolResult,
  approvalExemptionsFromServers,
  isApprovalExempt,
  toolsNeedingApproval,
  withToolApproval,
  type ApprovalRequestEvent,
} from "./tool-approval";
import type { MCPToolInfo } from "./mcp";

const info: Record<string, MCPToolInfo> = {
  post_message: { server: "slack", title: "Post a message", readOnly: false },
  list_channels: { server: "slack", readOnly: true },
  tavily_search: { server: "tavily", readOnly: false },
};

describe("toolsNeedingApproval", () => {
  const tools = { post_message: {}, list_channels: {}, tavily_search: {}, search_my_knowledge: {} };

  it("読むだけの印があるもの・MCP 以外の道具は確かめない（印の無いものは確かめる）", () => {
    expect(toolsNeedingApproval(tools, info, new Set())).toEqual(["post_message", "tavily_search"]);
  });

  it("今後確認しないと決めたサーバーの道具は確かめない", () => {
    expect(toolsNeedingApproval(tools, info, new Set(["tavily"]))).toEqual(["post_message"]);
  });
});

describe("確認の免除を道具の名前に絞る（厳選の接続先）", () => {
  const tavilyInfo: Record<string, MCPToolInfo> = {
    "tavily-search": { server: "tavily", readOnly: false },
    "tavily-extract": { server: "tavily", readOnly: false },
    // サーバーが全部に readOnlyHint を付けてきても、一覧に無い道具は確認する
    "tavily-crawl": { server: "tavily", readOnly: true },
    list_channels: { server: "slack", readOnly: true },
  };
  const tools = { "tavily-search": {}, "tavily-extract": {}, "tavily-crawl": {}, list_channels: {} };
  const { skipServers, freeTools } = approvalExemptionsFromServers([
    { name: "tavily", approvalFreeTools: ["tavily-search", "tavily_search"] },
    { name: "slack" },
  ]);

  it("検索だけ確認なし。extract・crawl は readOnlyHint があっても確認する", () => {
    expect(toolsNeedingApproval(tools, tavilyInfo, skipServers, freeTools)).toEqual(["tavily-extract", "tavily-crawl"]);
  });

  it("一覧を持たないサーバーの readOnlyHint による免除は従来どおり", () => {
    expect(isApprovalExempt("list_channels", tavilyInfo.list_channels, skipServers, freeTools)).toBe(true);
  });

  it("利用者が今後確認しないと決めたサーバーは、一覧にない道具も免除（従来どおり）", () => {
    const s = approvalExemptionsFromServers([{ name: "tavily", skipApproval: true, approvalFreeTools: ["tavily-search"] }]);
    expect(toolsNeedingApproval(tools, tavilyInfo, s.skipServers, s.freeTools)).toEqual([]);
  });
});

describe("同名のサーバーが並ぶとき", () => {
  it("免除は付けない（どちらの設定か分からないため。別コマンドが確認なしになるのを防ぐ）", () => {
    const s = approvalExemptionsFromServers([
      { name: "foo", skipApproval: true },
      { name: "foo" },
      { name: "bar", skipApproval: true },
    ]);
    expect(s.skipServers.has("foo")).toBe(false);
    expect(s.skipServers.has("bar")).toBe(true);
  });
});

function setup(timeoutMs?: number) {
  const execute = vi.fn(async (input: unknown) => ({ posted: input }));
  const original = { post_message: { description: "post", execute } };
  const events: ApprovalRequestEvent[] = [];
  const controller = new AbortController();
  const runId = crypto.randomUUID();
  const wrapped = withToolApproval({
    runId,
    tools: original,
    toolInfo: info,
    names: ["post_message"],
    emit: (e) => events.push(e),
    signal: controller.signal,
    ...(timeoutMs ? { timeoutMs } : {}),
  });
  const call = (input: unknown) =>
    (wrapped.tools.post_message as { execute: (i: unknown) => Promise<unknown> }).execute(input);
  return { execute, original, events, controller, runId, wrapped, call };
}

describe("withToolApproval", () => {
  it("呼ぶ前に approval_request を流し、許可されたら元の道具を呼ぶ", async () => {
    const { execute, events, runId, call, wrapped } = setup();
    const p = call({ text: "hi" });
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toMatchObject({
      type: "approval_request",
      run_id: runId,
      name: "post_message",
      title: "Post a message",
      server: "slack",
      input: { text: "hi" },
    });
    expect(execute).not.toHaveBeenCalled();
    expect(resolveToolApproval(runId, events[0].call_id, true)).toBe(true);
    await expect(p).resolves.toEqual({ posted: { text: "hi" } });
    expect(execute).toHaveBeenCalledTimes(1);
    wrapped.dispose();
  });

  it("断られたら呼ばずに、断られたことを AI に返す", async () => {
    const { execute, events, runId, call, wrapped } = setup();
    const p = call({ text: "hi" });
    await vi.waitFor(() => expect(events).toHaveLength(1));
    resolveToolApproval(runId, events[0].call_id, false);
    await expect(p).resolves.toEqual(skippedToolResult(DECLINED_RESULT));
    expect(execute).not.toHaveBeenCalled();
    wrapped.dispose();
  });

  it("返事が来ないまま時間が過ぎたら、やめたことにする", async () => {
    vi.useFakeTimers();
    try {
      const { execute, events, call, wrapped } = setup(1000);
      const p = call({});
      await vi.waitFor(() => expect(events).toHaveLength(1));
      await vi.advanceTimersByTimeAsync(1001);
      await expect(p).resolves.toEqual(skippedToolResult(DECLINED_RESULT));
      expect(execute).not.toHaveBeenCalled();
      wrapped.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("切断されたら待ちを捨てて呼ばない", async () => {
    const before = pendingApprovalRunCountForTest();
    const { execute, events, controller, call } = setup();
    const p = call({});
    await vi.waitFor(() => expect(events).toHaveLength(1));
    controller.abort();
    await expect(p).resolves.toEqual(skippedToolResult(CANCELLED_RESULT));
    expect(execute).not.toHaveBeenCalled();
    expect(pendingApprovalRunCountForTest()).toBe(before);
  });

  it("元の道具は書き換えない（プールの道具を使い回すため）", () => {
    const { original, wrapped } = setup();
    expect(wrapped.tools.post_message).not.toBe(original.post_message);
    expect(original.post_message.execute).toBeTypeOf("function");
    wrapped.dispose();
  });

  it("待っていない呼び出しへの返事は false", () => {
    expect(resolveToolApproval("no-run", "no-call", true)).toBe(false);
  });
});
