// lexicalSearch サービスのテスト（IndexedDB は fake-indexeddb・環境は node）
// - ensureLoaded → 投入 → デバウンス保存 → 別プロセス想定で復元
// - スコープが違うスナップショットは使わない
// - reconcile: 古い/足りないだけを loader で取り、無い分を外し、途中キャンセルできる
// - reset で索引と永続化が消える

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import type { GraphiumDocument } from "../../lib/document-types";
import { lexicalIndexStore } from "./index-store";
import { lexicalSearch, type DesiredSource } from "./service";

const noteDoc = (title: string, text: string): GraphiumDocument =>
  ({ title, pages: [{ blocks: [{ id: "b1", type: "paragraph", content: [{ type: "text", text }] }] }] }) as unknown as GraphiumDocument;

beforeEach(() => {
  (globalThis as any).indexedDB = new IDBFactory();
  lexicalSearch.__resetForTest();
  // setTimeout だけを偽物にする（デバウンス保存・reconcile の譲り待ちを飛ばすため）。
  // fake-indexeddb は setImmediate、MiniSearch の非同期ロードは setTimeout(0) を使うので、
  // shouldAdvanceTime で実時間にも進めておかないと待ちが永久に解けない。
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("lexicalSearch service", () => {
  it("ロード前の検索は空。ロード後に投入すると同期検索できる", async () => {
    expect(lexicalSearch.search("劣化")).toEqual([]);
    expect(lexicalSearch.isReady()).toBe(false);
    await lexicalSearch.ensureLoaded("local:test");
    expect(lexicalSearch.isReady()).toBe(true);
    expect(lexicalSearch.getStatus().state).toBe("ready");

    expect(lexicalSearch.upsertNote("n1", "試薬", noteDoc("試薬", "湿度で劣化する"), "2026-01-01")).toBe(true);
    expect(lexicalSearch.upsertNote("n1", "試薬", noteDoc("試薬", "湿度で劣化する"), "2026-01-01")).toBe(false);
    expect(lexicalSearch.search("劣化")[0]).toMatchObject({ kind: "note", sourceId: "n1" });
    expect(lexicalSearch.getStatus()).toMatchObject({ sources: 1, documents: 1 });
  });

  it("変更はデバウンスして保存され、同じスコープで復元できる", async () => {
    await lexicalSearch.ensureLoaded("local:test");
    lexicalSearch.upsertWiki("w1", "デシケーター", [{ sectionId: "lead", text: "乾燥剤は 2 週間で交換" }], "v1");
    lexicalSearch.upsertAsset("a1", "manual.pdf", "PPMS の thermal transport option", "v1");
    // まだ保存されていない
    expect(await lexicalIndexStore.load("local:test")).toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    const stored = await lexicalIndexStore.load("local:test");
    expect(stored?.scopeKey).toBe("local:test");
    expect(lexicalSearch.getStatus().savedAt).toBeTruthy();

    // 別プロセス想定: リセットして同じスコープでロード → 索引が戻る
    lexicalSearch.__resetForTest();
    await lexicalSearch.ensureLoaded("local:test");
    expect(lexicalSearch.search("乾燥剤")[0]?.sourceId).toBe("w1");
    expect(lexicalSearch.search("ppms")[0]?.sourceId).toBe("a1");
    expect(lexicalSearch.isFresh("w1", "v1")).toBe(true);
  });

  it("スコープが違うスナップショットは使わず空から始める", async () => {
    await lexicalSearch.ensureLoaded("local:A");
    lexicalSearch.upsertNote("n1", "t", noteDoc("t", "本文"), "1");
    await lexicalSearch.flush();
    lexicalSearch.__resetForTest();
    await lexicalSearch.ensureLoaded("drive:B");
    expect(lexicalSearch.search("本文")).toEqual([]);
    expect(lexicalSearch.getStatus().sources).toBe(0);
  });

  it("reconcile は古い/足りない分だけ loader を呼び、無い分を外す", async () => {
    await lexicalSearch.ensureLoaded("local:test");
    lexicalSearch.upsertNote("old", "古い", noteDoc("古い", "消える"), "1");
    lexicalSearch.upsertNote("same", "同じ", noteDoc("同じ", "そのまま"), "1");
    const desired: DesiredSource[] = [
      { kind: "note", sourceId: "same", fingerprint: "1" },
      { kind: "note", sourceId: "changed", fingerprint: "2" },
      { kind: "note", sourceId: "missing", fingerprint: "1" },
    ];
    const loader = vi.fn(async (d: DesiredSource) => {
      if (d.sourceId === "missing") return null;
      return { kind: "note" as const, sourceId: d.sourceId, title: d.sourceId, fingerprint: d.fingerprint, chunks: [{ chunkId: "b", text: `本文 ${d.sourceId}` }] };
    });
    const p = lexicalSearch.reconcile(desired, loader);
    await vi.advanceTimersByTimeAsync(50);
    const processed = await p;
    // old の削除 + changed の索引 + missing（null → 何も無い）= 3
    expect(processed).toBe(3);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(loader.mock.calls.map((c) => c[0].sourceId).sort()).toEqual(["changed", "missing"]);
    expect(lexicalSearch.hasSource("old")).toBe(false);
    expect(lexicalSearch.hasSource("same")).toBe(true);
    expect(lexicalSearch.search("changed")[0]?.sourceId).toBe("changed");
    expect(lexicalSearch.getStatus()).toMatchObject({ state: "ready", pending: 0 });
  });

  it("removeMissing=false / kinds で範囲を限る", async () => {
    await lexicalSearch.ensureLoaded("local:test");
    lexicalSearch.upsertNote("n1", "n", noteDoc("n", "note"), "1");
    lexicalSearch.upsertAsset("a1", "a", "asset text", "1");
    // 素材だけの一覧で reconcile しても、ノートは消えない
    await lexicalSearch.reconcile([{ kind: "asset", sourceId: "a2", fingerprint: "1" }], async (d) => ({
      kind: "asset",
      sourceId: d.sourceId,
      title: "a2",
      fingerprint: d.fingerprint,
      chunks: [{ chunkId: "c0", text: "another" }],
    }), { kinds: ["asset"] });
    expect(lexicalSearch.hasSource("n1")).toBe(true);
    expect(lexicalSearch.hasSource("a1")).toBe(false);
    expect(lexicalSearch.hasSource("a2")).toBe(true);
  });

  it("新しい reconcile が始まると古い方は止まる", async () => {
    await lexicalSearch.ensureLoaded("local:test");
    const slow = vi.fn(async (d: DesiredSource) => {
      await new Promise((r) => setTimeout(r, 100));
      return { kind: "note" as const, sourceId: d.sourceId, title: d.sourceId, fingerprint: "1", chunks: [{ chunkId: "b", text: `slow ${d.sourceId}` }] };
    });
    const first = lexicalSearch.reconcile(
      [{ kind: "note", sourceId: "s1", fingerprint: "1" }, { kind: "note", sourceId: "s2", fingerprint: "1" }],
      slow,
    );
    await vi.advanceTimersByTimeAsync(10);
    const second = lexicalSearch.reconcile([{ kind: "note", sourceId: "s3", fingerprint: "1" }], slow);
    await vi.advanceTimersByTimeAsync(1000);
    await first;
    await second;
    // 1 本目は s1 の loader 完了時点でトークンが変わっており、s2 には進まない
    expect(slow.mock.calls.map((c) => c[0].sourceId)).not.toContain("s2");
    expect(lexicalSearch.hasSource("s3")).toBe(true);
  });

  it("kinds が違う reconcile は並走し、互いを止めない", async () => {
    await lexicalSearch.ensureLoaded("local:test");
    const slow = vi.fn(async (d: DesiredSource) => {
      await new Promise((r) => setTimeout(r, 100));
      return { kind: d.kind, sourceId: d.sourceId, title: d.sourceId, fingerprint: "1", chunks: [{ chunkId: "b", text: `text ${d.sourceId}` }] };
    });
    const notes = lexicalSearch.reconcile(
      [{ kind: "note", sourceId: "n1", fingerprint: "1" }, { kind: "note", sourceId: "n2", fingerprint: "1" }],
      slow,
      { kinds: ["note", "wiki"] },
    );
    await vi.advanceTimersByTimeAsync(10);
    const assets = lexicalSearch.reconcile([{ kind: "asset", sourceId: "a1", fingerprint: "1" }], slow, { kinds: ["asset"] });
    await vi.advanceTimersByTimeAsync(2000);
    await notes;
    await assets;
    expect(lexicalSearch.hasSource("n1")).toBe(true);
    expect(lexicalSearch.hasSource("n2")).toBe(true);
    expect(lexicalSearch.hasSource("a1")).toBe(true);
    expect(lexicalSearch.getStatus()).toMatchObject({ state: "ready", pending: 0 });
  });

  it("reset で索引と永続化が消え、世代番号が進む", async () => {
    await lexicalSearch.ensureLoaded("local:test");
    const gen = lexicalSearch.getStatus().generation;
    lexicalSearch.upsertNote("n1", "t", noteDoc("t", "本文"), "1");
    await lexicalSearch.flush();
    expect(await lexicalIndexStore.load("local:test")).not.toBeNull();
    await lexicalSearch.reset();
    expect(lexicalSearch.getStatus().generation).toBe(gen + 1);
    expect(lexicalSearch.search("本文")).toEqual([]);
    expect(await lexicalIndexStore.load("local:test")).toBeNull();
    expect(lexicalSearch.isReady()).toBe(true);
  });
});
