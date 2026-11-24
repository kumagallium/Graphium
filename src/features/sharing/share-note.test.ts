// @vitest-environment jsdom
// shareNote のテスト。Tauri invoke をモックしてラウンドトリップを確認する。

import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import { shareNote, shareGraphiumDocument, stripPrivateHistory } from "./share-note";
import { shareKnowledge } from "./share-knowledge";
import { createSharedFolder, setSharedFolders } from "../../lib/storage/shared/config";
import { computeSharedEntryHash } from "../../lib/storage/shared";
import type { GraphiumDocument } from "../../lib/document-types";
import type { AuthorIdentity } from "../document-provenance/types";

const author: AuthorIdentity = { name: "Ada", email: "a@b.co" };

class FakeFs {
  entries = new Map<string, string>();
  blobs = new Map<string, string>(); // hash → base64
  /** shared_readable_sync の呼び出しの記録 */
  readable: any[] = [];
  /** true なら shared_readable_sync を失敗させる */
  failReadable = false;
  install() {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string, args: any) => {
      switch (cmd) {
        case "shared_write":
          this.entries.set(`${args.entryType}/${args.id}`, args.content);
          return null;
        case "shared_read": {
          const v = this.entries.get(`${args.entryType}/${args.id}`);
          if (!v) throw new Error("not found");
          return v;
        }
        case "shared_readable_sync":
          this.readable.push(args);
          if (this.failReadable) throw new Error("readable failed");
          return null;
        case "shared_blob_write":
          this.blobs.set(args.hash, args.contentBase64);
          return null;
        case "shared_blob_read": {
          const v = this.blobs.get(args.hash);
          if (!v) throw new Error("blob not found");
          return v;
        }
        case "shared_blob_exists":
          return this.blobs.has(args.hash);
        default:
          throw new Error(`unmocked: ${cmd}`);
      }
    });
  }
}

let fs: FakeFs;
beforeEach(() => {
  localStorage.clear();
  fs = new FakeFs();
  fs.install();
});

