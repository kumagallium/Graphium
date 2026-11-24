// guard.ts のテスト（起動検知の判定・書き込みロック）と cleanup.ts

import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTempFiles } from "./cleanup";
import {
  acquireWriteLock,
  appRunningMessage,
  BUSY_MESSAGE,
  detectLiveApp,
  detectRunningApp,
  readHeartbeat,
  readOpenWikiIds,
  writeLiveNotice,
} from "./guard";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const iso = (agoSec: number) => new Date(NOW - agoSec * 1000).toISOString();

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "graphium-guard-"));
  await mkdir(join(root, "appdata"), { recursive: true });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const putHb = (hb: unknown) => writeFile(join(root, "appdata", "app-heartbeat.json"), JSON.stringify(hb));
const deps = (alive: boolean) => ({ isPidAlive: () => alive, now: () => NOW });

describe("readHeartbeat", () => {
  it("無い・壊れていれば null", async () => {
    expect(await readHeartbeat(root)).toBeNull();
    await writeFile(join(root, "appdata", "app-heartbeat.json"), "{oops");
    expect(await readHeartbeat(root)).toBeNull();
  });
  it("読める", async () => {
    await putHb({ via: "web", at: iso(1) });
    expect((await readHeartbeat(root))?.via).toBe("web");
  });
});

describe("detectRunningApp", () => {
  it("ハートビートが無ければ起動していない", async () => {
    expect((await detectRunningApp(root, deps(true))).running).toBe(false);
  });
  it("pid が死んでいれば起動していない", async () => {
    await putHb({ pid: 123, via: "desktop", at: iso(5) });
    const r = await detectRunningApp(root, deps(false));
    expect(r).toMatchObject({ running: false, reason: "pid-dead" });
  });
  it("pid が生きていて新しければ起動中", async () => {
    await putHb({ pid: 123, via: "desktop", at: iso(5) });
    const r = await detectRunningApp(root, deps(true));
    expect(r).toMatchObject({ running: true, reason: "pid-alive", via: "desktop", ageSec: 5 });
  });
  it("pid の生死: 実プロセスの ESRCH は死・自分自身は生", async () => {
    await putHb({ pid: process.pid, via: "desktop", at: new Date().toISOString() });
    expect((await detectRunningApp(root)).running).toBe(true);
    await putHb({ pid: 2 ** 22 + 12345, via: "desktop", at: new Date().toISOString() });
    expect((await detectRunningApp(root)).running).toBe(false);
  });
  it("pid あり: at の境界 24 時間 - 1 秒は起動中・+ 1 秒は使い回しで起動していない", async () => {
    await putHb({ pid: 1, at: iso(600) });
    expect((await detectRunningApp(root, deps(true))).running).toBe(true);
    await putHb({ pid: 1, at: iso(86_399) });
    expect((await detectRunningApp(root, deps(true))).running).toBe(true);
    await putHb({ pid: 1, at: iso(86_401) });
    expect(await detectRunningApp(root, deps(true))).toMatchObject({ running: false, reason: "pid-reused" });
  });
  it("pid なし: at の境界 89 秒は起動中・91 秒は起動していない", async () => {
    await putHb({ via: "web", at: iso(89) });
    expect(await detectRunningApp(root, deps(false))).toMatchObject({ running: true, reason: "fresh" });
    await putHb({ via: "web", at: iso(91) });
    expect(await detectRunningApp(root, deps(false))).toMatchObject({ running: false, reason: "stale" });
  });
  it("pagehide の at: 0 は終了済み", async () => {
    await putHb({ via: "web", at: 0 });
    expect(await detectRunningApp(root, deps(false))).toMatchObject({ running: false, reason: "exited" });
  });
});

describe("appRunningMessage", () => {
  it("先頭は APP_RUNNING:・web は経過秒と残ることを添える", () => {
    const d = appRunningMessage({ running: true, reason: "pid-alive", via: "desktop", ageSec: 3 });
    expect(d.startsWith("APP_RUNNING:")).toBe(true);
    expect(d).not.toContain("90 秒");
    const w = appRunningMessage({ running: true, reason: "fresh", via: "web", ageSec: 42 });
    expect(w).toContain("90 秒ほど残ることがあります");
    expect(w).toContain("42 秒前");
    expect(d).toContain("一度起動してから終了してください");
    expect(w).not.toContain("一度起動してから終了してください");
  });
});

