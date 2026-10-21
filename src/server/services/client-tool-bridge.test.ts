import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createClientToolBridge,
  resolveToolResult,
  normalizeClientTools,
  pendingRunCountForTest,
  MAX_TOOL_OUTPUT_CHARS,
  TIMEOUT_RESULT,
  type ToolRequestEvent,
} from "./client-tool-bridge.js";

type Exec = { execute: (input: unknown, opts: unknown) => Promise<string> };

function setup(opts?: { signal?: AbortSignal; timeoutMs?: number }) {
  const events: ToolRequestEvent[] = [];
  const bridge = createClientToolBridge({
    runId: "run-1",
    names: ["search_my_knowledge"],
    emit: (e) => events.push(e),
    ...opts,
  });
  const exec = (bridge.tools.search_my_knowledge as Exec).execute;
  return { events, bridge, exec };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("normalizeClientTools", () => {
  it("未知の名前・重複・非配列を落とす", () => {
    expect(normalizeClientTools(["search_my_knowledge", "x", "search_my_knowledge", "read_my_page"])).toEqual([
      "search_my_knowledge",
      "read_my_page",
    ]);
    expect(normalizeClientTools(undefined)).toEqual([]);
  });
});

describe("client-tool-bridge", () => {
  it("tool_request を書き出し、結果で解決する", async () => {
    const { events, exec, bridge } = setup();
    const p = exec({ query: "q" }, {});
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "tool_request", run_id: "run-1", name: "search_my_knowledge", input: { query: "q" } });
    expect(resolveToolResult("run-1", events[0].call_id, { output: "hit" })).toBe(true);
    await expect(p).resolves.toBe("hit");
    expect(pendingRunCountForTest()).toBe(0);
    bridge.dispose();
  });

  it("error は Error: 付きの結果になる", async () => {
    const { events, exec } = setup();
    const p = exec({ query: "q" }, {});
    resolveToolResult("run-1", events[0].call_id, { error: "boom" });
    await expect(p).resolves.toBe("Error: boom");
  });

  it("output は 20,000 字で切る", async () => {
    const { events, exec } = setup();
    const p = exec({ query: "q" }, {});
    resolveToolResult("run-1", events[0].call_id, { output: "a".repeat(MAX_TOOL_OUTPUT_CHARS + 5) });
    expect((await p).length).toBe(MAX_TOOL_OUTPUT_CHARS);
  });

  it("未知の call_id / run_id は false（404 相当）", async () => {
    const { events, exec } = setup();
    const p = exec({ query: "q" }, {});
    expect(resolveToolResult("run-1", "nope", { output: "x" })).toBe(false);
    expect(resolveToolResult("other", events[0].call_id, { output: "x" })).toBe(false);
    resolveToolResult("run-1", events[0].call_id, { output: "ok" });
    await p;
    // 解決済みの再送も false
    expect(resolveToolResult("run-1", events[0].call_id, { output: "x" })).toBe(false);
  });

  it("タイムアウトするとエラー文字列を返し、後から来た結果は 404 相当", async () => {
    vi.useFakeTimers();
    const { events, exec } = setup({ timeoutMs: 30_000 });
    const p = exec({ query: "q" }, {});
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(p).resolves.toBe(TIMEOUT_RESULT);
    expect(resolveToolResult("run-1", events[0].call_id, { output: "late" })).toBe(false);
    expect(pendingRunCountForTest()).toBe(0);
  });

  it("abort で待ちを全部捨てる", async () => {
    const ac = new AbortController();
    const { events, exec } = setup({ signal: ac.signal });
    const p1 = exec({ query: "a" }, {});
    const p2 = exec({ query: "b" }, {});
    ac.abort();
    await expect(p1).resolves.toMatch(/^Error:/);
    await expect(p2).resolves.toMatch(/^Error:/);
    expect(pendingRunCountForTest()).toBe(0);
    expect(resolveToolResult("run-1", events[0].call_id, { output: "x" })).toBe(false);
    // abort 後の新規呼び出しは request を出さない
    await expect(exec({ query: "c" }, {})).resolves.toMatch(/^Error:/);
    expect(events).toHaveLength(2);
  });

  it("dispose で Map から消える", async () => {
    const { exec, bridge } = setup();
    const p = exec({ query: "q" }, {});
    bridge.dispose();
    await p;
    expect(pendingRunCountForTest()).toBe(0);
  });
});