function makeDoc(overrides: Partial<GraphiumDocument> = {}): GraphiumDocument {
  return {
    version: 5,
    title: "Test note",
    pages: [
      {
        id: "p1",
        title: "Test note",
        blocks: [{ id: "b1", type: "paragraph", content: [{ type: "text", text: "hi" }] }],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
    createdAt: "2026-05-04T00:00:00Z",
    modifiedAt: "2026-05-04T00:00:00Z",
    ...overrides,
  };
}

describe("shareNote — first share", () => {
  it("ok=true、新しい sharedRef が付き、isUpdate=false", async () => {
    const result = await shareNote(makeDoc(), { root: "/tmp/shared", author });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.isUpdate).toBe(false);
    expect(result.doc.sharedRef).toBeDefined();
    expect(result.doc.sharedRef!.id).toMatch(/^[0-9a-f]{8}-/);
    expect(result.doc.sharedRef!.type).toBe("note");
    expect(result.doc.sharedRef!.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.doc.sharedRef!.sharedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("shared 側に書き込まれた entry には author / type / title が反映される", async () => {
    const result = await shareNote(makeDoc(), { root: "/tmp/shared", author });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = JSON.parse([...fs.entries.values()][0]);
    expect(stored.entry.author).toEqual(author);
    expect(stored.entry.type).toBe("note");
    expect(stored.entry.extra?.title).toBe("Test note");
  });

  it("元の doc は変更されない（immutable）", async () => {
    const original = makeDoc();
    await shareNote(original, { root: "/tmp/shared", author });
    expect(original.sharedRef).toBeUndefined();
  });

  it("共有した時点のフォルダが extra.noteContexts に載る", async () => {
    const r = await shareNote(makeDoc({ noteContexts: ["卒論/焼結", "共通/装置"] }), {
      root: "/tmp/shared",
      author,
    });
    expect(r.ok).toBe(true);
    const stored = JSON.parse([...fs.entries.values()][0]);
    expect(stored.entry.extra.noteContexts).toEqual(["卒論/焼結", "共通/装置"]);
  });

  it("フォルダ未設定のノートでも空配列が入る（列は「—」表示になる）", async () => {
    await shareNote(makeDoc(), { root: "/tmp/shared", author });
    const stored = JSON.parse([...fs.entries.values()][0]);
    expect(stored.entry.extra.noteContexts).toEqual([]);
  });
});

describe("shareNote — re-share (update)", () => {
  it("isUpdate=true で同じ id を維持する", async () => {
    const first = await shareNote(makeDoc(), { root: "/tmp/shared", author });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // 内容を変えて再共有
    const updated = await shareNote(
      { ...first.doc, title: "Updated title" },
      { root: "/tmp/shared", author },
    );
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.isUpdate).toBe(true);
    expect(updated.doc.sharedRef!.id).toBe(first.doc.sharedRef!.id);
    // hash は内容変更により変わる
    expect(updated.doc.sharedRef!.hash).not.toBe(first.doc.sharedRef!.hash);
  });

  it("再共有でフォルダが上書きされる", async () => {
    const first = await shareNote(makeDoc({ noteContexts: ["旧フォルダ"] }), {
      root: "/tmp/shared",
      author,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const updated = await shareNote(
      { ...first.doc, noteContexts: ["新フォルダ"] },
      { root: "/tmp/shared", author },
    );
    expect(updated.ok).toBe(true);
    const stored = JSON.parse([...fs.entries.values()][0]);
    expect(stored.entry.extra.noteContexts).toEqual(["新フォルダ"]);
  });
});

describe("shareNote — failure paths", () => {
  it("空 root だと ok=false", async () => {
    const r = await shareNote(makeDoc(), { root: "", author });
    expect(r.ok).toBe(false);
  });

  it("invoke が失敗すれば ok=false", async () => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async () => {
      throw new Error("disk full");
    });
    const r = await shareNote(makeDoc(), { root: "/tmp/shared", author });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("disk full");
  });
});

describe("shareNote — Phase 2c-1 自動 blob 化", () => {
  function docWithMedia(): GraphiumDocument {
    return makeDoc({
      pages: [
        {
          id: "p1",
          title: "Test note",
          blocks: [
            { id: "b1", type: "image", props: { url: "file-media://A" } },
            { id: "b2", type: "image", props: { url: "file-media://A" } }, // 重複
            { id: "b3", type: "video", props: { url: "file-media://B" } },
          ],
          labels: {},
          provLinks: [],
          knowledgeLinks: [],
        },
      ],
    });
  }

  const extractFileId = (url: string): string | null => {
    const m = url.match(/^file-media:\/\/(.+)$/);
    return m ? m[1] : null;
  };

  const fetchBytes = async (id: string): Promise<Uint8Array> => {
    if (id === "A") return new Uint8Array([1, 2, 3]);
    if (id === "B") return new Uint8Array([4, 5, 6]);
    throw new Error(`unknown ${id}`);
  };

  it("shared 側 doc の image url は shared-blob: に置換され、extra.blobs に dedup 済 BlobRef が載る", async () => {
    const r = await shareNote(docWithMedia(), {
      root: "/tmp/shared",
      author,
      blobRoot: "/tmp/blob",
      __test: { extractFileId, fetchBytes },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const stored = JSON.parse([...fs.entries.values()][0]);
    const bodyJson = atob(stored.body_base64);
    const blocks = JSON.parse(bodyJson).pages[0].blocks;
    expect(blocks[0].props.url).toMatch(/^shared-blob:sha256:[0-9a-f]{64}$/);
    expect(blocks[0].props.url).toBe(blocks[1].props.url); // 同 hash
    expect(blocks[2].props.url).not.toBe(blocks[0].props.url);

    expect(stored.entry.extra.blobs).toHaveLength(2); // A と B、重複は dedup
    expect(stored.entry.extra.blobs[0].provider).toBe("local-folder");

    // 実際に blob root にバイト列が書かれている
    expect(fs.blobs.size).toBe(2);
  });

  it("personal 側の doc は無変更（immutable）", async () => {
    const original = docWithMedia();
    const beforeUrl = original.pages[0].blocks[0].props.url;
    await shareNote(original, {
      root: "/tmp/shared",
      author,
      blobRoot: "/tmp/blob",
      __test: { extractFileId, fetchBytes },
    });
    expect(original.pages[0].blocks[0].props.url).toBe(beforeUrl);
  });

  it("blobRoot 未設定で media を含むなら ok=false", async () => {
    const r = await shareNote(docWithMedia(), {
      root: "/tmp/shared",
      author,
      __test: { extractFileId, fetchBytes },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Blob root/i);
  });

  it("テキストのみのノートは blobRoot 未設定でも ok=true、extra.blobs は無い", async () => {
    const r = await shareNote(makeDoc(), {
      root: "/tmp/shared",
      author,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const stored = JSON.parse([...fs.entries.values()][0]);
    expect(stored.entry.extra.blobs).toBeUndefined();
  });
});

// --- §24: 共有コピーの AI チャット / 編集来歴 ---
// 共有は本文を見せる操作なので、既定では作業の過程（チャット・編集来歴）を
// 共有コピーに載せない。手元の doc は無傷、hash は共有コピーの本文から計算する。

describe("shareNote — 共有コピーに含めない情報", () => {
  const chats: NonNullable<GraphiumDocument["chats"]> = [
    {
      id: "chat-1",
      scopeBlockId: "b1",
      scopeType: "block",
      messages: [
        { role: "user", content: "これで合ってる？", timestamp: "2026-05-04T00:00:00Z" },
        { role: "assistant", content: "合っています", timestamp: "2026-05-04T00:00:01Z" },
      ],
      createdAt: "2026-05-04T00:00:00Z",
      modifiedAt: "2026-05-04T00:00:01Z",
    },
  ];
  const documentProvenance: NonNullable<GraphiumDocument["documentProvenance"]> = {
    revisions: [],
    activities: [],
    agents: [],
  };

  const docWithHistory = () =>
    makeDoc({ chats, documentProvenance, noteContexts: ["卒論"] });

  /**
   * shared 側に書かれた body（GraphiumDocument JSON）を読む。
   * atob はバイト列を返すだけなので、日本語が化けないよう TextDecoder を通す。
   */
  function storedBody(): GraphiumDocument {
    const stored = JSON.parse([...fs.entries.values()][0]);
    const bytes = Uint8Array.from(atob(stored.body_base64), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  it("既定では共有 body に chats / documentProvenance が無い", async () => {
    const r = await shareNote(docWithHistory(), { root: "/tmp/shared", author });
    expect(r.ok).toBe(true);
    const body = storedBody();
    expect(body.chats).toBeUndefined();
    expect(body.documentProvenance).toBeUndefined();
    // 剥がすのはこの 2 つだけ。本文・タイトル・フォルダは残る
    expect(body.title).toBe("Test note");
    expect(body.noteContexts).toEqual(["卒論"]);
    expect(body.pages[0].blocks).toHaveLength(1);
  });

  it("includePrivateHistory: true なら共有 body に残る", async () => {
    const r = await shareNote(docWithHistory(), {
      root: "/tmp/shared",
      author,
      includePrivateHistory: true,
    });
    expect(r.ok).toBe(true);
    const body = storedBody();
    expect(body.chats).toHaveLength(1);
    expect(body.chats![0].messages[0].content).toBe("これで合ってる？");
    expect(body.documentProvenance).toEqual(documentProvenance);
  });

  it("戻り値の doc には手元の chats / documentProvenance が残る", async () => {
    const r = await shareNote(docWithHistory(), { root: "/tmp/shared", author });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.chats).toEqual(chats);
    expect(r.doc.documentProvenance).toEqual(documentProvenance);
    expect(r.doc.sharedRef).toBeDefined();
  });

  it("渡した doc 自体も変更されない（immutable）", async () => {
    const original = docWithHistory();
    await shareNote(original, { root: "/tmp/shared", author });
    expect(original.chats).toEqual(chats);
    expect(original.documentProvenance).toEqual(documentProvenance);
  });

  // メモから引用したブロックを持つノート。紐づけ（memoQuotes）には、引用した時点のメモ本文と
  // メモの id が入っている。本文の引用ブロックは、あとから書き換えてある（メモ本文とは別の文）
  const memoQuotes = {
    q1: {
      captureId: "cap-1",
      quotedAt: "2026-05-04T00:00:00Z",
      quotedText: "発酵は 28 度で 60 分（まだ誰にも見せない下書き）",
    },
  };
  const docWithMemoQuote = (overrides: Partial<GraphiumDocument> = {}) =>
    makeDoc({
      pages: [
        {
          id: "p1",
          title: "Test note",
          blocks: [
            { id: "b1", type: "paragraph", content: [{ type: "text", text: "hi" }] },
            { id: "q1", type: "quote", content: [{ type: "text", text: "発酵は 28 度で 60 分" }] },
          ],
          labels: {},
          provLinks: [],
          knowledgeLinks: [],
          memoQuotes,
        },
      ],
      ...overrides,
    });

  it("共有 body にメモの紐づけ（memoQuotes）が無い。引用ブロックの本文は残る", async () => {
    const r = await shareNote(docWithMemoQuote(), { root: "/tmp/shared", author });
    expect(r.ok).toBe(true);
    const body = storedBody();
    expect(body.pages[0].memoQuotes).toBeUndefined();
    expect("memoQuotes" in body.pages[0]).toBe(false);
    // 封筒ごと見ても、メモの id と、引用した時点のメモ本文は出ていない
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("cap-1");
    expect(raw).not.toContain("まだ誰にも見せない下書き");
    // 引用ブロックはノートの本文なので、そのまま出る
    expect(body.pages[0].blocks).toHaveLength(2);
    expect((body.pages[0].blocks[1] as any).content[0].text).toBe("発酵は 28 度で 60 分");
  });

  it("includePrivateHistory: true でも memoQuotes は出ない（メモは常に共有しない）", async () => {
    const r = await shareNote(docWithMemoQuote({ chats }), {
      root: "/tmp/shared",
      author,
      includePrivateHistory: true,
    });
    expect(r.ok).toBe(true);
    const body = storedBody();
    expect(body.chats).toHaveLength(1);
    expect(body.pages[0].memoQuotes).toBeUndefined();
  });

  it("手元の doc と戻り値の doc には memoQuotes が残る", async () => {
    const original = docWithMemoQuote();
    const r = await shareNote(original, { root: "/tmp/shared", author });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(original.pages[0].memoQuotes).toEqual(memoQuotes);
    expect(r.doc.pages[0].memoQuotes).toEqual(memoQuotes);
  });

  it("knowledge と proposal の共有 body からも memoQuotes を外す", async () => {
    for (const type of ["knowledge", "proposal"] as const) {
      fs = new FakeFs();
      fs.install();
      const r = await shareGraphiumDocument(docWithMemoQuote(), type, {}, { root: "/tmp/shared", author });
      expect(r.ok).toBe(true);
      expect(storedBody().pages[0].memoQuotes).toBeUndefined();
    }
  });

  it("メモから作ったナレッジの共有 body に、メモの id と抜粋が残らない", async () => {
    const original = makeDoc({
      source: "ai",
      pages: [
        {
          id: "main",
          title: "Test note",
          blocks: [
            {
              id: "b1",
              type: "paragraph",
              content: [
                { type: "text", text: "低温で長く発酵させる " },
                { type: "text", text: "@冷蔵庫で一晩寝かせる", styles: { textColor: "blue" } },
                { type: "text", text: " " },
                { type: "text", text: "@Flour note", styles: { textColor: "blue" } },
              ],
            },
            {
              id: "b2",
              type: "bulletListItem",
              content: [
                { type: "text", text: "Source: ", styles: { bold: true } },
                { type: "text", text: "@冷蔵庫で一晩寝かせる", styles: { textColor: "blue" } },
              ],
            },
            {
              id: "b3",
              type: "bulletListItem",
              content: [{ type: "text", text: "@Flour note", styles: { textColor: "blue" } }],
            },
          ],
          labels: {},
          provLinks: [],
          knowledgeLinks: [
            {
              id: "l1",
              sourceBlockId: "b1",
              targetBlockId: "",
              targetNoteId: "memo:cap-9",
              type: "reference",
              layer: "knowledge",
              createdBy: "ai",
              targetQuote: "冷蔵庫で一晩（下書きの抜粋）",
            },
            {
              id: "l2",
              sourceBlockId: "b1",
              targetBlockId: "",
              targetNoteId: "note-1",
              type: "reference",
              layer: "knowledge",
              createdBy: "ai",
            },
            {
              id: "l3",
              sourceBlockId: "b2",
              targetBlockId: "",
              targetNoteId: "memo:cap-9",
              type: "reference",
              layer: "knowledge",
              createdBy: "ai",
            },
            {
              id: "l4",
              sourceBlockId: "b3",
              targetBlockId: "",
              targetNoteId: "note-1",
              type: "reference",
              layer: "knowledge",
              createdBy: "ai",
            },
          ] as any,
        },
      ],
      wikiMeta: {
        kind: "topic",
        derivedFromNotes: ["memo:cap-9", "note-1"],
        derivedFromChats: [],
        generatedAt: "2026-05-04T00:00:00Z",
        generatedBy: { model: "m", version: "1" },
        language: "ja",
        evidenceSpan: "冷蔵庫で一晩（下書きの抜粋）",
        ruleFrame: {
          conditions: [{ item: "温度", span: "冷蔵庫で一晩（下書きの抜粋）" }],
          consequences: [],
          reviewState: "extracted",
        },
        decisionFrame: { triggerClaimIds: [], action: "冷蔵庫で一晩（下書きの抜粋）", rationale: null, reviewState: "extracted" },
        observationFrame: { results: [{ item: "膨らみ", span: "冷蔵庫で一晩（下書きの抜粋）" }], reviewState: "extracted" },
        topicMarkdown:
          "低温で長く発酵させる[[source:memo:cap-9|冷蔵庫で一晩（下書きの抜粋）]]。粉は強力粉[[source:note-1|強力粉]]。",
        passageContexts: [
          { sourceId: "memo:cap-9", passage: "冷蔵庫で一晩（下書きの抜粋）", after: "翌朝に焼く（下書きの抜粋）" },
          { sourceId: "note-1", passage: "強力粉" },
        ],
        sourceCheck: {
          verdict: "supported",
          entries: [
            {
              sourceId: "memo:cap-9",
              sourceKind: "memo",
              verdict: "supported",
              rationale: "ok",
              quote: "冷蔵庫で一晩（下書きの抜粋）",
            },
          ],
          checkedAt: "2026-05-04T00:00:00Z",
          checkedBy: "local",
          claimHash: "h",
        },
      } as any,
    });
    const before = JSON.stringify(original);

    const r = await shareKnowledge(original, { root: "/tmp/shared", author });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const body = storedBody();
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("cap-9");
    expect(raw).not.toContain("下書きの抜粋");
    // 引用の題はメモの先頭行なので、固定の語に置き換わる
    expect(raw).not.toContain("冷蔵庫");
    // メモ以外の出典と、ページの文章は残る
    expect(body.wikiMeta!.derivedFromNotes).toEqual(["note-1"]);
    expect(body.wikiMeta!.topicMarkdown).toBe("低温で長く発酵させる。粉は強力粉[[source:note-1|強力粉]]。");
    expect(body.wikiMeta!.passageContexts).toEqual([{ sourceId: "note-1", passage: "強力粉" }]);
    expect(body.pages[0].knowledgeLinks.map((l) => l.targetNoteId)).toEqual(["note-1", "note-1"]);
    expect((body.pages[0].blocks[0] as any).content.map((c: any) => c.text)).toEqual([
      "低温で長く発酵させる ",
      "@メモ",
      " ",
      "@Flour note",
    ]);
    expect((body.pages[0].blocks[1] as any).content[1].text).toBe("@メモ");
    // 手元のページは変えない
    expect(JSON.stringify(original)).toBe(before);
    expect(r.doc.wikiMeta!.derivedFromNotes).toContain("memo:cap-9");
  });

  it("履歴を含めて共有しても、編集の来歴の used にメモの id が残らない", async () => {
    const provenance = {
      revisions: [],
      agents: [],
      activities: [
        { id: "a1", type: "wiki_merge", used: ["memo:cap-9", "note-1"] },
        { id: "a2", type: "wiki_merge", used: ["memo:cap-9"] },
      ],
    } as unknown as NonNullable<GraphiumDocument["documentProvenance"]>;
    const r = await shareNote(makeDoc({ documentProvenance: provenance }), {
      root: "/tmp/shared",
      author,
      includePrivateHistory: true,
    });
    expect(r.ok).toBe(true);
    const body = storedBody();
    expect(JSON.stringify(body)).not.toContain("cap-9");
    expect(body.documentProvenance!.activities[0].used).toEqual(["note-1"]);
    expect("used" in body.documentProvenance!.activities[1]).toBe(false);
  });

  it("hash は剥がした後の本文から計算される", async () => {
    const input = docWithHistory();
    const r = await shareNote(input, { root: "/tmp/shared", author });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const stored = JSON.parse([...fs.entries.values()][0]);
    const bodyBytes = Uint8Array.from(atob(stored.body_base64), (c) => c.charCodeAt(0));
    // 実際に書かれた本文で計算し直すと sharedRef の hash と一致する
    await expect(computeSharedEntryHash(stored.entry, bodyBytes)).resolves.toBe(
      r.doc.sharedRef!.hash,
    );
    // チャット込みの本文から計算した値とは一致しない（＝剥がした本文が hash の対象）
    const withHistoryBytes = new TextEncoder().encode(JSON.stringify(input));
    await expect(
      computeSharedEntryHash(stored.entry, withHistoryBytes),
    ).resolves.not.toBe(r.doc.sharedRef!.hash);
  });

  it("自動 blob 化の後に剥がす（url 置換と両立する）", async () => {
    const docWithBoth = makeDoc({
      chats,
      documentProvenance,
      pages: [
        {
          id: "p1",
          title: "Test note",
          blocks: [{ id: "b1", type: "image", props: { url: "file-media://A" } }],
          labels: {},
          provLinks: [],
          knowledgeLinks: [],
        },
      ],
    });
    const r = await shareNote(docWithBoth, {
      root: "/tmp/shared",
      author,
      blobRoot: "/tmp/blob",
      __test: {
        extractFileId: (url) => url.match(/^file-media:\/\/(.+)$/)?.[1] ?? null,
        fetchBytes: async () => new Uint8Array([1, 2, 3]),
      },
    });
    expect(r.ok).toBe(true);
    const body = storedBody();
    expect(body.chats).toBeUndefined();
    expect(body.pages[0].blocks[0].props!.url).toMatch(/^shared-blob:sha256:/);
  });
});

describe("stripPrivateHistory", () => {
  it("chats と documentProvenance だけを落とし、他は同じ参照で残す", () => {
    const doc = makeDoc({
      chats: [],
      documentProvenance: { revisions: [], activities: [], agents: [] },
      noteContexts: ["卒論"],
      sharedRef: { id: "x", type: "note", sharedAt: "2026-05-04T00:00:00Z", hash: "sha256:0" },
    });
    const stripped = stripPrivateHistory(doc);
    expect(stripped.chats).toBeUndefined();
    expect(stripped.documentProvenance).toBeUndefined();
    expect(stripped.pages).toBe(doc.pages);
    expect(stripped.noteContexts).toBe(doc.noteContexts);
    expect(stripped.sharedRef).toBe(doc.sharedRef);
    // 元は無傷
    expect(doc.chats).toBeDefined();
    expect(doc.documentProvenance).toBeDefined();
  });

  it("どちらも持たない doc はそのまま返す", () => {
    const doc = makeDoc();
    expect(stripPrivateHistory(doc)).toBe(doc);
  });
});

describe("shareNote — 取り込んだ提案（§25b C-1）", () => {
  /** proposal_adopt を 2 件持つ来歴（1 件は同じ提案の 2 度目の取り込み） */
  const provenanceWithAdopts = {
    revisions: [],
    agents: [],
    activities: [
      { id: "edit-1", type: "human_edit", startedAt: "", endedAt: "", wasAssociatedWith: "a1" },
      {
        id: "edit-2",
        type: "proposal_adopt",
        startedAt: "",
        endedAt: "",
        wasAssociatedWith: "a1",
        used: ["shared:prop-1"],
      },
      {
        id: "edit-3",
        type: "proposal_adopt",
        startedAt: "",
        endedAt: "",
        wasAssociatedWith: "a1",
        used: ["shared:prop-2", "shared:prop-1"],
      },
    ],
  } as unknown as GraphiumDocument["documentProvenance"];

  it("extra.adoptedProposals に取り込んだ提案の id が載る（共有コピーから来歴を落とす前に読む）", async () => {
    const result = await shareNote(makeDoc({ documentProvenance: provenanceWithAdopts }), {
      root: "/tmp/shared",
      author,
    });
    expect(result.ok).toBe(true);
    const stored = JSON.parse([...fs.entries.values()][0]);
    expect(stored.entry.extra.adoptedProposals).toEqual(["prop-1", "prop-2"]);
    // 既定では共有コピーの本文から来歴そのものは落ちる（§24）
    const bytes = Uint8Array.from(atob(stored.body_base64), (c) => c.charCodeAt(0));
    expect(JSON.parse(new TextDecoder().decode(bytes)).documentProvenance).toBeUndefined();
  });

  it("取り込みが無ければフィールドごと出さない（既存の封筒と同じ形のまま）", async () => {
    await shareNote(makeDoc(), { root: "/tmp/shared", author });
    const stored = JSON.parse([...fs.entries.values()][0]);
    expect(stored.entry.extra.adoptedProposals).toBeUndefined();
  });
});

// --- 読める写し（共有フォルダの readable/）---

describe("shareNote — 読める写し", () => {
  const ROOT = "/tmp/shared";
  const enable = () => setSharedFolders([{ ...createSharedFolder(ROOT), readableCopies: true }]);
  const secretChats: NonNullable<GraphiumDocument["chats"]> = [
    {
      id: "chat-1",
      scopeBlockId: "b1",
      scopeType: "block",
      messages: [{ role: "user", content: "ひみつのチャット質問", timestamp: "2026-05-04T00:00:00Z" }],
      createdAt: "2026-05-04T00:00:00Z",
      modifiedAt: "2026-05-04T00:00:01Z",
    },
  ];
  const secretProvenance = {
    revisions: [
      {
        id: "rev-secret",
        pageId: "p1",
        timestamp: "2026-05-04T00:00:00Z",
        contentHash: "sha256:abc",
        summary: "ひみつの編集メモ",
      },
    ],
    activities: [],
    agents: [],
  } as unknown as NonNullable<GraphiumDocument["documentProvenance"]>;

  it("ノートの共有で写しが置かれる（スイッチ入・context あり）", async () => {
    enable();
    const r = await shareNote(makeDoc(), { root: ROOT, author, readable: { noteId: "note-1" } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.readableCopy).toBe("written");
    expect(fs.readable).toHaveLength(1);
    expect(fs.readable[0].entryType).toBe("notes");
    expect(fs.readable[0].id).toBe(r.doc.sharedRef!.id);
    expect(fs.readable[0].markdown).toContain("hi");
    expect(typeof fs.readable[0].prov).toBe("string");
  });

  it("スイッチが切なら markdown: null で呼ばれ off になる", async () => {
    const r = await shareNote(makeDoc(), { root: ROOT, author, readable: { noteId: "note-1" } });
    expect(r.ok && r.readableCopy).toBe("off");
    expect(fs.readable[0].markdown).toBeNull();
  });

  it("knowledge と proposal では呼ばれず、readableCopy も付かない", async () => {
    enable();
    const k = await shareKnowledge(
      makeDoc({ wikiMeta: { kind: "concept" } as unknown as GraphiumDocument["wikiMeta"] }),
      { root: ROOT, author, readable: { noteId: "k" } },
    );
    expect(k.ok).toBe(true);
    const p = await shareGraphiumDocument(makeDoc(), "proposal", {}, { root: ROOT, author, readable: { noteId: "p" } });
    expect(p.ok).toBe(true);
    expect(fs.readable).toHaveLength(0);
    if (k.ok) expect("readableCopy" in k).toBe(false);
    if (p.ok) expect("readableCopy" in p).toBe(false);
  });

  it("includePrivateHistory が偽のとき、写しにチャットと編集の履歴由来の中身が入らない", async () => {
    enable();
    const doc = makeDoc({ chats: secretChats, documentProvenance: secretProvenance });
    const r = await shareNote(doc, { root: ROOT, author, readable: { noteId: "note-1" } });
    expect(r.ok).toBe(true);
    const { markdown, prov } = fs.readable[0];
    for (const text of [markdown, prov]) {
      expect(text).not.toContain("ひみつのチャット質問");
      expect(text).not.toContain("ひみつの編集メモ");
      expect(text).not.toContain("rev-secret");
    }
    expect(prov).not.toContain("chat-1");
  });

  it("includePrivateHistory が真でも、写しにチャット・編集の履歴・メールアドレスは入らない", async () => {
    enable();
    const doc = makeDoc({
      chats: secretChats,
      documentProvenance: {
        ...secretProvenance,
        agents: [{ id: "ag-1", type: "human", name: "Ada", email: "ada@example.com" }],
      } as any,
    });
    const r = await shareNote(doc, {
      root: ROOT,
      author,
      includePrivateHistory: true,
      readable: { noteId: "note-1" },
    });
    expect(r.ok).toBe(true);
    const { markdown, prov } = fs.readable[0];
    for (const text of [markdown, prov]) {
      expect(text).not.toContain("ひみつのチャット質問");
      expect(text).not.toContain("ひみつの編集メモ");
      expect(text).not.toContain("ada@example.com");
    }
  });

  it("写しの失敗でも ok: true のまま readableCopy: failed", async () => {
    enable();
    fs.failReadable = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await shareNote(makeDoc(), { root: ROOT, author, readable: { noteId: "note-1" } });
    warn.mockRestore();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.readableCopy).toBe("failed");
    expect(r.doc.sharedRef).toBeDefined();
  });
});

describe("shareNote — 共有先に無い資料を外す（hideSourceIds）", () => {
  function storedBody(): GraphiumDocument {
    const stored = JSON.parse([...fs.entries.values()][0]);
    const bytes = Uint8Array.from(atob(stored.body_base64), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  const linked = () =>
    makeDoc({
      pages: [
        {
          id: "p1",
          title: "Test note",
          blocks: [
            { id: "b1", type: "paragraph", content: [{ type: "text", text: "@Private idea", styles: { textColor: "blue" } }] },
          ],
          labels: {},
          provLinks: [],
          knowledgeLinks: [
            { id: "k1", sourceBlockId: "b1", targetBlockId: "", targetNoteId: "private-1", type: "reference", layer: "knowledge", createdBy: "human" },
          ],
        },
      ] as GraphiumDocument["pages"],
      noteLinks: [{ targetNoteId: "private-1", sourceBlockId: "b1", type: "derived_from" }],
    });

  it("渡した id は共有 body と読める写しから外れ、戻り値の doc には残る", async () => {
    setSharedFolders([{ ...createSharedFolder("/tmp/shared"), readableCopies: true }]);
    const noteIndex = {
      version: 1,
      notes: [{ noteId: "private-1", title: "Private idea", modifiedAt: "", createdAt: "" }],
    } as never;
    const r = await shareNote(linked(), {
      root: "/tmp/shared",
      author,
      hideSourceIds: new Set(["private-1"]),
      readable: { noteId: "me", noteIndex, mediaIndex: null },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const body = storedBody();
    expect(JSON.stringify(body)).not.toContain("private-1");
    expect(JSON.stringify(body)).not.toContain("Private idea");
    const written = fs.readable[fs.readable.length - 1];
    expect(written.markdown).not.toContain("Private idea");
    expect(written.prov).not.toContain("Private idea");
    // 手元に保存し直す doc はそのまま
    expect(r.doc.noteLinks).toEqual([{ targetNoteId: "private-1", sourceBlockId: "b1", type: "derived_from" }]);
    expect(JSON.stringify(r.doc.pages)).toContain("@Private idea");
  });

  it("渡さなければ今までどおり残る（読める写しの来歴にも題が出る）", async () => {
    setSharedFolders([{ ...createSharedFolder("/tmp/shared"), readableCopies: true }]);
    const noteIndex = {
      version: 1,
      notes: [{ noteId: "private-1", title: "Private idea", modifiedAt: "", createdAt: "" }],
    } as never;
    const r = await shareNote(linked(), {
      root: "/tmp/shared",
      author,
      readable: { noteId: "me", noteIndex, mediaIndex: null },
    });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(storedBody())).toContain("private-1");
    expect(fs.readable[fs.readable.length - 1].prov).toContain("Private idea");
  });
});

describe("shareNote — 計画の行との対応（extra.planRow）", () => {
  const planRow = { planIds: ["plan-shared"], tableBlockId: "tbl-1", rowId: "row_a", rowName: "こね" };
  const storedEntry = () => JSON.parse([...fs.entries.values()][0]).entry;

  it("渡した対応が封筒に載る", async () => {
    const result = await shareNote(makeDoc(), { root: "/tmp/shared", author, planRow });
    expect(result.ok).toBe(true);
    expect(storedEntry().extra.planRow).toEqual(planRow);
  });

  it("渡さなければ項目ごと出さない（既存の封筒と同じ形のまま）", async () => {
    await shareNote(makeDoc(), { root: "/tmp/shared", author });
    expect("planRow" in storedEntry().extra).toBe(false);
  });

  it("再共有で対応を組めなかったときは、前の版の対応を残す", async () => {
    const first = await shareNote(makeDoc(), { root: "/tmp/shared", author, planRow });
    if (!first.ok) throw new Error("first share failed");
    const second = await shareNote({ ...first.doc, title: "Renamed" }, { root: "/tmp/shared", author });
    expect(second.ok).toBe(true);
    expect(fs.entries.size).toBe(1);
    expect(storedEntry().extra.title).toBe("Renamed");
    expect(storedEntry().extra.planRow).toEqual(planRow);
  });

  it("再共有で新しい対応を渡したら、そちらに置き換わる", async () => {
    const first = await shareNote(makeDoc(), { root: "/tmp/shared", author, planRow });
    if (!first.ok) throw new Error("first share failed");
    const next = { ...planRow, rowName: "こね（改）" };
    await shareNote(first.doc, { root: "/tmp/shared", author, planRow: next });
    expect(storedEntry().extra.planRow).toEqual(next);
  });

  it("前の版の対応が壊れた形なら引き継がない", async () => {
    const first = await shareNote(makeDoc(), { root: "/tmp/shared", author });
    if (!first.ok) throw new Error("first share failed");
    const key = [...fs.entries.keys()][0];
    const stored = JSON.parse(fs.entries.get(key)!);
    stored.entry.extra.planRow = { planIds: "oops" };
    fs.entries.set(key, JSON.stringify(stored));
    await shareNote(first.doc, { root: "/tmp/shared", author });
    expect("planRow" in storedEntry().extra).toBe(false);
  });
});

describe("shareNote — チェックの件数の写し（extra.checklist）", () => {
  const storedEntry = () => JSON.parse([...fs.entries.values()][0]).entry;
  const check = (id: string, text: string, checked: boolean) => ({
    id,
    type: "checkListItem",
    props: { checked },
    content: [{ type: "text", text }],
    children: [],
  });
  const withChecks = (blocks: unknown[]) => {
    const base = makeDoc();
    return { ...base, pages: [{ ...base.pages[0], blocks }] } as GraphiumDocument;
  };

  it("チェックリストのあるノートは、件数と本文の指紋が封筒に載る", async () => {
    const r = await shareNote(withChecks([check("c1", "粉を量る", true), check("c2", "こねる", false)]), {
      root: "/tmp/shared",
      author,
    });
    expect(r.ok).toBe(true);
    const extra = storedEntry().extra;
    expect(extra.checklist).toEqual({ checked: 1, total: 2, bodyHash: extra.bodyHash });
  });

  it("チェックリストが無いノートには項目ごと載せない（既存の封筒と同じ形のまま）", async () => {
    await shareNote(makeDoc(), { root: "/tmp/shared", author });
    expect("checklist" in storedEntry().extra).toBe(false);
  });

  it("再共有で数え直す。チェックリストを消したら項目ごと外れる", async () => {
    const first = await shareNote(withChecks([check("c1", "粉を量る", false)]), { root: "/tmp/shared", author });
    if (!first.ok) throw new Error("first share failed");
    expect(storedEntry().extra.checklist).toMatchObject({ checked: 0, total: 1 });

    const ticked = { ...first.doc, pages: [{ ...first.doc.pages[0], blocks: [check("c1", "粉を量る", true)] }] } as GraphiumDocument;
    const second = await shareNote(ticked, { root: "/tmp/shared", author });
    if (!second.ok) throw new Error("second share failed");
    const extra = storedEntry().extra;
    expect(extra.checklist).toEqual({ checked: 1, total: 1, bodyHash: extra.bodyHash });

    const cleared = { ...second.doc, pages: [{ ...second.doc.pages[0], blocks: makeDoc().pages[0].blocks }] } as GraphiumDocument;
    await shareNote(cleared, { root: "/tmp/shared", author });
    expect("checklist" in storedEntry().extra).toBe(false);
  });

  it("ナレッジの共有には載せない", async () => {
    const doc = {
      ...withChecks([check("c1", "粉を量る", true)]),
      source: "ai",
      wikiMeta: { kind: "concept" },
    } as unknown as GraphiumDocument;
    const r = await shareKnowledge(doc, { root: "/tmp/shared", author });
    // ナレッジとして共有できた場合だけ確かめる（できない文書なら、そもそも封筒が無い）
    if (r.ok) expect("checklist" in storedEntry().extra).toBe(false);
    else expect(fs.entries.size).toBe(0);
  });
});