describe("acquireWriteLock", () => {
  const lockPath = () => join(root, "appdata", "mcp-write-lock.json");

  it("取得でき、解放で消える。一時ファイルは残らない", async () => {
    const lock = await acquireWriteLock(root, deps(true));
    expect(lock.ok).toBe(true);
    if (!lock.ok) return;
    const body = JSON.parse(await readFile(lockPath(), "utf8"));
    expect(body.pid).toBe(process.pid);
    expect(typeof body.token).toBe("string");
    await lock.refresh();
    await lock.release();
    expect(await readdir(join(root, "appdata"))).toEqual([]);
  });

  it("持ち主が生きていて新しければ BUSY", async () => {
    const first = await acquireWriteLock(root, deps(true));
    expect(first.ok).toBe(true);
    const second = await acquireWriteLock(root, deps(true));
    expect(second).toEqual({ ok: false, message: BUSY_MESSAGE });
    expect(BUSY_MESSAGE.startsWith("BUSY:")).toBe(true);
  });

  it("持ち主の pid が死んでいれば奪える", async () => {
    await writeFile(lockPath(), JSON.stringify({ pid: 99, token: "old", at: iso(1) }));
    const lock = await acquireWriteLock(root, deps(false));
    expect(lock.ok).toBe(true);
    expect(JSON.parse(await readFile(lockPath(), "utf8")).token).not.toBe("old");
  });

  it("at が古ければ（60 秒超）奪える・59 秒は BUSY", async () => {
    await writeFile(lockPath(), JSON.stringify({ pid: 99, token: "old", at: iso(59) }));
    expect((await acquireWriteLock(root, deps(true))).ok).toBe(false);
    await writeFile(lockPath(), JSON.stringify({ pid: 99, token: "old", at: iso(61) }));
    expect((await acquireWriteLock(root, deps(true))).ok).toBe(true);
  });

  it("中身が空のロックは少し待って読み直す: そのまま空なら古いものとして奪う", async () => {
    await writeFile(lockPath(), "");
    const lock = await acquireWriteLock(root, deps(true));
    expect(lock.ok).toBe(true);
  });

  it("空のロックでも、待つ間に書き終わった相手が生きていれば BUSY", async () => {
    await writeFile(lockPath(), "");
    setTimeout(() => {
      void writeFile(lockPath(), JSON.stringify({ pid: 99, token: "other", at: new Date(NOW).toISOString() }));
    }, 20);
    expect(await acquireWriteLock(root, deps(true))).toEqual({ ok: false, message: BUSY_MESSAGE });
  });

  it("refresh は at を更新し token はそのまま", async () => {
    let t = NOW;
    const lock = await acquireWriteLock(root, { isPidAlive: () => true, now: () => t });
    if (!lock.ok) throw new Error("取得できない");
    const before = JSON.parse(await readFile(lockPath(), "utf8"));
    t += 30_000;
    await lock.refresh();
    const after = JSON.parse(await readFile(lockPath(), "utf8"));
    expect(after.token).toBe(before.token);
    expect(after.at).not.toBe(before.at);
  });

  it("token が一致しないときは消さない（奪われたあとの release）", async () => {
    const lock = await acquireWriteLock(root, deps(true));
    if (!lock.ok) throw new Error("取得できない");
    await writeFile(lockPath(), JSON.stringify({ pid: 1, token: "other", at: iso(0) }));
    await lock.release();
    expect(JSON.parse(await readFile(lockPath(), "utf8")).token).toBe("other");
  });
});

describe("cleanupTempFiles", () => {
  it("appdata / wiki / notes の *.tmp-* だけを消す・無いディレクトリは無視", async () => {
    await mkdir(join(root, "wiki"));
    await writeFile(join(root, "appdata", "x.json.tmp-123"), "");
    await writeFile(join(root, "appdata", "x.json"), "{}");
    await writeFile(join(root, "wiki", "w1.json.tmp-9"), "");
    expect(await cleanupTempFiles(root)).toBe(2);
    expect(await readdir(join(root, "appdata"))).toEqual(["x.json"]);
    expect(await readdir(join(root, "wiki"))).toEqual([]);
  });
});

