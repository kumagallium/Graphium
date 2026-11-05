// ServerFilesystemProvider.readMediaBytes: 上限を超える素材は本文を捨てて接続を返す

import { describe, it, expect, afterEach, vi } from "vitest";
import { ServerFilesystemProvider } from "./server-fs";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 本文が捨てられたか・読まれたかを記録する応答を返す fetch を差し込む */
function stubMediaFetch(declaredBytes: number, actual = new Uint8Array([1, 2, 3])) {
  const seen = { cancelled: false, pulled: 0 };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      seen.pulled += 1;
      controller.enqueue(actual);
      controller.close();
    },
    cancel() {
      seen.cancelled = true;
    },
  });
  const res = new Response(body, { status: 200, headers: { "content-length": String(declaredBytes) } });
  vi.stubGlobal("fetch", vi.fn(async () => res));
  return seen;
}

describe("readMediaBytes", () => {
  it("Content-Length が上限を超えたら本文を読まずに捨てる（接続を握ったままにしない）", async () => {
    // 2026-11-05: 起動時の後追い付与が大きい素材を飛ばすたびに接続が 1 本ずつ残り、
    // 同じ宛先の 6 本の枠が埋まって、チャットの道具の結果が 30 秒の上限で時間切れになった
    const seen = stubMediaFetch(50 * 1024 * 1024);
    const provider = new ServerFilesystemProvider();
    const out = await provider.readMediaBytes("big", 40 * 1024 * 1024);
    expect(out).toBeUndefined();
    expect(seen.cancelled).toBe(true);
  });

  it("上限以内なら本文を読んで返す", async () => {
    const seen = stubMediaFetch(3);
    const provider = new ServerFilesystemProvider();
    const out = await provider.readMediaBytes("small", 1024);
    expect(Array.from(out ?? [])).toEqual([1, 2, 3]);
    expect(seen.cancelled).toBe(false);
  });
});
