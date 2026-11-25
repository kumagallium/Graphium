import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installExitWhenReplaced,
  isReplaced,
  stampOf,
  type FileStamp,
  type TransportLike,
} from "./exit-when-replaced";

/** connect の代わり: onmessage を差し込み、届いた要求に応答を返す小さな transport */
function fakeTransport() {
  const sent: unknown[] = [];
  const t: TransportLike = {
    async send(m) {
      sent.push(m);
    },
  };
  return { t, sent };
}

describe("isReplaced", () => {
  const base: FileStamp = { mtimeMs: 1, size: 10, ino: 5 };
  it("印が同じなら差し替えではない", () => {
    expect(isReplaced(base, { ...base })).toBe(false);
  });
  it("時刻・大きさ・inode のどれかが変われば差し替え", () => {
    expect(isReplaced(base, { ...base, mtimeMs: 2 })).toBe(true);
    expect(isReplaced(base, { ...base, size: 11 })).toBe(true);
    expect(isReplaced(base, { ...base, ino: 6 })).toBe(true);
  });
  it("ファイルが消えたら差し替え扱い", () => {
    expect(isReplaced(base, null)).toBe(true);
  });
});

describe("stampOf（実ファイル）", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "graphium-exit-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("別のファイルで置き換える（アップデータと同じ形）と差し替えと分かる", () => {
    const p = join(dir, "graphium-mcp.mjs");
    writeFileSync(p, "old");
    const start = stampOf(p)!;
    expect(isReplaced(start, stampOf(p))).toBe(false);
    const next = join(dir, "next.mjs");
    writeFileSync(next, "new version");
    renameSync(next, p);
    expect(isReplaced(start, stampOf(p))).toBe(true);
  });
  it("無いファイルは null", () => {
    expect(stampOf(join(dir, "none.mjs"))).toBeNull();
  });
});

describe("installExitWhenReplaced", () => {
  afterEach(() => vi.useRealTimers());

  function setup(intervalMs = 1000) {
    let stamp: FileStamp | null = { mtimeMs: 1, size: 10, ino: 5 };
    const exit = vi.fn();
    const { t, sent } = fakeTransport();
    const h = installExitWhenReplaced(t, {
      scriptPath: "/app/graphium-mcp.mjs",
      intervalMs,
      exit,
      stat: () => stamp,
    });
    // connect の代わりに onmessage を差し込む
    const handled: unknown[] = [];
    t.onmessage = (m) => handled.push(m);
    return {
      t,
      h,
      exit,
      sent,
      handled,
      replace: () => {
        stamp = { mtimeMs: 2, size: 12, ino: 9 };
      },
    };
  }

  it("差し替えられていなければ、応答を返しても終えない", async () => {
    const { t, exit, handled } = setup();
    t.onmessage?.({ jsonrpc: "2.0", id: 1, method: "tools/call" });
    expect(handled).toHaveLength(1);
    await t.send({ jsonrpc: "2.0", id: 1, result: {} });
    expect(exit).not.toHaveBeenCalled();
  });

  it("差し替えられたら、その回の応答を返し終えてから終える", async () => {
    const { t, h, exit, sent, replace } = setup();
    t.onmessage?.({ jsonrpc: "2.0", id: 1, method: "tools/call" });
    replace();
    expect(h.inFlight()).toBe(1);
    h.check();
    expect(exit).not.toHaveBeenCalled(); // 処理中は終えない
    await t.send({ jsonrpc: "2.0", id: 1, result: {} });
    expect(sent).toHaveLength(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith("replaced");
  });

  it("要求が 2 件重なっていたら、両方返すまで終えない", async () => {
    const { t, exit, replace } = setup();
    t.onmessage?.({ jsonrpc: "2.0", id: 1, method: "tools/call" });
    t.onmessage?.({ jsonrpc: "2.0", id: 2, method: "tools/call" });
    replace();
    await t.send({ jsonrpc: "2.0", id: 1, result: {} });
    expect(exit).not.toHaveBeenCalled();
    await t.send({ jsonrpc: "2.0", id: 2, error: { code: -1, message: "x" } });
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("通知や、サーバーからの通知の送信は数えない", async () => {
    const { t, h, exit, replace } = setup();
    t.onmessage?.({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(h.inFlight()).toBe(0);
    replace();
    await t.send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
    expect(exit).not.toHaveBeenCalled(); // 応答ではないので確かめに行かない
  });

  it("呼ばれていなくても、見回りで差し替えに気づいて終える", () => {
    vi.useFakeTimers();
    const { exit, replace } = setup(1000);
    vi.advanceTimersByTime(1000);
    expect(exit).not.toHaveBeenCalled();
    replace();
    vi.advanceTimersByTime(1000);
    expect(exit).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(exit).toHaveBeenCalledTimes(1); // 1 回だけ
  });

  it("見張るファイルが読めないときは何もしない（dev 実行など）", async () => {
    const exit = vi.fn();
    const { t } = fakeTransport();
    const original = t.send;
    installExitWhenReplaced(t, { scriptPath: undefined, exit });
    expect(t.send).toBe(original);
    const h2 = installExitWhenReplaced(t, { scriptPath: "/none", exit, stat: () => null });
    h2.check();
    expect(exit).not.toHaveBeenCalled();
  });
});
