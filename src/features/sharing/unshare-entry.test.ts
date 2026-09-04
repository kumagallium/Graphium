// unshareEntry の blob GC のテスト。share-note.test.ts と同じく Tauri invoke をモックする。
//
// ここで守りたいのは 2 つ:
//   1. blob を持つ entry は type を問わず GC される（テンプレートの blob が孤立しない）
//   2. 他の entry がまだ参照している hash は消さない（content-addressed なので
//      ノートとテンプレートで同じ画像の hash が一致しうる）

import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import { unshareEntry } from "./unshare-entry";
import { newSharedId, type SharedEntry, type BlobRef } from "../../lib/storage/shared";
import type { AuthorIdentity } from "../document-provenance/types";

const author: AuthorIdentity = { name: "Ada", email: "a@b.co" };

const TYPE_TO_FOLDER: Record<string, string> = {
  note: "notes",
  reference: "references",
  "data-manifest": "data-manifests",
  template: "templates",
  knowledge: "knowledge",
  report: "reports",
};

function blobRef(hash: string): BlobRef {
  return { provider: "local-folder", uri: `local-folder://${hash}`, hash, size: 3 };
}

/** 共有ルート（entry JSON）と blob 置き場をメモリ上に持つ偽ファイルシステム */
class FakeFs {
  entries = new Map<string, string>(); // "folder/id" → StoredEntry JSON
  blobs = new Set<string>();
  /** list を失敗させたい folder（読み出し不能の再現用） */
  failListFolders = new Set<string>();

  add(type: string, blobHashes: string[]): SharedEntry {
    const id = newSharedId();
    const entry: SharedEntry = {
      id,
      type: type as SharedEntry["type"],
      author,
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
      hash: "sha256:" + "0".repeat(64),
      prov: { derived_from: [] },
      extra: blobHashes.length > 0 ? { blobs: blobHashes.map(blobRef) } : {},
    };
    this.entries.set(`${TYPE_TO_FOLDER[type]}/${id}`, JSON.stringify({ entry, body_base64: "" }));
    for (const h of blobHashes) this.blobs.add(h);
    return entry;
  }

  install() {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string, args: any) => {
      switch (cmd) {
        case "shared_read": {
          const v = this.entries.get(`${args.entryType}/${args.id}`);
          if (!v) throw new Error("not found");
          return v;
        }
        case "shared_list": {
          if (this.failListFolders.has(args.entryType)) throw new Error("list failed");
          const out: string[] = [];
          for (const [key, value] of this.entries) {
            if (key.startsWith(`${args.entryType}/`)) out.push(value);
          }
          return out;
        }
        case "shared_delete": {
          this.entries.set(`${args.entryType}/${args.id}`, args.tombstoneContent);
          return null;
        }
        case "shared_blob_delete":
          this.blobs.delete(args.hash);
          return null;
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

const opts = { root: "/tmp/shared", author, blobRoot: "/tmp/blobs" };

describe("unshareEntry — blob GC", () => {
  it("テンプレートの blob も GC される（data-manifest 限定にしない）", async () => {
    const template = fs.add("template", ["sha256:aaa"]);
    const r = await unshareEntry(template.id, opts);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.deletedBlobs).toEqual(["sha256:aaa"]);
    expect(fs.blobs.has("sha256:aaa")).toBe(false);
  });

  it("ノートの blob も GC される", async () => {
    const note = fs.add("note", ["sha256:bbb"]);
    const r = await unshareEntry(note.id, opts);
    expect(r.ok && r.deletedBlobs).toEqual(["sha256:bbb"]);
    expect(fs.blobs.has("sha256:bbb")).toBe(false);
  });

  it("同じ hash を別 type（ノート）が参照していれば消さない", async () => {
    fs.add("note", ["sha256:shared"]);
    const template = fs.add("template", ["sha256:shared", "sha256:only-template"]);
    const r = await unshareEntry(template.id, opts);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.deletedBlobs).toEqual(["sha256:only-template"]);
    expect(r.retainedBlobs).toEqual(["sha256:shared"]);
    expect(fs.blobs.has("sha256:shared")).toBe(true);
  });

  it("tombstone（status=unshared）は参照数に数えない", async () => {
    const older = fs.add("template", ["sha256:ccc"]);
    await unshareEntry(older.id, opts); // 1 件目を先に共有解除 → tombstone 化
    fs.blobs.add("sha256:ccc");
    const newer = fs.add("template", ["sha256:ccc"]);
    const r = await unshareEntry(newer.id, opts);
    expect(r.ok && r.deletedBlobs).toEqual(["sha256:ccc"]);
  });

  it("参照の数え上げに失敗したら 1 件も消さない（消すより残す）", async () => {
    const template = fs.add("template", ["sha256:ddd"]);
    fs.failListFolders.add("notes");
    const r = await unshareEntry(template.id, opts);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.deletedBlobs).toEqual([]);
    expect(r.retainedBlobs).toEqual(["sha256:ddd"]);
    expect(fs.blobs.has("sha256:ddd")).toBe(true);
  });

  it("blobRoot 未設定なら GC しない（tombstone 化だけ行う）", async () => {
    const template = fs.add("template", ["sha256:eee"]);
    const r = await unshareEntry(template.id, { root: "/tmp/shared", author });
    expect(r.ok && r.deletedBlobs).toEqual([]);
    expect(fs.blobs.has("sha256:eee")).toBe(true);
    // tombstone は立っている
    const stored = JSON.parse(fs.entries.get(`templates/${template.id}`)!);
    expect(stored.entry.status).toBe("unshared");
  });
});
