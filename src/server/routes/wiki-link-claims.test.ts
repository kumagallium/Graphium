// POST /api/wiki/link-claims-to-topics の入力検査（AI を呼ぶ前に断る）
import { describe, expect, it } from "vitest";
import { createApp } from "../app";

const claim = { id: "c1", title: "知見" };
const topic = { id: "t1", title: "トピック" };

async function post(body: unknown, headers: Record<string, string> = {}) {
  const app = createApp({ mode: "node" });
  return app.request("http://localhost/api/wiki/link-claims-to-topics", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/wiki/link-claims-to-topics", () => {
  it.each([
    ["知見が無い", { topics: [topic] }],
    ["知見が空", { claims: [], topics: [topic] }],
    ["知見の形が違う", { claims: [{ id: 1, title: "x" }], topics: [topic] }],
    ["トピックが無い", { claims: [claim] }],
    ["定義の冒頭が文字列でない", { claims: [claim], topics: [{ ...topic, oneLiner: 3 }] }],
    ["知見が多すぎる", { claims: Array.from({ length: 201 }, (_, i) => ({ id: `c${i}`, title: "x" })), topics: [topic] }],
  ])("%s は 400", async (_name, body) => {
    expect((await post(body)).status).toBe(400);
  });

  it("他のサイトからの呼び出しは 403", async () => {
    const res = await post({ claims: [claim], topics: [topic] }, { Origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });
});
