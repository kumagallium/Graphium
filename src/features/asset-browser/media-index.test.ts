// findBlockIdsByMediaUrl のユニットテスト

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  findBlockIdsByMediaUrl,
  updateBlockNameByUrl,
  collectPdfFileIdsFromDoc,
  collectSourceAssetFileIdsFromDoc,
  extractMediaFromBlocks,
  syncUsedIn,
  ensureMediaIndex,
  DOC_REF_BLOCK_ID,
  CURRENT_MEDIA_INDEX_VERSION,
  type MediaIndex,
  type MediaIndexEntry,
} from "./media-index";
import { getActiveProvider } from "../../lib/storage/registry";

vi.mock("../../lib/storage/registry", () => ({
  getActiveProvider: vi.fn(),
}));

describe("findBlockIdsByMediaUrl", () => {
  const targetUrl = "https://example.com/image.png";

  it("URL が一致する画像ブロックの ID を返す", () => {
    const blocks = [
      { id: "b1", type: "image", props: { url: targetUrl, name: "old.png" } },
      { id: "b2", type: "paragraph", props: {} },
    ];
    expect(findBlockIdsByMediaUrl(blocks, targetUrl)).toEqual(["b1"]);
  });

  it("複数ブロックが同じ URL を参照している場合すべて返す", () => {
    const blocks = [
      { id: "b1", type: "image", props: { url: targetUrl } },
      { id: "b2", type: "video", props: { url: targetUrl } },
    ];
    expect(findBlockIdsByMediaUrl(blocks, targetUrl)).toEqual(["b1", "b2"]);
  });

  it("子ブロックも再帰的に走査する", () => {
    const blocks = [
      {
        id: "parent", type: "paragraph", props: {},
        children: [
          { id: "child1", type: "audio", props: { url: targetUrl }, children: [] },
        ],
      },
    ];
    expect(findBlockIdsByMediaUrl(blocks, targetUrl)).toEqual(["child1"]);
  });

  it("URL が一致しないブロックは含まない", () => {
    const blocks = [
      { id: "b1", type: "image", props: { url: "https://other.com/img.png" } },
    ];
    expect(findBlockIdsByMediaUrl(blocks, targetUrl)).toEqual([]);
  });

  it("メディア以外のブロック型（paragraph 等）はスキップする", () => {
    const blocks = [
      { id: "b1", type: "paragraph", props: { url: targetUrl } },
    ];
    expect(findBlockIdsByMediaUrl(blocks, targetUrl)).toEqual([]);
  });

  it("pdf / file ブロック型も対象になる", () => {
    const blocks = [
      { id: "b1", type: "pdf", props: { url: targetUrl } },
      { id: "b2", type: "file", props: { url: targetUrl } },
    ];
    expect(findBlockIdsByMediaUrl(blocks, targetUrl)).toEqual(["b1", "b2"]);
  });

  it("空のブロック配列では空配列を返す", () => {
    expect(findBlockIdsByMediaUrl([], targetUrl)).toEqual([]);
  });
});

describe("updateBlockNameByUrl", () => {
  const targetUrl = "https://example.com/image.png";

  it("URL が一致するブロックの props.name を更新する", () => {
    const blocks = [
      { id: "b1", type: "image", props: { url: targetUrl, name: "old.png" } },
      { id: "b2", type: "paragraph", props: {} },
    ];
    const changed = updateBlockNameByUrl(blocks, targetUrl, "new.png");
    expect(changed).toBe(true);
    expect(blocks[0].props.name).toBe("new.png");
  });

  it("子ブロックも再帰的に更新する", () => {
    const blocks = [
      {
        id: "parent", type: "paragraph", props: {},
        children: [
          { id: "child1", type: "audio", props: { url: targetUrl, name: "old.mp3" }, children: [] },
        ],
      },
    ];
    const changed = updateBlockNameByUrl(blocks, targetUrl, "new.mp3");
    expect(changed).toBe(true);
    expect(blocks[0].children[0].props.name).toBe("new.mp3");
  });

  it("URL が一致しない場合は false を返し変更しない", () => {
    const blocks = [
      { id: "b1", type: "image", props: { url: "https://other.com/img.png", name: "other.png" } },
    ];
    const changed = updateBlockNameByUrl(blocks, targetUrl, "new.png");
    expect(changed).toBe(false);
    expect(blocks[0].props.name).toBe("other.png");
  });

  it("複数ブロックを一括更新できる", () => {
    const blocks = [
      { id: "b1", type: "image", props: { url: targetUrl, name: "old.png" } },
      { id: "b2", type: "video", props: { url: targetUrl, name: "old.mp4" } },
    ];
    const changed = updateBlockNameByUrl(blocks, targetUrl, "renamed");
    expect(changed).toBe(true);
    expect(blocks[0].props.name).toBe("renamed");
    expect(blocks[1].props.name).toBe("renamed");
  });
});

