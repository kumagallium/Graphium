// shareTemplate のテスト。share-note.test.ts と同じく Tauri invoke をモックする。

import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import { shareTemplate } from "./share-template";
import type { GraphiumDocument, GraphiumPage } from "../../lib/document-types";
import type { AuthorIdentity } from "../document-provenance/types";
import type { PageTemplate } from "../template/types";

const author: AuthorIdentity = { name: "Ada", email: "a@b.co" };

class FakeFs {
  entries = new Map<string, string>();
  blobs = new Map<string, string>(); // hash → base64
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
        case "shared_blob_write":
          this.blobs.set(args.hash, args.contentBase64);
          return null;
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
  fs = new FakeFs();
  fs.install();
});

function makePage(overrides: Partial<GraphiumPage> = {}): GraphiumPage {
  return {
    id: "main",
    title: "焼結の手順",
    blocks: [
      {
        id: "s1",
        type: "step",
        content: [{ type: "text", text: "秤量" }],
        children: [{ id: "p1", type: "paragraph", content: [] }],
      },
      { id: "s2", type: "step", content: [{ type: "text", text: "焼成" }], children: [] },
    ],
    labels: { s1: "procedure" },
    provLinks: [],
    knowledgeLinks: [],
    ...overrides,
  };
}

function makeDoc(page: GraphiumPage): GraphiumDocument {
  return {
    version: 6,
    title: "焼結ノート",
    pages: [page],
    createdAt: "2026-09-01T00:00:00Z",
    modifiedAt: "2026-09-01T00:00:00Z",
  };
}

/** 書き込まれた 1 件目の StoredEntry を読む */
function readStored() {
  const stored = JSON.parse([...fs.entries.values()][0]);
  // body は UTF-8 バイト列を base64 にしたもの。atob の結果をそのまま文字列扱いすると
  // 日本語が壊れるので、バイト列に戻してから TextDecoder で読む
  const bytes = Uint8Array.from(atob(stored.body_base64), (c) => c.charCodeAt(0));
  const body = JSON.parse(new TextDecoder().decode(bytes)) as PageTemplate;
  return { entry: stored.entry, body };
}

