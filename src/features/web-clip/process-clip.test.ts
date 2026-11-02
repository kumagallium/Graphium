import { describe, it, expect, vi } from "vitest";
import { processClip, type ProcessClipDeps } from "./process-clip";
import { drainClipInbox } from "./use-web-clip-inbox";
import type { WebClip } from "./clip-note";
import type { MediaIndexEntry } from "../asset-browser/media-index";
import type { GraphiumDocument } from "../../lib/document-types";

const clip = (over: Partial<WebClip> = {}): WebClip => ({
  id: "00000000-0000-4000-8000-000000000001",
  url: "https://example.com/article",
  title: "Article",
  text: "picked sentence",
  clippedAt: "2026-11-03T10:00:00.000Z",
  receivedAt: "2026-11-03T10:00:01.000Z",
  ...over,
});

/** 素材・メモ・ノートを手元の Map で持つ偽物の依存 */
function fakeDeps(opts: { openNoteId?: string } = {}) {
  const media: MediaIndexEntry[] = [];
  const notes = new Map<string, GraphiumDocument>();
  const memos: { id: string; text: string; sourceAsset: unknown; folder: string; createdAt: string }[] = [];
  const usage: [string, string][] = [];
  const openInserts: string[] = [];
  let n = 0;
  const deps: ProcessClipDeps = {
    getMediaIndex: () => ({ media }),
    addUrlEntry: (e) => media.push(e),
    patchUrlEntry: (fileId, patch) => {
      const i = media.findIndex((m) => m.fileId === fileId);
      media[i] = { ...media[i], ...patch };
    },
    createMemo: async ({ text, createdAt, sourceAsset, folder }) => {
      const id = `memo-${memos.length + 1}`;
      memos.push({ id, text, sourceAsset, folder, createdAt });
      return { id, text, createdAt };
    },
    recordMemoUsage: (captureId, noteId) => usage.push([captureId, noteId]),
    noteExists: (id) => notes.has(id),
    createNote: async (doc) => {
      const id = `note-${++n}`;
      notes.set(id, doc);
      return id;
    },
    isNoteOpen: (id) => id === opts.openNoteId,
    insertIntoOpenNote: (memo) => openInserts.push(memo.id),
    loadNote: async (id) => notes.get(id)!,
    saveNote: async (id, doc) => {
      notes.set(id, doc);
    },
    newUrlEntryId: () => `url-${media.length + 1}`,
    domainOf: (u) => new URL(u).host,
    faviconOf: () => "",
  };
  return { deps, media, notes, memos, usage, openInserts };
}

describe("processClip", () => {
  it("初回: URL 素材を登録し、メモを作り、ノートを作って素材にまとめ先を記録する", async () => {
    const f = fakeDeps();
    const r = await processClip(clip({ doi: "10.1000/abc" }), "Web clips", f.deps);
    expect(r.createdNote).toBe(true);
    expect(f.media).toHaveLength(1);
    expect(f.media[0].noteContexts).toEqual(["Web clips"]);
    expect(f.media[0].webClip).toEqual({ noteId: r.noteId, doi: "10.1000/abc" });
    expect(f.memos[0]).toMatchObject({
      text: "picked sentence\n\n— Article",
      sourceAsset: { fileId: "url-1", type: "url" },
      folder: "Web clips",
      createdAt: "2026-11-03T10:00:00.000Z",
    });
    const doc = f.notes.get(r.noteId)!;
    expect(doc.pages[0].blocks.map((b: any) => b.type)).toEqual(["bookmark", "quote"]);
    expect(f.usage).toEqual([["memo-1", r.noteId]]);
  });

  it("同じページ（追跡用クエリ違い）の 2 回目は、同じノートの末尾に引用を足す", async () => {
    const f = fakeDeps();
    const first = await processClip(clip(), "F", f.deps);
    const second = await processClip(clip({ url: "https://example.com/article?utm_source=x", text: "second" }), "F", f.deps);
    expect(second.noteId).toBe(first.noteId);
    expect(second.createdNote).toBe(false);
    expect(f.media).toHaveLength(1);
    expect(f.notes.size).toBe(1);
    expect(f.notes.get(first.noteId)!.pages[0].blocks.map((b: any) => b.type)).toEqual(["bookmark", "quote", "quote"]);
  });

  it("まとめ先が開いて編集中なら、ファイルを書かずにエディタ経由で入れる", async () => {
    const f = fakeDeps();
    const first = await processClip(clip(), "F", f.deps);
    const before = f.notes.get(first.noteId);
    const g = { ...f.deps, isNoteOpen: (id: string) => id === first.noteId, insertIntoOpenNote: vi.fn() };
    await processClip(clip({ text: "again" }), "F", g);
    expect(g.insertIntoOpenNote).toHaveBeenCalledTimes(1);
    expect(f.notes.get(first.noteId)).toBe(before);
  });

  it("まとめ先のノートがゴミ箱に行っていたら、新しく作り直す", async () => {
    const f = fakeDeps();
    const first = await processClip(clip(), "F", f.deps);
    f.notes.delete(first.noteId);
    const second = await processClip(clip({ text: "again" }), "F", f.deps);
    expect(second.createdNote).toBe(true);
    expect(second.noteId).not.toBe(first.noteId);
    expect(f.media[0].webClip?.noteId).toBe(second.noteId);
  });

  it("範囲を選ばずにクリップ: メモは作らずブックマークだけのノート。2 回目は何もしない", async () => {
    const f = fakeDeps();
    const r1 = await processClip(clip({ text: undefined }), "F", f.deps);
    expect(f.memos).toHaveLength(0);
    expect(f.notes.get(r1.noteId)!.pages[0].blocks).toHaveLength(1);
    const r2 = await processClip(clip({ text: "  " }), "F", f.deps);
    expect(r2.noteId).toBe(r1.noteId);
    expect(f.notes.size).toBe(1);
  });
});