describe("collectPdfFileIdsFromDoc", () => {
  it("Wiki ノートの derivedFromNotes から pdf: prefix を抽出する", () => {
    const doc = {
      wikiMeta: {
        derivedFromNotes: ["pdf:abc123", "note:other", "pdf:def456"],
      },
    };
    const ids = collectPdfFileIdsFromDoc(doc);
    expect(ids).toEqual(new Set(["abc123", "def456"]));
  });

  it("PROV ノートの sourcePdfFileId を抽出する", () => {
    const doc = { sourcePdfFileId: "prov-pdf-1" };
    const ids = collectPdfFileIdsFromDoc(doc);
    expect(ids).toEqual(new Set(["prov-pdf-1"]));
  });

  it("Wiki と PROV の両方の参照を合算する", () => {
    const doc = {
      wikiMeta: { derivedFromNotes: ["pdf:a"] },
      sourcePdfFileId: "b",
    };
    expect(collectPdfFileIdsFromDoc(doc)).toEqual(new Set(["a", "b"]));
  });

  it("PDF 参照を持たない通常ノートでは空の Set を返す", () => {
    expect(collectPdfFileIdsFromDoc({})).toEqual(new Set());
    expect(collectPdfFileIdsFromDoc({ wikiMeta: { derivedFromNotes: ["note:x"] } }))
      .toEqual(new Set());
  });

  it("derivedFromNotes が undefined / 空でもエラーにならない", () => {
    expect(collectPdfFileIdsFromDoc({ wikiMeta: {} })).toEqual(new Set());
    expect(collectPdfFileIdsFromDoc({ wikiMeta: null })).toEqual(new Set());
  });

  it("pdf: の後ろが空文字なら無視する", () => {
    const doc = { wikiMeta: { derivedFromNotes: ["pdf:"] } };
    expect(collectPdfFileIdsFromDoc(doc)).toEqual(new Set());
  });
});

describe("syncUsedIn (document-level PDF 参照)", () => {
  function makeIndex(): MediaIndex {
    return {
      version: CURRENT_MEDIA_INDEX_VERSION,
      updatedAt: new Date().toISOString(),
      media: [
        {
          fileId: "pdf-1",
          name: "paper.pdf",
          type: "pdf",
          mimeType: "application/pdf",
          url: "media://pdf-1",
          thumbnailUrl: "",
          uploadedAt: new Date().toISOString(),
          usedIn: [],
        },
        {
          fileId: "img-1",
          name: "fig.png",
          type: "image",
          mimeType: "image/png",
          url: "media://img-1",
          thumbnailUrl: "",
          uploadedAt: new Date().toISOString(),
          usedIn: [],
        },
      ],
    };
  }

  it("currentDocRefFileIds が一致する PDF を usedIn に追加（DOC_REF_BLOCK_ID）", () => {
    const index = makeIndex();
    const updated = syncUsedIn(index, "wiki:w1", "Wiki Note", new Map(), new Set(["pdf-1"]));
    const pdf = updated.media.find((m) => m.fileId === "pdf-1")!;
    expect(pdf.usedIn).toHaveLength(1);
    expect(pdf.usedIn[0]).toEqual({
      noteId: "wiki:w1",
      noteTitle: "Wiki Note",
      blockId: DOC_REF_BLOCK_ID,
    });
    // 無関係なメディアには付かない
    expect(updated.media.find((m) => m.fileId === "img-1")!.usedIn).toHaveLength(0);
  });

  it("ブロック参照（mediaMap）と document-level 参照は両立する", () => {
    const index = makeIndex();
    const mediaMap = new Map<string, string>([["media://img-1", "block-42"]]);
    const updated = syncUsedIn(index, "n1", "Note", mediaMap, new Set(["pdf-1"]));
    expect(updated.media.find((m) => m.fileId === "img-1")!.usedIn).toEqual([
      { noteId: "n1", noteTitle: "Note", blockId: "block-42" },
    ]);
    expect(updated.media.find((m) => m.fileId === "pdf-1")!.usedIn).toEqual([
      { noteId: "n1", noteTitle: "Note", blockId: DOC_REF_BLOCK_ID },
    ]);
  });

  it("同じノートを再 sync すると古い entry が置き換わる（重複しない）", () => {
    let index = makeIndex();
    index = syncUsedIn(index, "wiki:w1", "Old Title", new Map(), new Set(["pdf-1"]));
    index = syncUsedIn(index, "wiki:w1", "New Title", new Map(), new Set(["pdf-1"]));
    const pdf = index.media.find((m) => m.fileId === "pdf-1")!;
    expect(pdf.usedIn).toHaveLength(1);
    expect(pdf.usedIn[0].noteTitle).toBe("New Title");
  });

  it("currentDocRefFileIds から外れたら usedIn から除去される", () => {
    let index = makeIndex();
    index = syncUsedIn(index, "wiki:w1", "Note", new Map(), new Set(["pdf-1"]));
    expect(index.media.find((m) => m.fileId === "pdf-1")!.usedIn).toHaveLength(1);
    index = syncUsedIn(index, "wiki:w1", "Note", new Map(), new Set());
    expect(index.media.find((m) => m.fileId === "pdf-1")!.usedIn).toHaveLength(0);
  });
});

