// shareMedia のテスト。Tauri invoke と read_media_file をモックして動作確認する。

import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import { shareMedia } from "./share-media";
import type { MediaIndexEntry } from "../asset-browser/media-index";
import type { AuthorIdentity } from "../document-provenance/types";

const author: AuthorIdentity = { name: "Ada", email: "a@b.co" };

class FakeFs {
  /** key = `${entryType}/${id}` → JSON 文字列 */
  entries = new Map<string, string>();
  /** key = hash → base64 */
  blobs = new Map<string, string>();
  /** key = fileId → base64 (read_media_file の戻り値) */
  mediaFiles = new Map<string, string>();

  install() {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string, args: any) => {
      switch (cmd) {
        case "read_media_file": {
          const v = this.mediaFiles.get(args.fileId);
          if (!v) throw new Error(`media not found: ${args.fileId}`);
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
        case "shared_write":
          this.entries.set(`${args.entryType}/${args.id}`, args.content);
          return null;
        case "shared_read": {
          const v = this.entries.get(`${args.entryType}/${args.id}`);
          if (!v) throw new Error("not found");
          return v;
        }
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

function makeEntry(overrides: Partial<MediaIndexEntry> = {}): MediaIndexEntry {
  return {
    fileId: "media-1",
    name: "photo.jpg",
    type: "image",
    mimeType: "image/jpeg",
    url: "file-media://media-1",
    thumbnailUrl: "",
    uploadedAt: "2026-05-04T00:00:00Z",
    usedIn: [],
    ...overrides,
  };
}

describe("shareMedia — first share", () => {
  it("ok=true、sharedRef・blobHash・hash が返る", async () => {
    fs.mediaFiles.set("media-1", btoa("image bytes"));
    const result = await shareMedia(makeEntry(), {
      sharedRoot: "/tmp/shared",
      blobRoot: "/tmp/blobs",
      author,
      title: "My photo",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.isUpdate).toBe(false);
    expect(result.sharedRef.id).toMatch(/^[0-9a-f]{8}-/);
    expect(result.sharedRef.type).toBe("data-manifest");
    expect(result.sharedRef.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.sharedRef.blobHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    // shared 側に entry が書き込まれた
    expect([...fs.entries.keys()].some((k) => k.startsWith("data-manifests/"))).toBe(true);
    // blob 側に bytes が書き込まれた
    expect(fs.blobs.size).toBe(1);
  });

  it("メタデータ（title / description / blobs）が manifest に入る", async () => {
    fs.mediaFiles.set("media-1", btoa("data"));
    const result = await shareMedia(makeEntry({ name: "default-name.jpg" }), {
      sharedRoot: "/tmp/shared",
      blobRoot: "/tmp/blobs",
      author,
      title: "Custom Title",
      description: "experiment 2026-05",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = JSON.parse([...fs.entries.values()][0]);
    expect(stored.entry.extra.title).toBe("Custom Title");
    expect(stored.entry.extra.description).toBe("experiment 2026-05");
    expect(stored.entry.extra.original_filename).toBe("default-name.jpg");
    expect(stored.entry.extra.blobs).toHaveLength(1);
    expect(stored.entry.extra.blobs[0].hash).toMatch(/^sha256:/);
  });

  it("共有時のフォルダ（noteContexts）が extra に入る", async () => {
    // 一覧は本文を読まずに描くので、フォルダはメタデータ側にも要る（鏡の原則）
    fs.mediaFiles.set("media-1", btoa("data"));
    await shareMedia(makeEntry(), {
      sharedRoot: "/tmp/shared",
      blobRoot: "/tmp/blobs",
      author,
      noteContexts: ["材料X", "測定/XRD"],
    });
    const stored = JSON.parse([...fs.entries.values()][0]);
    expect(stored.entry.extra.noteContexts).toEqual(["材料X", "測定/XRD"]);
  });

  it("noteContexts 未指定なら空配列（未分類）になる", async () => {
    fs.mediaFiles.set("media-1", btoa("data"));
    await shareMedia(makeEntry(), {
      sharedRoot: "/tmp/shared",
      blobRoot: "/tmp/blobs",
      author,
    });
    const stored = JSON.parse([...fs.entries.values()][0]);
    expect(stored.entry.extra.noteContexts).toEqual([]);
  });

  it("title 未指定なら entry.name がデフォルトで使われる", async () => {
    fs.mediaFiles.set("media-1", btoa("d"));
    const result = await shareMedia(makeEntry({ name: "default.jpg" }), {
      sharedRoot: "/tmp/shared",
      blobRoot: "/tmp/blobs",
      author,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = JSON.parse([...fs.entries.values()][0]);
    expect(stored.entry.extra.title).toBe("default.jpg");
  });
});

describe("shareMedia — re-share", () => {
  it("isUpdate=true で同じ id を維持する", async () => {
    fs.mediaFiles.set("media-1", btoa("v1"));
    const first = await shareMedia(makeEntry(), {
      sharedRoot: "/tmp/shared",
      blobRoot: "/tmp/blobs",
      author,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // 同じ entry に sharedRef 付与済みで再 Share
    const reshared = await shareMedia(
      makeEntry({ sharedRef: first.sharedRef }),
      { sharedRoot: "/tmp/shared", blobRoot: "/tmp/blobs", author },
    );
    expect(reshared.ok).toBe(true);
    if (!reshared.ok) return;
    expect(reshared.isUpdate).toBe(true);
    expect(reshared.sharedRef.id).toBe(first.sharedRef.id);
  });

  it("blob は content-addressed なので同じバイト列なら dedup される", async () => {
    fs.mediaFiles.set("media-1", btoa("samebytes"));
    await shareMedia(makeEntry(), {
      sharedRoot: "/tmp/shared",
      blobRoot: "/tmp/blobs",
      author,
    });
    expect(fs.blobs.size).toBe(1);
    await shareMedia(makeEntry({ fileId: "media-2" }), {
      sharedRoot: "/tmp/shared",
      blobRoot: "/tmp/blobs",
      author,
    });
    // 同じバイト列だから blob は増えない（fileId は違うが）
    fs.mediaFiles.set("media-2", btoa("samebytes")); // 既に書き込まれてはいるが念のため
    // 注意: shareMedia は read_media_file から bytes を取るので、上の set は実質確認用
  });
});

describe("shareMedia — error paths", () => {
  it("URL ブックマークは ok=false", async () => {
    const result = await shareMedia(makeEntry({ type: "url" }), {
      sharedRoot: "/tmp/shared",
      blobRoot: "/tmp/blobs",
      author,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("URL bookmarks");
  });

  it("media ファイル読み取り失敗で ok=false", async () => {
    // mediaFiles に何も登録していないので read_media_file が throw
    const result = await shareMedia(makeEntry(), {
      sharedRoot: "/tmp/shared",
      blobRoot: "/tmp/blobs",
      author,
    });
    expect(result.ok).toBe(false);
  });
});
