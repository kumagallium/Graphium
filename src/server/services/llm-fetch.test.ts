// LLM 用 fetch の待ち時間の上限を、実際の HTTP サーバー相手に確かめる。
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLlmFetch, LLM_HTTP_TIMEOUT_MS } from "./llm-fetch";

// ヘッダーを返すまで HEADER_DELAY_MS 待つサーバー（非ストリーミング生成の応答を模す）
const HEADER_DELAY_MS = 2_500;
let server: Server;
let url: string;

beforeAll(async () => {
  server = createServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    }, HEADER_DELAY_MS);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("createLlmFetch", () => {
  it("上限より遅いヘッダーは打ち切る", { timeout: 15_000 }, async () => {
    // undici の時間切れ判定は約 1 秒刻みなので、遅延との差を大きく取る
    const fetchShort = createLlmFetch(1_000);
    await expect(fetchShort(url)).rejects.toThrow();
  });

  it("上限内なら標準 fetch と同じく応答を返す", { timeout: 15_000 }, async () => {
    const fetchLong = createLlmFetch(10_000);
    const res = await fetchLong(url, { method: "POST", body: "{}" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("abortSignal で中断できる", async () => {
    const fetchLong = createLlmFetch(10_000);
    const ac = new AbortController();
    const p = fetchLong(url, { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toThrow();
  });

  it("既定の上限は Node 標準（300 秒）より長い", () => {
    expect(LLM_HTTP_TIMEOUT_MS).toBeGreaterThan(300_000);
  });
});

describe("createLlmFetch の記録", () => {
  it("成功した呼び出しの所要時間とホストを 1 行残す（パスやクエリは残さない）", { timeout: 15_000 }, async () => {
    const lines: string[] = [];
    const f = createLlmFetch(10_000, { log: (l) => lines.push(l) });
    await f(`${url}v1/chat?key=secret`, { method: "POST", body: "{}" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[llm-http\] 200 headers after \d+\.\ds host=127\.0\.0\.1:\d+$/);
    expect(lines[0]).not.toContain("secret");
  });

  it("待ちが長いと「まだ待っている」を残し、時間切れは failed として残す", { timeout: 15_000 }, async () => {
    const lines: string[] = [];
    const f = createLlmFetch(1_000, { log: (l) => lines.push(l), slowNoticeMs: 300 });
    await expect(f(url)).rejects.toThrow();
    expect(lines.some((l) => l.startsWith("[llm-http] still waiting "))).toBe(true);
    expect(lines[lines.length - 1]).toMatch(/^\[llm-http\] failed after \d+\.\ds host=\S+ reason=\S+$/);
  });

  it("中断は aborted として残す", async () => {
    const lines: string[] = [];
    const f = createLlmFetch(10_000, { log: (l) => lines.push(l) });
    const ac = new AbortController();
    const p = f(url, { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toThrow();
    expect(lines[lines.length - 1]).toMatch(/^\[llm-http\] aborted after /);
  });
});