describe("extractMediaFromBlocks", () => {
  it("メディアブロック（image/video/bookmark 等）の props.url を blockId に対応づける", () => {
    const blocks = [
      { id: "b1", type: "image", props: { url: "media://img-1" } },
      { id: "b2", type: "bookmark", props: { url: "https://example.com" } },
      { id: "b3", type: "paragraph", props: {}, content: [{ type: "text", text: "plain" }] },
    ];
    const map = extractMediaFromBlocks(blocks);
    expect(map.get("media://img-1")).toBe("b1");
    expect(map.get("https://example.com")).toBe("b2");
    expect(map.size).toBe(2);
  });

  it("本文中のインラインリンク（content の link）も href → blockId で拾う", () => {
    const blocks = [
      {
        id: "p1",
        type: "paragraph",
        props: {},
        content: [
          { type: "text", text: "参考: " },
          {
            type: "link",
            href: "https://news.example.com/article",
            content: [{ type: "text", text: "記事" }],
          },
        ],
      },
    ];
    const map = extractMediaFromBlocks(blocks);
    expect(map.get("https://news.example.com/article")).toBe("p1");
  });

  it("同じ href が実メディアブロックとインラインリンク両方にある場合はブロックの blockId を優先する", () => {
    const url = "https://example.com/page";
    const blocks = [
      {
        id: "p1",
        type: "paragraph",
        props: {},
        content: [{ type: "link", href: url, content: [{ type: "text", text: "link" }] }],
      },
      { id: "b1", type: "bookmark", props: { url } },
    ];
    const map = extractMediaFromBlocks(blocks);
    expect(map.get(url)).toBe("b1");
  });

  it("子ブロック内のインラインリンクも再帰的に拾う", () => {
    const blocks = [
      {
        id: "parent",
        type: "paragraph",
        props: {},
        content: [],
        children: [
          {
            id: "child",
            type: "paragraph",
            props: {},
            content: [{ type: "link", href: "https://child.example.com", content: [] }],
          },
        ],
      },
    ];
    const map = extractMediaFromBlocks(blocks);
    expect(map.get("https://child.example.com")).toBe("child");
  });
});

describe("collectSourceAssetFileIdsFromDoc (URL 出典)", () => {
  it("PROV / 翻訳ノートの sourceUrl を url: prefix 付きの fileId として集める", () => {
    const doc = { sourceUrl: "https://cookpad.com/jp/recipes/123" };
    expect(collectSourceAssetFileIdsFromDoc(doc)).toEqual(
      new Set(["url:https://cookpad.com/jp/recipes/123"]),
    );
  });

  it("derivedFromNotes の url: 参照はそのまま fileId として集める", () => {
    const doc = {
      wikiMeta: { derivedFromNotes: ["url:https://a.example.com", "note:other", "pdf:p1"] },
    };
    expect(collectSourceAssetFileIdsFromDoc(doc)).toEqual(
      new Set(["url:https://a.example.com", "p1"]),
    );
  });

  it("url: の後ろが空なら無視する", () => {
    const doc = { wikiMeta: { derivedFromNotes: ["url:"] } };
    expect(collectSourceAssetFileIdsFromDoc(doc)).toEqual(new Set());
  });

  it("URL 出典を持たないノートでは PDF / document 参照だけを返す", () => {
    const doc = { sourcePdfFileId: "p1", sourceDocumentFileId: "d1" };
    expect(collectSourceAssetFileIdsFromDoc(doc)).toEqual(new Set(["p1", "d1"]));
  });

  it("@リンク引用（citedAssetFileIds）の素材 fileId を集める", () => {
    // メディアピッカーのリンク挿入 / @mention 引用で記録された素材も usedIn に入れて
    // 埋め込みと挙動を揃える。URL 素材の "url:" 形式 fileId もそのまま通す。
    const doc = { citedAssetFileIds: ["doc-1", "pdf-2", "url:https://a.example.com"] };
    expect(collectSourceAssetFileIdsFromDoc(doc)).toEqual(
      new Set(["doc-1", "pdf-2", "url:https://a.example.com"]),
    );
  });

  it("空文字や未定義の citedAssetFileIds は無視する", () => {
    expect(collectSourceAssetFileIdsFromDoc({ citedAssetFileIds: ["", "ok-1"] })).toEqual(
      new Set(["ok-1"]),
    );
    expect(collectSourceAssetFileIdsFromDoc({})).toEqual(new Set());
  });
});

