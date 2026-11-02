// /api/clip（Web クリップの受け口）: 合言葉・入力の整形・受け取り待ちの出し入れ

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import app, { normalizeIncomingClip, readOrCreateClipToken, tokenMatches, CLIP_LIMITS } from "./clip.js";

let dir: string;
let prevDataDir: string | undefined;
let prevAuth: string | undefined;

beforeEach(() => {
  prevDataDir = process.env.DATA_DIR;
  prevAuth = process.env.GRAPHIUM_AUTH_TOKEN;
  delete process.env.GRAPHIUM_AUTH_TOKEN;
  dir = mkdtempSync(join(tmpdir(), "graphium-clip-test-"));
  process.env.DATA_DIR = dir;
});

afterEach(() => {
  if (prevDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevDataDir;
  if (prevAuth === undefined) delete process.env.GRAPHIUM_AUTH_TOKEN;
  else process.env.GRAPHIUM_AUTH_TOKEN = prevAuth;
  rmSync(dir, { recursive: true, force: true });
});

function post(body: unknown, token?: string) {
  return app.request("/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "X-Graphium-Clip-Token": token } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("合言葉", () => {
  it("初回に 256 bit の合言葉を作り、以後は同じものを返す。ファイルは本人だけ読める", () => {
    const a = readOrCreateClipToken();
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(readOrCreateClipToken()).toBe(a);
    if (process.platform !== "win32") {
      expect(statSync(join(dir, "clip", "token")).mode & 0o077).toBe(0);
    }
  });

  it("tokenMatches は長さ違い・空を false にする", () => {
    expect(tokenMatches(undefined, "abc")).toBe(false);
    expect(tokenMatches("ab", "abc")).toBe(false);
    expect(tokenMatches("abc", "abc")).toBe(true);
  });

  it("合言葉なし・違う合言葉の POST は 401 で、受け取り待ちに何も置かない", async () => {
    readOrCreateClipToken();
    expect((await post({ url: "https://example.com" })).status).toBe(401);
    expect((await post({ url: "https://example.com" }, "x".repeat(43))).status).toBe(401);
    const inbox = join(dir, "clip", "inbox");
    expect(existsSync(inbox) ? readdirSync(inbox).length : 0).toBe(0);
  });

  it("ping は合言葉が合えば 200、違えば 401", async () => {
    const token = readOrCreateClipToken();
    expect((await app.request("/ping", { headers: { "X-Graphium-Clip-Token": token } })).status).toBe(200);
    expect((await app.request("/ping")).status).toBe(401);
  });

  it("作り直すと古い合言葉は通らなくなる", async () => {
    const old = readOrCreateClipToken();
    const res = await app.request("/pairing/reset", { method: "POST" });
    const { code } = (await res.json()) as { code: string };
    const fresh = code.slice(code.indexOf(".") + 1);
    expect(fresh).not.toBe(old);
    expect((await post({ url: "https://example.com" }, old)).status).toBe(401);
    expect((await post({ url: "https://example.com" }, fresh)).status).toBe(201);
  });

  it("ペアリングコードは <port>.<token>", async () => {
    const token = readOrCreateClipToken();
    const { code } = (await (await app.request("/pairing")).json()) as { code: string };
    expect(code).toBe(`${Number(process.env.PORT ?? 3001)}.${token}`);
  });

  it("GRAPHIUM_AUTH_TOKEN があるとアプリ向けの口はそのトークンが要る", async () => {
    process.env.GRAPHIUM_AUTH_TOKEN = "server-secret";
    expect((await app.request("/pairing")).status).toBe(401);
    expect((await app.request("/inbox")).status).toBe(401);
    expect((await app.request("/inbox", { headers: { "X-Graphium-Token": "server-secret" } })).status).toBe(200);
  });
});

describe("受け取り待ち", () => {
  it("POST した順（clippedAt 順）に一覧に出て、DELETE で消える", async () => {
    const token = readOrCreateClipToken();
    const r1 = await post({ url: "https://a.example/x", title: "A", text: "two", clippedAt: "2026-11-03T10:00:02Z" }, token);
    const r2 = await post({ url: "https://a.example/x", title: "A", text: "one", clippedAt: "2026-11-03T10:00:01Z" }, token);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    const { clips } = (await (await app.request("/inbox")).json()) as { clips: { id: string; text: string }[] };
    expect(clips.map((c) => c.text)).toEqual(["one", "two"]);
    expect((await app.request(`/inbox/${clips[0].id}`, { method: "DELETE" })).status).toBe(200);
    const after = (await (await app.request("/inbox")).json()) as { clips: unknown[] };
    expect(after.clips).toHaveLength(1);
  });

  it("DELETE は id の形を確かめる（パスを渡させない）", async () => {
    expect((await app.request("/inbox/..%2Ftoken", { method: "DELETE" })).status).toBe(400);
  });

  it("http(s) 以外の URL・壊れた JSON は 400", async () => {
    const token = readOrCreateClipToken();
    expect((await post({ url: "javascript:alert(1)" }, token)).status).toBe(400);
    expect((await post({ url: "file:///etc/passwd" }, token)).status).toBe(400);
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Graphium-Clip-Token": token },
      body: "{",
    });
    expect(res.status).toBe(400);
  });

  it("本文が大きすぎる送信は 413", async () => {
    const token = readOrCreateClipToken();
    const res = await post({ url: "https://example.com", text: "a".repeat(CLIP_LIMITS.body + 10) }, token);
    expect(res.status).toBe(413);
  });
});

describe("normalizeIncomingClip", () => {
  const now = new Date("2026-11-03T12:00:00Z");
  const id = "00000000-0000-4000-8000-000000000000";

  it("長さを切り、制御文字を落とし、改行は残す", () => {
    const clip = normalizeIncomingClip(
      { url: "https://example.com", title: "t\u0000itle", text: `a\nb\u0007${"x".repeat(CLIP_LIMITS.text)}` },
      now,
      id,
    )!;
    expect(clip.title).toBe("title");
    expect(clip.text!.startsWith("a\nb")).toBe(true);
    expect(clip.text!.length).toBe(CLIP_LIMITS.text);
  });

  it("id と受け取り時刻は sidecar が付ける。clippedAt が壊れていれば受け取り時刻", () => {
    const clip = normalizeIncomingClip({ id: "evil", url: "https://example.com", clippedAt: "nope" }, now, id)!;
    expect(clip.id).toBe(id);
    expect(clip.clippedAt).toBe(now.toISOString());
    expect(clip.receivedAt).toBe(now.toISOString());
  });

  it("DOI は 10.xxxx/... の形だけ残す。空の text は持たない", () => {
    const ok = normalizeIncomingClip({ url: "https://example.com", doi: "10.1038/s41586-020-2649-2", text: "  " }, now, id)!;
    expect(ok.doi).toBe("10.1038/s41586-020-2649-2");
    expect(ok.text).toBeUndefined();
    const bad = normalizeIncomingClip({ url: "https://example.com", doi: "not a doi" }, now, id)!;
    expect(bad.doi).toBeUndefined();
  });

  it("URL が長すぎれば null", () => {
    expect(normalizeIncomingClip({ url: `https://example.com/${"a".repeat(CLIP_LIMITS.url)}` }, now, id)).toBeNull();
  });
});
