import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { __resetCapturedAuthTokenForTest } from "../auth-token.js";
import { __resetConversationListingCacheForTest } from "./conversations.js";

const SID1 = "11111111-2222-4333-8444-555555555555";
const SID2 = "22222222-3333-4444-8555-666666666666";
const SID3 = "33333333-4444-4555-8666-777777777777";
const DIR_BAKERY = "-Users-example-bakery-notes";
const DIR_CURRY = "-Users-example-curry-lab";

function rec(sid: string, type: "user" | "assistant", text: string, cwd: string, at: string): string {
  return JSON.stringify({
    type,
    uuid: `${type}-${sid}-${text}`,
    sessionId: sid,
    cwd,
    timestamp: at,
    ...(type === "user" ? { origin: { kind: "human" } } : {}),
    message: { role: type, content: text },
  });
}

const ENV_KEYS = ["GRAPHIUM_DESKTOP", "CLAUDE_CONFIG_DIR", "GRAPHIUM_AUTH_TOKEN"] as const;
const saved: Record<string, string | undefined> = {};
let config: string;
let outside: string;

function put(root: string, dir: string, sid: string, lines: string[]): void {
  mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, dir, `${sid}.jsonl`), lines.join("\n") + "\n");
}

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  config = mkdtempSync(join(tmpdir(), "conv-route-config-"));
  outside = mkdtempSync(join(tmpdir(), "conv-route-outside-"));
  process.env.CLAUDE_CONFIG_DIR = config;
  process.env.GRAPHIUM_DESKTOP = "1";
  delete process.env.GRAPHIUM_AUTH_TOKEN;
  __resetCapturedAuthTokenForTest();
  __resetConversationListingCacheForTest();
  const p = join(config, "projects");
  put(p, DIR_BAKERY, SID1, [
    rec(SID1, "user", "ライ麦を足したい", "/Users/example/bakery-notes", "2026-11-03T00:00:00.000Z"),
    rec(SID1, "assistant", "水分を少し増やしましょう", "/Users/example/bakery-notes", "2026-11-03T00:01:00.000Z"),
  ]);
  put(p, DIR_BAKERY, SID2, [
    rec(SID2, "user", "発酵時間を延ばす", "/Users/example/bakery-notes", "2026-11-05T00:00:00.000Z"),
  ]);
  // 本人の発言なし（会話の最初が長い依頼文だけ）
  put(p, DIR_CURRY, SID3, [
    rec(SID3, "user", "スパイスの配合を確かめる作業を頼みます。".repeat(60), "/Users/example/curry-lab", "2026-11-06T00:00:00.000Z"),
    rec(SID3, "assistant", "回しました", "/Users/example/curry-lab", "2026-11-06T00:01:00.000Z"),
  ]);
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  __resetCapturedAuthTokenForTest();
  __resetConversationListingCacheForTest();
  rmSync(config, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

const app = () => createApp({ mode: "node" });
const post = (path: string, body: unknown = {}, headers: Record<string, string> = {}) =>
  app().request(`/api/conversations${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("デスクトップ版でないとき", () => {
  it("両方の口が 404 NOT_AVAILABLE で、記録があっても読まない", async () => {
    delete process.env.GRAPHIUM_DESKTOP;
    for (const [path, body] of [
      ["/claude-code/workdirs", {}],
      ["/claude-code/read", { sessions: [{ dirName: DIR_BAKERY, fileName: `${SID1}.jsonl` }] }],
    ] as const) {
      const res = await post(path, body);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Not available", code: "NOT_AVAILABLE" });
    }
  });
});

describe("POST /claude-code/workdirs", () => {
  it("作業フォルダごとの数字と、本人の発言がある会話だけの sessionRefs を返す", async () => {
    const res = await post("/claude-code/workdirs");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.searchedPath.replace(/\\/g, "/")).toContain("projects");
    const bakery = json.workdirs.find((w: any) => w.workdir === "/Users/example/bakery-notes");
    const curry = json.workdirs.find((w: any) => w.workdir === "/Users/example/curry-lab");
    expect(bakery.sessions).toBe(2);
    expect(bakery.unattendedSessions).toBe(0);
    expect(bakery.ownTurns).toBe(2);
    // 新しい順
    expect(bakery.sessionRefs).toEqual([
      { dirName: DIR_BAKERY, fileName: `${SID2}.jsonl` },
      { dirName: DIR_BAKERY, fileName: `${SID1}.jsonl` },
    ]);
    expect(curry.sessions).toBe(1);
    expect(curry.unattendedSessions).toBe(1);
    expect(curry.sessionRefs).toEqual([]);
  });

  it("searchedPath はホームの下なら ~ に置き換える", async () => {
    process.env.CLAUDE_CONFIG_DIR = join(homedir(), ".claude-example-nonexistent");
    const json = await (await post("/claude-code/workdirs")).json();
    expect(json.searchedPath.replace(/\\/g, "/")).toBe("~/.claude-example-nonexistent/projects");
    expect(json.workdirs).toEqual([]);
  });

  it("ホームの外なら絶対パスのまま", async () => {
    const json = await (await post("/claude-code/workdirs")).json();
    expect(json.searchedPath).toBe(join(config, "projects"));
  });
});

describe("一覧の覚え", () => {
  it("続けて呼ぶと読み直さず、リセットすると増える。同時に呼んでも同じ結果", async () => {
    const [a, b] = await Promise.all([post("/claude-code/workdirs"), post("/claude-code/workdirs")]);
    const first = await a.json();
    expect(await b.json()).toEqual(first);
    const count = (j: any) => j.workdirs.reduce((n: number, w: any) => n + w.sessions, 0);
    expect(count(first)).toBe(3);

    put(join(config, "projects"), DIR_BAKERY, "44444444-5555-4666-8777-888888888888", [
      rec("44444444-5555-4666-8777-888888888888", "user", "バゲットを焼く", "/Users/example/bakery-notes", "2026-11-07T00:00:00.000Z"),
    ]);
    expect(count(await (await post("/claude-code/workdirs")).json())).toBe(3);
    __resetConversationListingCacheForTest();
    expect(count(await (await post("/claude-code/workdirs")).json())).toBe(4);
  });

  it("CLAUDE_CONFIG_DIR が変わったら覚えを使わない", async () => {
    await post("/claude-code/workdirs");
    process.env.CLAUDE_CONFIG_DIR = outside;
    const json = await (await post("/claude-code/workdirs")).json();
    expect(json.workdirs).toEqual([]);
  });
});

describe("POST /claude-code/read", () => {
  const ref = (fileName: string, dirName = DIR_BAKERY) => ({ dirName, fileName });

  it("本人の発言を原文のまま返し、重複は 1 回だけ読む", async () => {
    const res = await post("/claude-code/read", {
      sessions: [ref(`${SID1}.jsonl`), ref(`${SID1}.jsonl`)],
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.failed).toBe(0);
    expect(json.materials).toHaveLength(1);
    const texts = json.materials[0].turns.map((t: any) => t.text);
    expect(texts).toContain("ライ麦を足したい");
  });

  it("大きすぎる会話は返さず、failed に数える", async () => {
    const BIG = "99999999-2222-4333-8444-555555555599";
    put(join(config, "projects"), DIR_BAKERY, BIG, [
      rec(BIG, "user", "生地の様子を書きます", "/Users/example/bakery-notes", "2026-11-07T00:00:00.000Z"),
      rec(BIG, "user", "こ".repeat(5_100_000), "/Users/example/bakery-notes", "2026-11-07T00:01:00.000Z"),
    ]);
    const res = await post("/claude-code/read", { sessions: [ref(`${BIG}.jsonl`), ref(`${SID1}.jsonl`)] });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.failed).toBe(1);
    expect(json.materials.map((m: any) => m.sessionId)).toEqual([SID1]);
  });

  it("同時に来た要求も、それぞれ正しい結果を返す（1 本ずつ読む）", async () => {
    const [a, b] = await Promise.all([
      post("/claude-code/read", { sessions: [ref(`${SID1}.jsonl`)] }),
      post("/claude-code/read", { sessions: [ref(`${SID2}.jsonl`)] }),
    ]);
    expect((await a.json()).materials[0].sessionId).toBe(SID1);
    expect((await b.json()).materials[0].sessionId).toBe(SID2);
  });

  it("不正な名前・無い記録は failed に数え、baseDir の外のファイルは読まない", async () => {
    // 外に同名の記録を置く
    put(outside, DIR_BAKERY, SID1, [
      rec(SID1, "user", "外の秘密のレシピ", "/Users/example/outside", "2026-11-03T00:00:00.000Z"),
    ]);
    writeFileSync(join(outside, "x.jsonl"), "{}\n");
    const res = await post("/claude-code/read", {
      sessions: [
        { dirName: "..", fileName: `${SID1}.jsonl` },
        { dirName: DIR_BAKERY, fileName: "../x.jsonl" },
        { dirName: outside, fileName: `${SID1}.jsonl` },
        { dirName: DIR_BAKERY, fileName: join(outside, DIR_BAKERY, `${SID1}.jsonl`) },
        ref("99999999-0000-4000-8000-000000000000.jsonl"),
      ],
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.materials).toEqual([]);
    expect(json.failed).toBe(5);
    expect(JSON.stringify(json)).not.toContain("外の秘密のレシピ");
  });

  it("baseDir を送っても無視される", async () => {
    put(outside, DIR_BAKERY, SID2, [
      rec(SID2, "user", "外の秘密のレシピ", "/Users/example/outside", "2026-11-03T00:00:00.000Z"),
    ]);
    const res = await post("/claude-code/read", {
      sessions: [ref(`${SID2}.jsonl`)],
      baseDir: outside,
    });
    const json = await res.json();
    expect(JSON.stringify(json)).not.toContain("外の秘密のレシピ");
    expect(json.materials[0].turns.map((t: any) => t.text)).toContain("発酵時間を延ばす");
  });

  it("body の形が違えば 400", async () => {
    const ok = ref(`${SID1}.jsonl`);
    const bodies: unknown[] = [
      {},
      { sessions: "x" },
      { sessions: [] },
      { sessions: Array.from({ length: 51 }, () => ok) },
      { sessions: [{ dirName: DIR_BAKERY }] },
      { sessions: [{ dirName: 1, fileName: "a.jsonl" }] },
      { sessions: [null] },
      null,
    ];
    for (const body of bodies) {
      const res = await post("/claude-code/read", body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid request" });
    }
    const broken = await app().request("/api/conversations/claude-code/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(broken.status).toBe(400);
  });

  it("50 件ちょうどは通る", async () => {
    const res = await post("/claude-code/read", { sessions: Array.from({ length: 50 }, () => ref(`${SID1}.jsonl`)) });
    expect(res.status).toBe(200);
  });
});

describe("app.ts の検査", () => {
  it("他のサイトの Origin は 403、Origin 無しは通る", async () => {
    const evil = await post("/claude-code/workdirs", {}, { Origin: "https://evil.example" });
    expect(evil.status).toBe(403);
    expect((await post("/claude-code/workdirs")).status).toBe(200);
  });

  it("合言葉があるとき、ヘッダー無しは 401、X-Graphium-Token 付きは通る", async () => {
    process.env.GRAPHIUM_AUTH_TOKEN = "sourdough-secret";
    expect((await post("/claude-code/workdirs")).status).toBe(401);
    expect((await post("/claude-code/workdirs", {}, { "X-Graphium-Token": "wrong" })).status).toBe(401);
    expect((await post("/claude-code/workdirs", {}, { "X-Graphium-Token": "sourdough-secret" })).status).toBe(200);
  });

  it("GET では記録を返さない", async () => {
    for (const path of ["/claude-code/workdirs", "/claude-code/read"]) {
      const res = await app().request(`/api/conversations${path}`);
      expect([404, 405]).toContain(res.status);
      expect(await res.text()).not.toContain("ライ麦");
    }
  });
});
