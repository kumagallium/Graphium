// 投影キャッシュの書き込み（appdata への persist）のテスト。
//
// 対象の不変条件:
// - 同じファイルへの書き込みを直列化する。デバウンスのタイマーだけでは、
//   書き込みがデバウンス間隔より長引いたときに 2 つの persist が並走し、
//   解決順が入れ替わると古い投影が新しい投影を上書きしうる
//   （process-index の processIndexSaveChain と同じ作法に揃える）
// - 実際に書くのは「そのとき最新の投影」（キューに積んだ時点のコピーではない）
//
// isTauri / app-data-file はモック。ディスクにも Tauri にも触れない。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  write: vi.fn<(key: string, name: string, data: unknown) => Promise<void>>(),
}));

vi.mock("../../lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/platform")>()),
  // 共有はデスクトップのみ。書き込み経路を通すために true 固定にする
  isTauri: () => true,
}));
vi.mock("../../lib/storage/app-data-file", () => ({
  readAppDataFile: async () => null,
  writeAppDataFile: h.write,
}));

import {
  __flushSharedProjectionSaveForTest,
  __resetSharedProjectionForTest,
  recordSharedProjectionFromBody,
  type SharedProjection,
} from "./shared-projection";
import type { GraphiumDocument } from "../../lib/document-types";
import type { SharedEntry } from "../../lib/storage/shared";

const doc = (title: string): GraphiumDocument =>
  ({
    version: 6,
    title,
    pages: [
      {
        id: "p1",
        title,
        blocks: [{ id: "s1", type: "step", content: [{ type: "text", text: "焼成", styles: {} }], children: [] }],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
  }) as any;

function sharedEntry(id: string, hash: string): SharedEntry {
  return {
    id,
    type: "note",
    author: { name: "Ada", email: "a@b.co" },
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-20T00:00:00.000Z",
    hash,
    prov: { derived_from: [] },
    version: 1,
    extra: { title: id },
  } as SharedEntry;
}

const encode = (d: GraphiumDocument) => new TextEncoder().encode(JSON.stringify(d));

beforeEach(() => {
  h.write.mockReset();
  __resetSharedProjectionForTest();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("投影の書き込み", () => {
  it("前の書き込みが終わるまで次の書き込みを始めない（並走で古い内容に戻らない）", async () => {
    let releaseFirst: (() => void) | null = null;
    h.write.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = () => resolve();
        }),
    );
    h.write.mockImplementationOnce(async () => {});

    recordSharedProjectionFromBody(sharedEntry("s-a", "sha256:a"), encode(doc("A")), true);
    await vi.advanceTimersByTimeAsync(2100);
    expect(h.write).toHaveBeenCalledTimes(1);

    // 1 本目が終わらないうちに次の投影 → デバウンスが明けても書き込みは始まらない
    recordSharedProjectionFromBody(sharedEntry("s-b", "sha256:b"), encode(doc("B")), true);
    await vi.advanceTimersByTimeAsync(2100);
    expect(h.write).toHaveBeenCalledTimes(1);

    releaseFirst!();
    await vi.advanceTimersByTimeAsync(0);
    await __flushSharedProjectionSaveForTest();
    expect(h.write).toHaveBeenCalledTimes(2);

    // 2 本目が書くのは「そのとき最新の投影」＝ 2 件とも入っている
    const written = h.write.mock.calls[1][2] as SharedProjection;
    expect(Object.keys(written.entries).sort()).toEqual(["s-a", "s-b"]);
  });

  it("書き込みが失敗してもキューは止まらない（次の投影が書ける）", async () => {
    h.write.mockRejectedValueOnce(new Error("disk full"));
    h.write.mockResolvedValueOnce(undefined);

    recordSharedProjectionFromBody(sharedEntry("s-a", "sha256:a"), encode(doc("A")), true);
    await vi.advanceTimersByTimeAsync(2100);
    await __flushSharedProjectionSaveForTest();

    recordSharedProjectionFromBody(sharedEntry("s-b", "sha256:b"), encode(doc("B")), true);
    await vi.advanceTimersByTimeAsync(2100);
    await __flushSharedProjectionSaveForTest();

    expect(h.write).toHaveBeenCalledTimes(2);
  });
});