describe("drainClipInbox", () => {
  it("振り分けた分だけ受け取り済みにし、失敗した分は残す", async () => {
    const f = fakeDeps();
    const good = clip();
    const bad = clip({ id: "00000000-0000-4000-8000-000000000002", url: "https://bad.example" });
    const deps = {
      ...f.deps,
      createMemo: async (a: Parameters<ProcessClipDeps["createMemo"]>[0]) => {
        if (a.text.includes("boom")) throw new Error("save failed");
        return f.deps.createMemo(a);
      },
    };
    const acked: string[] = [];
    const errors: string[] = [];
    const found = await drainClipInbox(
      () => ({ folder: "F", deps, isBusy: () => false, onError: (c) => errors.push(c.id) }),
      { fetchInbox: async () => [good, { ...bad, text: "boom" }], ack: async (id) => void acked.push(id) },
    );
    expect(found).toBe(true);
    expect(acked).toEqual([good.id]);
    expect(errors).toEqual([bad.id]);
  });

  it("エディタへの挿入待ちの間は次のクリップに進まない", async () => {
    const f = fakeDeps();
    let busy = false;
    const acked: string[] = [];
    await drainClipInbox(
      () => ({ folder: "F", deps: f.deps, isBusy: () => busy, onProcessed: () => (busy = true) }),
      {
        fetchInbox: async () => [clip(), clip({ id: "00000000-0000-4000-8000-000000000003" })],
        ack: async (id) => void acked.push(id),
      },
    );
    expect(acked).toHaveLength(1);
  });

  it("同じ回に同じページが 2 件: 索引が古いままでも、ノートは 1 つにまとめる（実機で二重に作った回帰）", async () => {
    const f = fakeDeps();
    // React の state と同じく、同じ回のうちは作ったノートも素材の書き換えも見えない索引
    const staleNotes = new Set<string>();
    const staleMedia = [...f.media];
    const deps: ProcessClipDeps = {
      ...f.deps,
      noteExists: (id) => staleNotes.has(id),
      getMediaIndex: () => ({ media: staleMedia.length ? staleMedia : f.media.map((m) => ({ ...m, webClip: undefined })) }),
    };
    await drainClipInbox(
      () => ({ folder: "F", deps, isBusy: () => false }),
      {
        fetchInbox: async () => [clip(), clip({ id: "00000000-0000-4000-8000-000000000004", url: "https://example.com/article#b", text: "two" })],
        ack: async () => {},
      },
    );
    expect(f.notes.size).toBe(1);
    const [doc] = [...f.notes.values()];
    expect(doc.pages[0].blocks.map((b: any) => b.type)).toEqual(["bookmark", "quote", "quote"]);
  });

  it("sidecar が無ければ false", async () => {
    const f = fakeDeps();
    const found = await drainClipInbox(
      () => ({ folder: "F", deps: f.deps, isBusy: () => false }),
      { fetchInbox: async () => null, ack: async () => {} },
    );
    expect(found).toBe(false);
  });
});