describe("detectLiveApp / readOpenWikiIds / writeLiveNotice", () => {
  const putOpen = (v: unknown) => writeFile(join(root, "appdata", "app-open-pages.json"), JSON.stringify(v));
  const open = (at: string, wikiIds: string[] = ["a"]) => ({ formatVersion: 1, at, wikiIds });

  it("起動していなければ stopped", async () => {
    expect((await detectLiveApp(root, deps(true))).mode).toBe("stopped");
  });

  it("起動中で open-pages が無ければ blocked", async () => {
    await putHb({ via: "web", at: iso(1), startedAt: iso(100) });
    expect((await detectLiveApp(root, deps(true))).mode).toBe("blocked");
  });

  it("open-pages の at が startedAt より古ければ blocked（前回の起動の残り）", async () => {
    await putHb({ via: "web", at: iso(1), startedAt: iso(100) });
    await putOpen(open(iso(200)));
    expect((await detectLiveApp(root, deps(true))).mode).toBe("blocked");
  });

  it("startedAt が無い・読めなければ blocked", async () => {
    await putHb({ via: "web", at: iso(1) });
    await putOpen(open(iso(10)));
    expect((await detectLiveApp(root, deps(true))).mode).toBe("blocked");
    await putHb({ via: "web", at: iso(1), startedAt: "xxx" });
    expect((await detectLiveApp(root, deps(true))).mode).toBe("blocked");
  });

  it("open-pages が startedAt 以降なら live（開いているページを返す）", async () => {
    await putHb({ via: "web", at: iso(1), startedAt: iso(100) });
    await putOpen(open(iso(50), ["a", "b"]));
    const r = await detectLiveApp(root, deps(true));
    expect(r.mode).toBe("live");
    if (r.mode === "live") expect([...r.openWikiIds].sort()).toEqual(["a", "b"]);
  });

  it("壊れた open-pages は blocked・readOpenWikiIds は null", async () => {
    await putHb({ via: "web", at: iso(1), startedAt: iso(100) });
    await writeFile(join(root, "appdata", "app-open-pages.json"), "{oops");
    expect((await detectLiveApp(root, deps(true))).mode).toBe("blocked");
    expect(await readOpenWikiIds(root)).toBeNull();
    await putOpen({ formatVersion: 1, at: "bad", wikiIds: [] });
    expect(await readOpenWikiIds(root)).toBeNull();
  });

  it("writeLiveNotice は appdata に知らせを 1 件書く（一時ファイルは残さない）", async () => {
    await writeLiveNotice(root, { client: "c", pages: [{ wikiId: "w1", title: "題", created: true }] });
    const files = (await readdir(join(root, "appdata"))).filter((f) => f.startsWith("mcp-notice-"));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.json$/);
    const body = JSON.parse(await readFile(join(root, "appdata", files[0]), "utf8"));
    expect(body.formatVersion).toBe(1);
    expect(body.client).toBe("c");
    expect(body.pages).toEqual([{ wikiId: "w1", title: "題", created: true }]);
    expect(Number.isNaN(Date.parse(body.at))).toBe(false);
  });
});

describe("detectLiveApp の時刻の境界", () => {
  const putOpen = (at: string) =>
    writeFile(join(root, "appdata", "app-open-pages.json"), JSON.stringify({ formatVersion: 1, at, wikiIds: [] }));

  it("at と startedAt が等しければ live", async () => {
    await putHb({ via: "web", at: iso(1), startedAt: iso(50) });
    await putOpen(iso(50));
    expect((await detectLiveApp(root, deps(true))).mode).toBe("live");
  });

  it("at が 60 秒を超えて未来なら blocked（60 秒以内は live）", async () => {
    await putHb({ via: "web", at: iso(1), startedAt: iso(50) });
    await putOpen(iso(-120));
    expect((await detectLiveApp(root, deps(true))).mode).toBe("blocked");
    await putOpen(iso(-30));
    expect((await detectLiveApp(root, deps(true))).mode).toBe("live");
  });
});
