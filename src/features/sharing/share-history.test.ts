// 再共有時の history 追記のテスト（純関数 + note / media / reference の 3 経路）。
//
// 検証の軸:
//   - 初回共有では history を付けない
//   - 再共有で旧版の hash / updated_at / author が 1 行積まれる
//   - 上限 50 件を超えたら古い順に落とす
//   - 履歴は hash 計算の対象外（履歴が増えただけで hash が動かない）

import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { appendHistory, SHARED_HISTORY_LIMIT, historyForUpdate } from "./share-history";
import { shareNote } from "./share-note";
import { shareMedia } from "./share-media";
import { shareReference } from "./share-reference";
import { computeSharedEntryHash, type SharedEntry } from "../../lib/storage/shared";
import type { AuthorIdentity } from "../document-provenance/types";
import type { GraphiumDocument } from "../../lib/document-types";
import type { MediaIndexEntry } from "../asset-browser/media-index";

const author: AuthorIdentity = { name: "Ada", email: "a@b.co" };
const ROOT = "/tmp/shared-root";
const BLOB_ROOT = "/tmp/blob-root";

class FakeFs {
  entries = new Map<string, string>();
  blobs = new Map<string, string>();
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
        case "read_media_file":
          return btoa("media-bytes");
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
  entry(folder: string, id: string): SharedEntry {
    const raw = this.entries.get(`${folder}/${id}`);
    if (!raw) throw new Error(`missing ${folder}/${id}`);
    return JSON.parse(raw).entry as SharedEntry;
  }
}

let fs: FakeFs;
beforeEach(() => {
  fs = new FakeFs();
  fs.install();
});

const doc = (overrides: Partial<GraphiumDocument> = {}): GraphiumDocument =>
  ({
    version: 5,
    title: "Note",
    pages: [{ id: "p1", title: "Note", blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] }],
    ...overrides,
  }) as GraphiumDocument;

const mediaEntry = (overrides: Partial<MediaIndexEntry> = {}): MediaIndexEntry =>
  ({
    fileId: "file-1",
    name: "spectrum.csv",
    type: "file",
    mimeType: "text/csv",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  }) as MediaIndexEntry;

const existing = (overrides: Partial<SharedEntry> = {}): SharedEntry => ({
  id: "0190a0a0-0000-7000-8000-000000000000",
  type: "note",
  author,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-02-01T00:00:00Z",
  hash: "sha256:old",
  prov: { derived_from: [] },
  ...overrides,
});

describe("appendHistory", () => {
  it("初回（既存なし）は undefined", () => {
    expect(appendHistory(null)).toBeUndefined();
    expect(appendHistory(existing({ hash: "" }))).toBeUndefined();
  });

  it("旧版の hash / 更新時刻 / 更新者を minor として 1 行積む", () => {
    expect(appendHistory(existing())).toEqual([
      {
        hash: "sha256:old",
        updated_at: "2026-02-01T00:00:00Z",
        updated_by: author,
        change_kind: "minor",
      },
    ]);
  });

  it(`上限 ${SHARED_HISTORY_LIMIT} 件を超えたら古い順に落とす`, () => {
    const history = Array.from({ length: SHARED_HISTORY_LIMIT }, (_, i) => ({
      hash: `sha256:h${i}`,
      updated_at: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      updated_by: author,
      change_kind: "minor" as const,
    }));
    const next = appendHistory(existing({ history }))!;
    expect(next).toHaveLength(SHARED_HISTORY_LIMIT);
    // 一番古い h0 が落ちて、直前の版が末尾に入る
    expect(next[0].hash).toBe("sha256:h1");
    expect(next[next.length - 1].hash).toBe("sha256:old");
  });

  it("読めなければ履歴なしで通す（共有そのものは失敗させない）", async () => {
    const provider = { read: async () => { throw new Error("gone"); } };
    expect(await historyForUpdate(provider, "id", true)).toBeUndefined();
  });
});

describe("再共有で history が積まれる", () => {
  it("note: 2 回目・3 回目の共有で 1 件ずつ増える", async () => {
    const first = await shareNote(doc(), { root: ROOT, author });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.entry.history).toBeUndefined();
    const id = first.entry.id;
    const firstHash = first.entry.hash;

    const second = await shareNote(doc({ title: "Note v2", sharedRef: first.doc.sharedRef }), {
      root: ROOT,
      author,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.isUpdate).toBe(true);
    expect(fs.entry("notes", id).history).toEqual([
      expect.objectContaining({ hash: firstHash, change_kind: "minor", updated_by: author }),
    ]);

    const third = await shareNote(doc({ title: "Note v3", sharedRef: second.doc.sharedRef }), {
      root: ROOT,
      author,
    });
    expect(third.ok).toBe(true);
    expect(fs.entry("notes", id).history).toHaveLength(2);
  });

  it("履歴は hash の計算に入らない（履歴が増えても内容が同じなら hash は同じ）", async () => {
    const base = existing({ hash: "" });
    const body = new TextEncoder().encode("body");
    const withoutHistory = await computeSharedEntryHash(base, body);
    const withHistory = await computeSharedEntryHash(
      { ...base, history: appendHistory(existing())! },
      body,
    );
    expect(withHistory).toBe(withoutHistory);
  });

  it("media: data-manifest の再共有で積まれる", async () => {
    const first = await shareMedia(mediaEntry(), {
      sharedRoot: ROOT,
      blobRoot: BLOB_ROOT,
      author,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(fs.entry("data-manifests", first.sharedRef.id).history).toBeUndefined();

    const second = await shareMedia(mediaEntry({ sharedRef: first.sharedRef }), {
      sharedRoot: ROOT,
      blobRoot: BLOB_ROOT,
      author,
    });
    expect(second.ok).toBe(true);
    expect(fs.entry("data-manifests", first.sharedRef.id).history).toEqual([
      expect.objectContaining({ hash: first.sharedRef.hash, change_kind: "minor" }),
    ]);
  });

  it("reference: URL ブックマークの再共有で積まれる", async () => {
    const url = mediaEntry({ type: "url", url: "https://example.com/paper", name: "Paper" });
    const first = await shareReference(url, { sharedRoot: ROOT, author });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(fs.entry("references", first.sharedRef.id).history).toBeUndefined();

    const second = await shareReference(mediaEntry({ ...url, sharedRef: first.sharedRef }), {
      sharedRoot: ROOT,
      author,
      title: "Paper (rev)",
    });
    expect(second.ok).toBe(true);
    expect(fs.entry("references", first.sharedRef.id).history).toEqual([
      expect.objectContaining({ hash: first.sharedRef.hash, change_kind: "minor" }),
    ]);
  });
});
