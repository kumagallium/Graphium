// shareNote のテスト。Tauri invoke をモックしてラウンドトリップを確認する。

import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import { shareNote } from "./share-note";
import type { GraphiumDocument } from "../../lib/document-types";
import type { AuthorIdentity } from "../document-provenance/types";

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