describe("shareTemplate — body / extra", () => {
  it("type=template で書き込まれ、body は PageTemplate の JSON", async () => {
    const page = makePage();
    const r = await shareTemplate(makeDoc(page), page, {
      sharedRoot: "/tmp/shared",
      author,
      title: "焼結テンプレ",
      description: "毎回これで始める",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const { entry, body } = readStored();
    expect(entry.type).toBe("template");
    expect(entry.author).toEqual(author);
    expect(body.name).toBe("焼結テンプレ");
    expect(body.pageTitle).toBe("焼結の手順");
    expect(body.blocks).toHaveLength(2);
    expect(body.labels).toEqual([["s1", "procedure"]]);
    // 呼び出し側が属性を渡さなければ空（page からは復元できない）
    expect(body.attributes).toEqual([]);
  });

  it("options.attributes（ラベルストアのスナップショット）が body に載る", async () => {
    const page = makePage({ labels: { s1: "procedure", s2: "procedure" } });
    await shareTemplate(makeDoc(page), page, {
      sharedRoot: "/tmp/shared",
      author,
      title: "T",
      attributes: [
        ["s1", { checked: true, executor: "ai", status: "done" }],
        ["s2", { checked: false, executor: "machine", status: "in-progress" }],
      ],
    });
    const { body } = readStored();
    expect(body.attributes).toEqual([
      ["s1", { checked: true, executor: "ai", status: "done" }],
      ["s2", { checked: false, executor: "machine", status: "in-progress" }],
    ]);
  });

  it("ラベルが付いていないブロックの属性は落とす（復元側で適用できないため）", async () => {
    const page = makePage(); // labels は s1 だけ
    await shareTemplate(makeDoc(page), page, {
      sharedRoot: "/tmp/shared",
      author,
      title: "T",
      attributes: [
        ["s1", { checked: true, executor: "human", status: "done" }],
        // 別ページ / 削除済みブロックの残骸
        ["zzz", { checked: true, executor: "ai", status: "done" }],
      ],
    });
    const { body } = readStored();
    expect(body.attributes).toEqual([
      ["s1", { checked: true, executor: "human", status: "done" }],
    ]);
  });

  it("extra に title / description / stepCount / labelCount / pageTitle が載る", async () => {
    const page = makePage();
    const r = await shareTemplate(makeDoc(page), page, {
      sharedRoot: "/tmp/shared",
      author,
      title: "焼結テンプレ",
      description: "説明",
    });
    expect(r.ok).toBe(true);
    const { entry } = readStored();
    expect(entry.extra.title).toBe("焼結テンプレ");
    expect(entry.extra.description).toBe("説明");
    expect(entry.extra.stepCount).toBe(2);
    expect(entry.extra.labelCount).toBe(1);
    expect(entry.extra.pageTitle).toBe("焼結の手順");
  });

  it("説明が空なら description は null", async () => {
    const page = makePage();
    await shareTemplate(makeDoc(page), page, {
      sharedRoot: "/tmp/shared",
      author,
      title: "T",
      description: "   ",
    });
    expect(readStored().entry.extra.description).toBeNull();
  });

  it("tableMeta / mediaInlineLabels が body に残る", async () => {
    const page = makePage({
      blocks: [
        {
          id: "t1",
          type: "table",
          content: { rows: [{ cells: [[{ type: "text", text: "試料" }]] }] },
        },
      ],
      tableMeta: { t1: { caption: "試料表", columns: { 試料: ["note-link"] } } },
      mediaInlineLabels: { m1: { label: "material", entityId: "e1" } },
    });
    await shareTemplate(makeDoc(page), page, {
      sharedRoot: "/tmp/shared",
      author,
      title: "T",
    });
    const { body } = readStored();
    expect(body.tableMeta).toEqual({
      t1: { caption: "試料表", columns: { 試料: ["note-link"] } },
    });
    expect(body.mediaInlineLabels).toEqual({ m1: { label: "material", entityId: "e1" } });
  });

  it("hash は entry に入り、共有のたびに新しい id になる（再共有の対応付けは持たない）", async () => {
    const page = makePage();
    const doc = makeDoc(page);
    const a = await shareTemplate(doc, page, {
      sharedRoot: "/tmp/shared",
      author,
      title: "T",
    });
    const b = await shareTemplate(doc, page, {
      sharedRoot: "/tmp/shared",
      author,
      title: "T",
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.entry.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(a.entry.id).not.toBe(b.entry.id);
    expect(fs.entries.size).toBe(2);
    // ノート側の共有状態は触らない
    expect(doc.sharedRef).toBeUndefined();
  });

  it("ページ以外（他ページ・チャット・来歴）は body に入らない", async () => {
    const page = makePage();
    const doc: GraphiumDocument = {
      ...makeDoc(page),
      pages: [page, { ...makePage(), id: "other", blocks: [{ id: "x", type: "paragraph" }] }],
      chats: [{ id: "c1", scope: "note", messages: [], createdAt: "", updatedAt: "" } as any],
    };
    await shareTemplate(doc, page, { sharedRoot: "/tmp/shared", author, title: "T" });
    const { body } = readStored();
    expect(JSON.stringify(body)).not.toContain("\"x\"");
    expect(JSON.stringify(body)).not.toContain("c1");
  });
});

describe("shareTemplate — auto blob", () => {
  const extractFileId = (url: string): string | null => {
    const m = url.match(/^file-media:\/\/(.+)$/);
    return m ? m[1] : null;
  };
  const fetchBytes = async (id: string): Promise<Uint8Array> => {
    if (id === "A") return new Uint8Array([1, 2, 3]);
    if (id === "B") return new Uint8Array([4, 5, 6]);
    throw new Error(`unknown ${id}`);
  };
  const mediaPage = () =>
    makePage({
      blocks: [
        { id: "b1", type: "image", props: { url: "file-media://A" } },
        { id: "b2", type: "image", props: { url: "file-media://A" } },
        { id: "b3", type: "video", props: { url: "file-media://B" } },
      ],
      labels: {},
    });

  it("メディアは shared-blob: に置換され、extra.blobs に dedup 済 BlobRef が載る", async () => {
    const page = mediaPage();
    const r = await shareTemplate(makeDoc(page), page, {
      sharedRoot: "/tmp/shared",
      blobRoot: "/tmp/blob",
      author,
      title: "T",
      __test: { extractFileId, fetchBytes },
    });
    expect(r.ok).toBe(true);
    const { entry, body } = readStored();
    expect(body.blocks[0].props.url).toMatch(/^shared-blob:sha256:[0-9a-f]{64}$/);
    expect(body.blocks[0].props.url).toBe(body.blocks[1].props.url);
    expect(body.blocks[2].props.url).not.toBe(body.blocks[0].props.url);
    expect(entry.extra.blobs).toHaveLength(2);
    expect(fs.blobs.size).toBe(2);
  });

  it("元のページは変更されない（immutable）", async () => {
    const page = mediaPage();
    await shareTemplate(makeDoc(page), page, {
      sharedRoot: "/tmp/shared",
      blobRoot: "/tmp/blob",
      author,
      title: "T",
      __test: { extractFileId, fetchBytes },
    });
    expect(page.blocks[0].props.url).toBe("file-media://A");
  });

  it("blobRoot 未設定でメディアがあると ok=false", async () => {
    const page = mediaPage();
    const r = await shareTemplate(makeDoc(page), page, {
      sharedRoot: "/tmp/shared",
      author,
      title: "T",
      __test: { extractFileId, fetchBytes },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Blob root");
  });

  it("メディアが無ければ blobRoot 未設定でも共有できる（extra.blobs は付かない）", async () => {
    const page = makePage();
    const r = await shareTemplate(makeDoc(page), page, {
      sharedRoot: "/tmp/shared",
      author,
      title: "T",
      __test: { extractFileId, fetchBytes },
    });
    expect(r.ok).toBe(true);
    expect(readStored().entry.extra.blobs).toBeUndefined();
  });
});

describe("shareTemplate — failure paths", () => {
  it("invoke が失敗すれば ok=false", async () => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async () => {
      throw new Error("disk full");
    });
    const page = makePage();
    const r = await shareTemplate(makeDoc(page), page, {
      sharedRoot: "/tmp/shared",
      author,
      title: "T",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("disk full");
  });
});
