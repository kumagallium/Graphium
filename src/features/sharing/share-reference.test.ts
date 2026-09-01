// shareReference のテスト。URL ブックマークの reference SharedEntry 化を検証する。

import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import { shareReference } from "./share-reference";
import type { MediaIndexEntry } from "../asset-browser/media-index";
import type { AuthorIdentity } from "../document-provenance/types";

const author: AuthorIdentity = { name: "Ada", email: "a@b.co" };

class FakeFs {
  entries = new Map<string, string>();
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

function makeUrlEntry(overrides: Partial<MediaIndexEntry> = {}): MediaIndexEntry {
  return {
    fileId: "url-1",
    name: "Example Site",
    type: "url",
    mimeType: "text/html",
    url: "https://example.com/article",
    thumbnailUrl: "",
    uploadedAt: "2026-05-04T00:00:00Z",
    usedIn: [],
    urlMeta: {
      domain: "example.com",
      description: "An example article",
      ogImage: "https://example.com/og.png",
    },
    ...overrides,
  };
}

describe("shareReference — first share", () => {
  it("ok=true、type=reference の sharedRef を返す", async () => {
    const result = await shareReference(makeUrlEntry(), {
      sharedRoot: "/tmp/shared",
      author,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sharedRef.type).toBe("reference");
    expect(result.sharedRef.blobHash).toBeUndefined();
    expect(result.sharedRef.id).toMatch(/^[0-9a-f]{8}-/);
  });

  it("references/ フォルダに書き込まれる（data-manifests/ ではない）", async () => {
    await shareReference(makeUrlEntry(), { sharedRoot: "/tmp/shared", author });
    const keys = [...fs.entries.keys()];
    expect(keys.every((k) => k.startsWith("references/"))).toBe(true);
  });

  it("body に URL メタデータが入る（URL / title / domain / description）", async () => {
    await shareReference(makeUrlEntry({ name: "fallback" }), {
      sharedRoot: "/tmp/shared",
      author,
      title: "User Title",
      description: "User description",
    });
    const stored = JSON.parse([...fs.entries.values()][0]);
    const body = JSON.parse(atob(stored.body_base64));
    expect(body.url).toBe("https://example.com/article");
    expect(body.title).toBe("User Title");
    expect(body.domain).toBe("example.com");
    expect(body.description).toBe("User description");
  });

  it("og:image の remote URL は共有 body に載せない", async () => {
    // 載せると、受け取った側がカードを描くたびに publisher（多くは CDN・計測
    // ドメイン）へ GET が飛ぶ ——「チームの誰がいつ見たか」を配信元に配る経路になる
    await shareReference(makeUrlEntry(), { sharedRoot: "/tmp/shared", author });
    const stored = JSON.parse([...fs.entries.values()][0]);
    const raw = atob(stored.body_base64);
    expect(JSON.parse(raw).og_image).toBeUndefined();
    expect(raw).not.toContain("https://example.com/og.png");
    // extra（一覧表示用メタ）にも入っていないこと
    expect(JSON.stringify(stored.extra ?? {})).not.toContain("og.png");
  });

  it("title 未指定なら entry.name、description 未指定なら urlMeta.description", async () => {
    await shareReference(makeUrlEntry(), { sharedRoot: "/tmp/shared", author });
    const stored = JSON.parse([...fs.entries.values()][0]);
    const body = JSON.parse(atob(stored.body_base64));
    expect(body.title).toBe("Example Site");
    expect(body.description).toBe("An example article");
  });
});

describe("shareReference — re-share", () => {
  it("isUpdate=true で同じ id を維持する", async () => {
    const first = await shareReference(makeUrlEntry(), {
      sharedRoot: "/tmp/shared",
      author,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const reshared = await shareReference(
      makeUrlEntry({ sharedRef: first.sharedRef }),
      { sharedRoot: "/tmp/shared", author },
    );
    expect(reshared.ok).toBe(true);
    if (!reshared.ok) return;
    expect(reshared.isUpdate).toBe(true);
    expect(reshared.sharedRef.id).toBe(first.sharedRef.id);
  });
});

describe("shareReference — error paths", () => {
  it("URL 以外のエントリは ok=false", async () => {
    const r = await shareReference(
      { ...makeUrlEntry(), type: "image" },
      { sharedRoot: "/tmp/shared", author },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("only for URL bookmarks");
  });

  it("URL が空のエントリは ok=false", async () => {
    const r = await shareReference(
      { ...makeUrlEntry(), url: "" },
      { sharedRoot: "/tmp/shared", author },
    );
    expect(r.ok).toBe(false);
  });
});