describe("ensureMediaIndex (フル再構築時の URL ブックマーク usedIn)", () => {
  const RAW_URL = "https://example.com/article";

  const urlBookmark = (usedIn: MediaIndexEntry["usedIn"]): MediaIndexEntry => ({
    fileId: "url_1700000000000_abc123",
    name: "example.com",
    type: "url",
    mimeType: "text/uri-list",
    url: RAW_URL,
    thumbnailUrl: "",
    uploadedAt: "2026-01-01T00:00:00.000Z",
    usedIn,
  });

  /** ブックマークブロックで RAW_URL を参照するノート doc */
  const docWithBookmark = {
    title: "ノート1",
    pages: [
      {
        blocks: [
          { id: "block-1", type: "bookmark", props: { url: RAW_URL } },
        ],
      },
    ],
  };

  const setupProvider = (existing: MediaIndex | null) => {
    vi.mocked(getActiveProvider).mockReturnValue({
      readAppData: vi.fn().mockResolvedValue(existing),
      writeAppData: vi.fn().mockResolvedValue(undefined),
      listMediaFiles: vi.fn().mockResolvedValue([]),
    } as any);
  };

  const runRebuild = (existing: MediaIndex | null) => {
    setupProvider(existing);
    const docCache = new Map<string, any>([["note-1", docWithBookmark]]);
    return ensureMediaIndex(
      [{ id: "note-1", name: "ノート1" }],
      docCache,
      async () => docWithBookmark,
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("既存 usedIn を温存せず走査で埋め直し、同一 noteId+blockId が重複しない", async () => {
    const existing: MediaIndex = {
      version: CURRENT_MEDIA_INDEX_VERSION,
      updatedAt: "2026-01-01T00:00:00.000Z",
      media: [
        urlBookmark([{ noteId: "note-1", noteTitle: "ノート1", blockId: "block-1" }]),
      ],
    };
    const index = await runRebuild(existing);
    const entry = index.media.find((m) => m.type === "url")!;
    expect(entry.usedIn).toEqual([
      { noteId: "note-1", noteTitle: "ノート1", blockId: "block-1" },
    ]);
  });

  it("再構築を繰り返しても usedIn が増えない", async () => {
    const initial: MediaIndex = {
      version: CURRENT_MEDIA_INDEX_VERSION,
      updatedAt: "2026-01-01T00:00:00.000Z",
      media: [urlBookmark([])],
    };
    // 1回目の走査で usage が 1 件付く
    let index = await runRebuild(initial);
    expect(index.media[0].usedIn).toHaveLength(1);
    // 1回目の結果を既存インデックスとして 2 回目・3 回目を実行
    index = await runRebuild(index);
    index = await runRebuild(index);
    expect(index.media[0].usedIn).toHaveLength(1);
  });

  it("重複が積み上がった旧バージョンのインデックスは強制再構築で解消される", async () => {
    const dupUsage = { noteId: "note-1", noteTitle: "古いタイトル", blockId: "block-1" };
    const existing: MediaIndex = {
      version: 3,
      updatedAt: "2026-01-01T00:00:00.000Z",
      media: [urlBookmark([dupUsage, dupUsage, dupUsage])],
    };
    const index = await runRebuild(existing);
    expect(index.version).toBe(CURRENT_MEDIA_INDEX_VERSION);
    const entry = index.media.find((m) => m.type === "url")!;
    // 重複が解消され、noteTitle も最新化される
    expect(entry.usedIn).toEqual([
      { noteId: "note-1", noteTitle: "ノート1", blockId: "block-1" },
    ]);
  });

  it("ノートから参照が消えた URL ブックマークは usedIn が空になる（エントリ自体は残る）", async () => {
    const existing: MediaIndex = {
      version: CURRENT_MEDIA_INDEX_VERSION,
      updatedAt: "2026-01-01T00:00:00.000Z",
      media: [
        urlBookmark([{ noteId: "note-1", noteTitle: "ノート1", blockId: "block-1" }]),
      ],
    };
    setupProvider(existing);
    const docWithoutUrl = { title: "ノート1", pages: [{ blocks: [] }] };
    const docCache = new Map<string, any>([["note-1", docWithoutUrl]]);
    const index = await ensureMediaIndex(
      [{ id: "note-1", name: "ノート1" }],
      docCache,
      async () => docWithoutUrl,
    );
    const entry = index.media.find((m) => m.type === "url")!;
    expect(entry.usedIn).toEqual([]);
  });
});
