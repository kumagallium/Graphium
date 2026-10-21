// runAgent の NDJSON 読み取り（clientTools 指定時）のテスト。fetch をモックする

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../skill/skill-service", () => ({ loadKnowledgeSchemaPrompt: vi.fn().mockResolvedValue("schema") }));

import { runAgent } from "./api";

const enc = new TextEncoder();
/** チャンクを分割して流す NDJSON ストリーム応答（行の途中で切れる場合も再現できる） */
function ndjson(chunks: string[]): Response {
  return new Response(new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  }), { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
}

const RESULT = { session_id: "s", message: "done", tool_calls: [], provenance_id: null, token_usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, model: null };
const req = { message: "q" };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("runAgent（clientTools）", () => {
  it("tool_request を実行して tool-result を POST し、result を返す", async () => {
    const lines = [
      JSON.stringify({ type: "run", run_id: "r1" }) + "\n",
      JSON.stringify({ type: "tool_request", run_id: "r1", call_id: "c1", name: "search_my_knowledge", input: { query: "q" } }).slice(0, 30),
      JSON.stringify({ type: "tool_request", run_id: "r1", call_id: "c1", name: "search_my_knowledge", input: { query: "q" } }).slice(30) + "\n",
      JSON.stringify({ type: "ping" }) + "\n",
      JSON.stringify({ type: "result", ...RESULT }) + "\n",
    ];
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith("/agent/run/tool-result") ? new Response(null, { status: 204 }) : ndjson(lines));
    const execute = vi.fn().mockResolvedValue("OUT");
    const res = await runAgent(req, undefined, { clientTools: { names: ["search_my_knowledge"], execute } });
    expect(res).toEqual(RESULT);
    expect(execute).toHaveBeenCalledWith("search_my_knowledge", { query: "q" });
    const runCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/agent/run"))!;
    expect(JSON.parse(runCall[1].body).client_tools).toEqual(["search_my_knowledge"]);
    await vi.waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/agent/run/tool-result"));
      expect(post).toBeTruthy();
      expect(JSON.parse(post![1].body)).toEqual({ run_id: "r1", call_id: "c1", output: "OUT" });
    });
  });

  it("execute が投げたら error として返す", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith("/agent/run/tool-result")
        ? new Response(null, { status: 204 })
        : ndjson([
            JSON.stringify({ type: "tool_request", run_id: "r1", call_id: "c1", name: "x", input: {} }) + "\n",
            JSON.stringify({ type: "result", ...RESULT }) + "\n",
          ]));
    const execute = vi.fn().mockRejectedValue(new Error("bad"));
    await runAgent(req, undefined, { clientTools: { names: ["x"], execute } });
    await vi.waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/agent/run/tool-result"));
      expect(JSON.parse(post![1].body)).toMatchObject({ call_id: "c1", error: "bad" });
    });
  });

  it("error 行は code 付き Error を投げる", async () => {
    fetchMock.mockResolvedValue(ndjson([JSON.stringify({ type: "error", error: "no model", code: "NO_MODEL_REGISTERED" }) + "\n"]));
    await expect(runAgent(req, undefined, { clientTools: { names: ["x"], execute: vi.fn() } }))
      .rejects.toMatchObject({ message: "no model", code: "NO_MODEL_REGISTERED" });
  });

  it("result 無しで終わったらエラー", async () => {
    fetchMock.mockResolvedValue(ndjson([JSON.stringify({ type: "run", run_id: "r1" }) + "\n"]));
    await expect(runAgent(req, undefined, { clientTools: { names: ["x"], execute: vi.fn() } }))
      .rejects.toThrow(/without a result/);
  });

  it("オプション未指定なら従来どおり JSON を返し client_tools を付けない", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(RESULT), { status: 200 }));
    expect(await runAgent(req)).toEqual(RESULT);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("client_tools");
  });
});
