// findBlockIdsByMediaUrl のユニットテスト

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  findBlockIdsByMediaUrl,
  updateBlockNameByUrl,
  collectPdfFileIdsFromDoc,
  collectSourceAssetFileIdsFromDoc,
  collectDataTableAssetFileIdsFromBlocks,
  extractMediaFromBlocks,
  syncUsedIn,
  ensureMediaIndex,
  buildUrlPeekEntry,
  isMobileCapture,
  persistOcrTextPatch,
  clearMediaIndexCache,
  saveMediaIndex,
  getFaviconUrl,
  buildFaviconCandidates,
  isThirdPartyFaviconUrl,
  normalizeFaviconUrl,
  normalizeMediaIndexEntry,
  normalizeMediaIndex,
  isLocalPreviewRef,
  previewImageKey,
  previewImageRef,
  previewRefKey,
  persistUrlMetaPatch,
  DOC_REF_BLOCK_ID,
  CURRENT_MEDIA_INDEX_VERSION,
  type MediaIndex,
  type MediaIndexEntry,
} from "./media-index";
import { getActiveProvider } from "../../lib/storage/registry";

vi.mock("../../lib/storage/registry", () => ({
  getActiveProvider: vi.fn(),
}));

// media-index は「保存中を含む最新」をモジュールに持つ（保存が飛んでいる最中に
// ディスクを読んで古い土台の上に上書きするのを防ぐため）。テストごとに別の
// インデックスを組むので、持ち越さないよう毎回捨てる。
beforeEach(() => {
  clearMediaIndexCache();
});

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

  it("取り込みで作られたテーブルの元ファイル（tableMeta.source.fileId）を集める", () => {
    // 表のセルにはファイルの痕跡が残らないため、ここで拾わないと元データだけ
    // 利用ノートが空になり、アセットグラフにも出ない
    const doc: { pages: { tableMeta: Record<string, { source?: { fileId?: string } }> }[] } = {
      pages: [
        {
          tableMeta: {
            "table-1": { source: { fileId: "dat-1" } },
            // 手打ちの表（source を持たない）は混ざらない
            "table-2": {},
          },
        },
        { tableMeta: { "table-3": { source: { fileId: "dat-2" } } } },
      ],
    };
    expect(collectSourceAssetFileIdsFromDoc(doc)).toEqual(new Set(["dat-1", "dat-2"]));
  });

  it("素材として登録していない取り込み（fileId 無し）は何も足さない", () => {
    const doc = { pages: [{ tableMeta: { "table-1": { source: {} } } }] };
    expect(collectSourceAssetFileIdsFromDoc(doc)).toEqual(new Set());
  });

  it("チャートが直接描いているデータ素材（config.assetSources）を集める。カラム内の chart も辿る", () => {
    // 表を経由しないので tableMeta には出てこない。ここで拾わないと、別のノートの図に
    // 重ねただけの素材は利用ノートが空のままになる
    const options = { headerRow: 1, endRow: 50, delimiter: "comma", collapseConsecutive: false };
    const chart = (fileIds: string[]) => ({
      type: "chart",
      props: {
        config: JSON.stringify({
          series: fileIds.map((id) => ({ sourceBlockId: `asset:${id}`, xColumn: "x", yColumn: "y" })),
          assetSources: fileIds.map((id) => ({ fileId: id, fileName: `${id}.csv`, options })),
        }),
      },
    });
    const doc = {
      pages: [
        {
          blocks: [
            { type: "paragraph", content: [] },
            chart(["dat-a"]),
            {
              type: "columnList",
              children: [{ type: "column", children: [chart(["dat-b", "dat-a"])] }],
            },
            // 素材を参照しない従来のチャート（ノート内テーブルだけ）は何も足さない
            { type: "chart", props: { config: JSON.stringify({ series: [{ sourceBlockId: "t1", xColumn: "x", yColumn: "y" }] }) } },
          ],
        },
      ],
    };
    expect(collectSourceAssetFileIdsFromDoc(doc)).toEqual(new Set(["dat-a", "dat-b"]));
  });
});

describe("collectDataTableAssetFileIdsFromBlocks", () => {
  const options = { headerRow: 1, endRow: 201, delimiter: "comma", collapseConsecutive: false };
  const dataTableBlock = (fileId: string | undefined) => ({
    type: "dataTable",
    props: {
      source: JSON.stringify({
        kind: "delimited-file",
        fileName: "log.csv",
        fileId,
        importedAt: "2026-09-05T00:00:00.000Z",
        options,
      }),
    },
  });

  it("トップレベルの dataTable ブロックから fileId を集める", () => {
    const blocks = [{ type: "paragraph", content: [] }, dataTableBlock("dat-1")];
    expect(collectDataTableAssetFileIdsFromBlocks(blocks)).toEqual(new Set(["dat-1"]));
  });

  it("columnList > column の children に入った dataTable も辿る", () => {
    const blocks = [
      {
        type: "columnList",
        children: [{ type: "column", children: [dataTableBlock("dat-2")] }],
      },
    ];
    expect(collectDataTableAssetFileIdsFromBlocks(blocks)).toEqual(new Set(["dat-2"]));
  });

  it("fileId が無い（素材未登録）dataTable は無視する", () => {
    const blocks = [dataTableBlock(undefined)];
    expect(collectDataTableAssetFileIdsFromBlocks(blocks)).toEqual(new Set());
  });

  it("dataTable 以外のブロックは無視する", () => {
    const blocks = [{ type: "paragraph", content: [] }, { type: "table", content: {} }];
    expect(collectDataTableAssetFileIdsFromBlocks(blocks)).toEqual(new Set());
  });

  it("collectSourceAssetFileIdsFromDoc の pages 経由でも dataTable の fileId を拾う", () => {
    const doc = {
      pages: [
        { blocks: [dataTableBlock("dat-3")] },
        {
          blocks: [
            {
              type: "columnList",
              children: [{ type: "column", children: [dataTableBlock("dat-4")] }],
            },
          ],
        },
      ],
    };
    expect(collectSourceAssetFileIdsFromDoc(doc)).toEqual(new Set(["dat-3", "dat-4"]));
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

describe("ensureMediaIndex（ノートに貼った画像の OCR テキスト集約）", () => {
  const IMG_URL = "local-media://img-1";

  const imageEntry = (ocrText?: string): MediaIndexEntry => ({
    fileId: "img-1",
    name: "scan.png",
    type: "image",
    mimeType: "image/png",
    url: IMG_URL,
    thumbnailUrl: IMG_URL,
    uploadedAt: "2026-01-01T00:00:00.000Z",
    usedIn: [],
    ...(ocrText ? { ocrText } : {}),
  });

  /** 画像ブロック + mediaOcr サイドストアを持つノート doc */
  const docWithOcr = (text?: string) => ({
    title: "実験ノート",
    pages: [
      {
        blocks: [{ id: "block-1", type: "image", props: { url: IMG_URL } }],
        ...(text ? { mediaOcr: { "block-1": { text } } } : {}),
      },
    ],
  });

  const runRebuild = (existing: MediaIndex, doc: ReturnType<typeof docWithOcr>) => {
    vi.mocked(getActiveProvider).mockReturnValue({
      readAppData: vi.fn().mockResolvedValue(existing),
      writeAppData: vi.fn().mockResolvedValue(undefined),
      listMediaFiles: vi.fn().mockResolvedValue([
        { id: "img-1", name: "scan.png", mimeType: "image/png", createdTime: "2026-01-01T00:00:00.000Z" },
      ]),
    } as any);
    const docCache = new Map<string, any>([["note-1", doc]]);
    return ensureMediaIndex([{ id: "note-1", name: "実験ノート" }], docCache, async () => doc);
  };

  /** v5 より前のインデックス（ノート由来 OCR が素材に写っていない状態） */
  const staleIndex = (ocrText?: string): MediaIndex => ({
    version: 4,
    updatedAt: "2026-01-01T00:00:00.000Z",
    media: [imageEntry(ocrText)],
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ノートで読み取った OCR テキストを素材の ocrText に回収する", async () => {
    const index = await runRebuild(staleIndex(), docWithOcr("焼結温度 800℃ で 2 時間 保持"));
    expect(index.version).toBe(CURRENT_MEDIA_INDEX_VERSION);
    expect(index.media[0].ocrText).toBe("焼結温度 800℃ で 2 時間 保持");
  });

  it("素材ギャラリーで読み取った既存の ocrText は上書きしない", async () => {
    const index = await runRebuild(
      staleIndex("ギャラリーで読んだ文字"),
      docWithOcr("ノートで読んだ文字"),
    );
    expect(index.media[0].ocrText).toBe("ギャラリーで読んだ文字");
  });

  it("mediaOcr を持たないノートの画像には ocrText が付かない", async () => {
    const index = await runRebuild(staleIndex(), docWithOcr());
    expect(index.media[0].ocrText).toBeUndefined();
  });

  it("空白だけの OCR テキストは写さない", async () => {
    const index = await runRebuild(staleIndex(), docWithOcr("   \n  "));
    expect(index.media[0].ocrText).toBeUndefined();
  });
});

describe("ensureMediaIndex（走査中の変更を落とさない）", () => {
  const existingEntry: MediaIndexEntry = {
    fileId: "img-1",
    name: "old.png",
    type: "image",
    mimeType: "image/png",
    url: "local-media://img-1",
    thumbnailUrl: "",
    uploadedAt: "2026-01-01T00:00:00.000Z",
    usedIn: [],
    contentHash: "sha256:old",
  };

  /** 走査開始時点のディスク・listing と、ノート読み込み中に走らせる副作用を渡す */
  const runRebuild = (existing: MediaIndex | null, duringWalk?: () => Promise<void>) => {
    vi.mocked(getActiveProvider).mockReturnValue({
      readAppData: vi.fn().mockResolvedValue(existing),
      writeAppData: vi.fn().mockResolvedValue(undefined),
      listMediaFiles: vi.fn().mockResolvedValue([
        { id: "img-1", name: "old.png", mimeType: "image/png", createdTime: "2026-01-01T00:00:00.000Z" },
      ]),
    } as any);
    const doc = { title: "ノート1", pages: [{ blocks: [] }] };
    return ensureMediaIndex([{ id: "note-1", name: "ノート1" }], new Map(), async () => {
      // ノート読み込みは秒単位かかる。その最中のアップロード等を再現する
      if (duringWalk) await duringWalk();
      return doc;
    });
  };

  const stale = (media: MediaIndexEntry[]): MediaIndex => ({
    version: 4, // 旧バージョン = 強制再構築の経路に入る
    updatedAt: "2026-01-01T00:00:00.000Z",
    media,
  });

  it("走査中にアップロードされた素材とその contentHash を残す", async () => {
    const uploaded: MediaIndexEntry = {
      fileId: "img-2",
      name: "new.png",
      type: "image",
      mimeType: "image/png",
      url: "local-media://img-2",
      thumbnailUrl: "",
      uploadedAt: "2026-08-14T00:00:00.000Z",
      usedIn: [],
      contentHash: "sha256:new",
    };
    // 走査中に handleUploadAsset 相当が走る（listing には間に合わない）
    const index = await runRebuild(stale([existingEntry]), async () => {
      await saveMediaIndex({
        version: CURRENT_MEDIA_INDEX_VERSION,
        updatedAt: "2026-08-14T00:00:01.000Z",
        media: [existingEntry, uploaded],
      });
    });

    const added = index.media.find((m) => m.fileId === "img-2");
    expect(added).toBeDefined();
    expect(added!.contentHash).toBe("sha256:new");
  });

  it("走査中に既存素材へ書かれた情報（ocrText）を落とさない", async () => {
    const index = await runRebuild(stale([existingEntry]), async () => {
      await saveMediaIndex({
        version: CURRENT_MEDIA_INDEX_VERSION,
        updatedAt: "2026-08-14T00:00:01.000Z",
        media: [{ ...existingEntry, ocrText: "走査中に読んだ文字" }],
      });
    });
    expect(index.media.find((m) => m.fileId === "img-1")!.ocrText).toBe("走査中に読んだ文字");
  });

  it("走査中に削除された素材を復活させない", async () => {
    const index = await runRebuild(stale([existingEntry]), async () => {
      await saveMediaIndex({
        version: CURRENT_MEDIA_INDEX_VERSION,
        updatedAt: "2026-08-14T00:00:01.000Z",
        media: [],
      });
    });
    expect(index.media.map((m) => m.fileId)).toEqual([]);
  });

  it("実体が消えた既存素材は従来どおりインデックスから落とす", async () => {
    // listing に載っている img-1 のほかに、実体が無い img-gone が index に居る
    const gone: MediaIndexEntry = { ...existingEntry, fileId: "img-gone", url: "local-media://img-gone" };
    const index = await runRebuild(stale([existingEntry, gone]));
    expect(index.media.map((m) => m.fileId)).toEqual(["img-1"]);
  });
});

describe("buildUrlPeekEntry", () => {
  const url = "https://en.wikipedia.org/wiki/Electronic_lab_notebook";

  it("同一 URL の既存素材があればそのエントリを返す（登録名・fileId を保持）", () => {
    const existing: MediaIndexEntry = {
      fileId: "url_123_abc",
      name: "Electronic lab notebook",
      mimeType: "text/x-uri",
      type: "url",
      url,
      thumbnailUrl: "",
      uploadedAt: "2026-01-01T00:00:00.000Z",
      usedIn: [],
      urlMeta: { domain: "en.wikipedia.org" },
    };
    const result = buildUrlPeekEntry(url, { media: [existing] });
    expect(result).toBe(existing);
  });

  it("既存素材が無ければ URL からアドホックなエントリを組み立てる", () => {
    const result = buildUrlPeekEntry(url, { media: [] });
    expect(result.type).toBe("url");
    expect(result.url).toBe(url);
    expect(result.fileId).toBe(`url:${url}`);
    expect(result.name).toBe("en.wikipedia.org");
    expect(result.urlMeta?.domain).toBe("en.wikipedia.org");
  });

  it("mediaIndex が null でもアドホックに組み立てられる", () => {
    const result = buildUrlPeekEntry(url, null);
    expect(result.type).toBe("url");
    expect(result.url).toBe(url);
  });
});

// 受信箱から取り込まれた素材か（来歴 capture メタの有無）。取り込み後の素材は
// 通常の素材として扱うので一覧では区別しないが、来歴は残る（詳細表示・PROV 用）。
describe("isMobileCapture", () => {
  const base: MediaIndexEntry = {
    fileId: "f1",
    name: "a.jpg",
    type: "image",
    mimeType: "image/jpeg",
    url: "local-media://f1",
    thumbnailUrl: "local-media://f1",
    uploadedAt: "2026-07-24T00:00:00.000Z",
    usedIn: [],
  };

  it("capture メタを持つ素材だけ true を返す", () => {
    const withCapture: MediaIndexEntry = {
      ...base,
      capture: { id: "sha256:abc", checksum: "sha256:abc", mime: "image/jpeg", bytes: 123 },
    };
    expect(isMobileCapture(withCapture)).toBe(true);
    expect(isMobileCapture(base)).toBe(false);
  });

  it("述語でフィルタすると capture 素材（画像/動画混在）だけが残る", () => {
    const media: MediaIndexEntry[] = [
      base, // capture なし → 除外
      { ...base, fileId: "f2", capture: { id: "sha256:2", checksum: "sha256:2", mime: "image/png", bytes: 1 } },
      { ...base, fileId: "f3", type: "video", capture: { id: "sha256:3", checksum: "sha256:3", mime: "video/mp4", bytes: 2 } },
    ];
    const picked = media.filter(isMobileCapture).map((m) => m.fileId);
    expect(picked).toEqual(["f2", "f3"]);
  });
});

// ──────────────────────────────────
// persistOcrTextPatch — 素材ギャラリーから読んだ OCR テキストの書き戻し
// ──────────────────────────────────

describe("persistOcrTextPatch", () => {
  const image = (over: Partial<MediaIndexEntry> = {}): MediaIndexEntry => ({
    fileId: "img-1",
    name: "scan.png",
    type: "image",
    mimeType: "image/png",
    url: "media-server://img-1",
    thumbnailUrl: "",
    uploadedAt: "2026-01-01T00:00:00.000Z",
    usedIn: [],
    ...over,
  });

  const setup = (existing: MediaIndex | null) => {
    const writeAppData = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getActiveProvider).mockReturnValue({
      readAppData: vi.fn().mockResolvedValue(existing),
      writeAppData,
    } as any);
    return writeAppData;
  };

  const indexOf = (...media: MediaIndexEntry[]): MediaIndex => ({
    version: CURRENT_MEDIA_INDEX_VERSION,
    updatedAt: "2026-01-01T00:00:00.000Z",
    media,
  });

  /** writeAppData に渡された MediaIndex を取り出す */
  const written = (writeAppData: ReturnType<typeof vi.fn>): MediaIndex =>
    writeAppData.mock.calls[0][1] as MediaIndex;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ノートに使われていない画像にもテキストを保存できる", async () => {
    const writeAppData = setup(indexOf(image()));
    await persistOcrTextPatch("img-1", "焼結温度 800℃");
    expect(writeAppData).toHaveBeenCalledTimes(1);
    expect(written(writeAppData).media[0].ocrText).toBe("焼結温度 800℃");
  });

  it("前後の空白は落として保存する", async () => {
    const writeAppData = setup(indexOf(image()));
    await persistOcrTextPatch("img-1", "  SEM XRD  ");
    expect(written(writeAppData).media[0].ocrText).toBe("SEM XRD");
  });

  it("同じテキストなら書き込まない（無駄な保存とイベントを避ける）", async () => {
    const writeAppData = setup(indexOf(image({ ocrText: "同じ" })));
    await persistOcrTextPatch("img-1", "同じ");
    expect(writeAppData).not.toHaveBeenCalled();
  });

  it("文字が取れなかったら既存のテキストを消す", async () => {
    const writeAppData = setup(indexOf(image({ ocrText: "古い結果" })));
    await persistOcrTextPatch("img-1", "   ");
    expect(written(writeAppData).media[0]).not.toHaveProperty("ocrText");
  });

  it("他の素材には触らない", async () => {
    const writeAppData = setup(
      indexOf(image(), image({ fileId: "img-2", ocrText: "そのまま" })),
    );
    await persistOcrTextPatch("img-1", "新規");
    const media = written(writeAppData).media;
    expect(media.find((m) => m.fileId === "img-1")?.ocrText).toBe("新規");
    expect(media.find((m) => m.fileId === "img-2")?.ocrText).toBe("そのまま");
  });

  it("インデックスが無ければ何もしない", async () => {
    const writeAppData = setup(null);
    await persistOcrTextPatch("img-1", "テキスト");
    expect(writeAppData).not.toHaveBeenCalled();
  });
});

describe("favicon（第三者サービスを使わない）", () => {
  // 旧実装が thumbnailUrl に永続化していた第三者 favicon サービスの URL。
  // 「第三者 favicon URL がソースに残っていないか」を見る grep sweep に
  // テストのリテラルまで引っかからないよう、パスは分割して組み立てる。
  const LEGACY_ORIGIN = "https://www.google.com";
  const LEGACY_PATH_SEGMENTS = ["s2", "favicons"];
  const legacyFavicon = (query: string) =>
    `${LEGACY_ORIGIN}/${LEGACY_PATH_SEGMENTS.join("/")}?${query}`;
  const LEGACY = legacyFavicon("domain=internal.corp.example&sz=64");

  it("favicon はブックマーク先のサイト自身から取る", () => {
    expect(getFaviconUrl("example.com")).toBe("https://example.com/favicon.ico");
    expect(getFaviconUrl("internal.corp.example", 32)).toBe(
      "https://internal.corp.example/favicon.ico",
    );
  });

  it("どのサイズ指定でも第三者ホストを参照しない", () => {
    for (const size of [16, 32, 64, 128]) {
      expect(getFaviconUrl("secret-codename.example.com", size)).not.toContain("google");
    }
  });

  it("サイトが宣言したアイコンがあればそちらを優先する", () => {
    const declared = "https://example.com/assets/icon-192.png";
    expect(getFaviconUrl("example.com", 64, declared)).toBe(declared);
    expect(buildFaviconCandidates("example.com", declared)).toEqual([
      declared,
      "https://example.com/favicon.ico",
    ]);
  });

  it("宣言アイコンが第三者サービス・非 http(s) なら無視して自サイトに落とす", () => {
    expect(getFaviconUrl("example.com", 64, LEGACY)).toBe("https://example.com/favicon.ico");
    expect(getFaviconUrl("example.com", 64, "javascript:alert(1)")).toBe(
      "https://example.com/favicon.ico",
    );
  });

  // 宣言アイコンはブックマーク先の HTML から読む＝相手が自由に書ける値なので、
  // 別オリジンを指していたら捨てる。通すと `<link rel="icon"
  // href="https://tracker.example/px.png?v=訪問者ID">` がそのまま保存され、
  // ブックマークを描画するたびに第三者へビーコンが飛ぶ。
  it("別オリジンの宣言アイコンは捨ててページ自身の /favicon.ico に落とす", () => {
    const pageUrl = "https://evil.example/post";
    const tracker = "https://tracker.example/px.png?v=visitor-123";
    expect(getFaviconUrl("evil.example", 64, tracker, pageUrl)).toBe(
      "https://evil.example/favicon.ico",
    );
    expect(buildFaviconCandidates("evil.example", tracker, pageUrl)).toEqual([
      "https://evil.example/favicon.ico",
    ]);
    // 別ホストの URL が候補のどこにも混ざらない
    expect(
      buildFaviconCandidates("evil.example", tracker, pageUrl).join(" "),
    ).not.toContain("tracker.example");
  });

  it("同一オリジンの宣言アイコンはそのまま採用する", () => {
    const pageUrl = "https://example.com/blog/post";
    const declared = "https://example.com/assets/icon-192.png";
    expect(buildFaviconCandidates("example.com", declared, pageUrl)).toEqual([
      declared,
      "https://example.com/favicon.ico",
    ]);
  });

  it("同じホストでもポート・スキームが違えば別オリジンとして弾く", () => {
    // 完全一致（スキーム + ホスト + ポート）で判定する。登録可能ドメイン単位に
    // 緩めるには public suffix list が要るし、CDN 配信のアイコンが弾かれても
    // /favicon.ico に落ちるだけで実害が無い。
    const pageUrl = "https://internal.example/wiki";
    expect(
      buildFaviconCandidates("internal.example", "https://internal.example:8443/icon.png", pageUrl),
    ).toEqual(["https://internal.example/favicon.ico"]);
    expect(
      buildFaviconCandidates("internal.example", "http://internal.example/icon.png", pageUrl),
    ).toEqual(["https://internal.example/favicon.ico"]);
    // 逆向き（ページが非標準ポート）も同じく別オリジン扱い
    expect(
      buildFaviconCandidates(
        "internal.example",
        "https://internal.example/icon.png",
        "http://internal.example:8080/wiki",
      ),
    ).toEqual(["http://internal.example:8080/favicon.ico"]);
  });

  it("data:image の宣言アイコンはオリジンに関わらず通す（通信が起きない）", () => {
    const inline = "data:image/png;base64,iVBORw0KGgo=";
    expect(buildFaviconCandidates("example.com", inline, "https://example.com/x")).toEqual([
      inline,
      "https://example.com/favicon.ico",
    ]);
    expect(getFaviconUrl("example.com", 64, inline, "https://example.com/x")).toBe(inline);
  });

  it("過大な data:image は弾く（media-index の肥大を入力側で止める）", () => {
    // 宣言アイコンは相手ページが書き放題の値。通信は起きないが、値は
    // media-index に保存され共有ストレージにも乗るので上限を設ける。
    const huge = `data:image/png;base64,${"A".repeat(64 * 1024)}`;
    expect(buildFaviconCandidates("example.com", huge, "https://example.com/x")).toEqual([
      "https://example.com/favicon.ico",
    ]);
  });

  it("同一オリジンでも userinfo は保存前に落とす", () => {
    // URL.origin は userinfo を含まないので同一オリジン判定は通る。そのまま
    // 保存すると資格情報が media-index と共有ストレージに残る。
    expect(
      buildFaviconCandidates(
        "wiki.corp",
        "https://svc:s3cret@wiki.corp/icon.png",
        "https://wiki.corp/page",
      ),
    ).toEqual(["https://wiki.corp/icon.png", "https://wiki.corp/favicon.ico"]);
  });

  it("比較相手のオリジンが判らなければ宣言アイコンも通さない", () => {
    expect(buildFaviconCandidates("", "https://cdn.example/icon.png")).toEqual([]);
  });

  it("ドメインが空・不正なら空文字（呼び出し側は img を描画しない）", () => {
    expect(getFaviconUrl("")).toBe("");
    expect(getFaviconUrl("not a domain")).toBe("");
    expect(buildFaviconCandidates("")).toEqual([]);
  });

  it("ポート付きの内部ホストはポートとスキームを保つ", () => {
    expect(getFaviconUrl("http://internal.example:8080/page")).toBe(
      "http://internal.example:8080/favicon.ico",
    );
  });

  it("フル URL を渡せば hostname だけの domain よりスキーム・ポートが優先される", () => {
    // 実際の呼び出しは extractDomain 由来の hostname を domain に渡すため、
    // フル URL を併せて渡さないと社内ホストで別ホストの favicon を指してしまう。
    const pageUrl = "http://internal.example:8080/wiki/page";
    expect(getFaviconUrl("internal.example", 64, undefined, pageUrl)).toBe(
      "http://internal.example:8080/favicon.ico",
    );
    expect(buildFaviconCandidates("internal.example", undefined, pageUrl)).toEqual([
      "http://internal.example:8080/favicon.ico",
    ]);
    // 宣言アイコンがあれば従来どおりそちらが先頭
    const declared = "http://internal.example:8080/static/icon.png";
    expect(buildFaviconCandidates("internal.example", declared, pageUrl)).toEqual([
      declared,
      "http://internal.example:8080/favicon.ico",
    ]);
  });

  it("フル URL が空・不正なら domain へフォールバックする", () => {
    expect(buildFaviconCandidates("example.com", undefined, "")).toEqual([
      "https://example.com/favicon.ico",
    ]);
    expect(buildFaviconCandidates("example.com", undefined, "not a url")).toEqual([
      "https://example.com/favicon.ico",
    ]);
  });

  it("isThirdPartyFaviconUrl は旧 favicon サービスの URL だけを検出する", () => {
    expect(isThirdPartyFaviconUrl(LEGACY)).toBe(true);
    expect(isThirdPartyFaviconUrl("https://example.com/favicon.ico")).toBe(false);
    expect(isThirdPartyFaviconUrl("")).toBe(false);
    expect(isThirdPartyFaviconUrl(undefined)).toBe(false);
  });

  it("保存済みの第三者 favicon URL はサイト自身の favicon に書き換わる", () => {
    expect(normalizeFaviconUrl(LEGACY)).toBe("https://internal.corp.example/favicon.ico");
    // domain_url 形式（フル URL）も復元できる
    expect(
      normalizeFaviconUrl(legacyFavicon("domain_url=https%3A%2F%2Fexample.com%2Fa")),
    ).toBe("https://example.com/favicon.ico");
  });

  it("第三者 URL でないサムネイルはそのまま返す", () => {
    const url = "https://lh3.googleusercontent.com/d/abc=s200";
    expect(normalizeFaviconUrl(url)).toBe(url);
    expect(normalizeFaviconUrl("")).toBe("");
  });

  it("既存エントリの thumbnailUrl / urlMeta.faviconUrl を読み込み時に正規化する", () => {
    const entry: MediaIndexEntry = {
      fileId: "url_1",
      name: "internal",
      type: "url",
      mimeType: "text/x-uri",
      url: "https://internal.corp.example/doc",
      thumbnailUrl: LEGACY,
      uploadedAt: "2026-01-01T00:00:00.000Z",
      usedIn: [],
      urlMeta: { domain: "internal.corp.example", faviconUrl: LEGACY },
    };
    const normalized = normalizeMediaIndexEntry(entry);
    expect(normalized.thumbnailUrl).toBe("https://internal.corp.example/favicon.ico");
    expect(normalized.urlMeta?.faviconUrl).toBe("https://internal.corp.example/favicon.ico");
    // 他のフィールドは温存
    expect(normalized.urlMeta?.domain).toBe("internal.corp.example");
  });

  it("書き換え不要なエントリは同一参照のまま返す", () => {
    const entry: MediaIndexEntry = {
      fileId: "url_2",
      name: "example",
      type: "url",
      mimeType: "text/x-uri",
      url: "https://example.com/",
      thumbnailUrl: "https://example.com/favicon.ico",
      uploadedAt: "2026-01-01T00:00:00.000Z",
      usedIn: [],
      urlMeta: { domain: "example.com" },
    };
    expect(normalizeMediaIndexEntry(entry)).toBe(entry);
  });

  it("thumbnailUrl キーが無い保存データでも同一参照のまま返す（キーも生やさない）", () => {
    // index は型無しの JSON として読むので、TypeScript 上は必須の thumbnailUrl が
    // 実データに無いことがある。ここで新オブジェクトを配ると readMediaIndex の
    // たびに参照が変わり、useMemo / React.memo の同一性キャッシュが全部壊れる。
    const entry = {
      fileId: "img_1",
      name: "photo.png",
      type: "image",
      mimeType: "image/png",
      url: "media-server://img_1",
      uploadedAt: "2026-01-01T00:00:00.000Z",
      usedIn: [],
    } as unknown as MediaIndexEntry;
    const normalized = normalizeMediaIndexEntry(entry);
    expect(normalized).toBe(entry);
    // 保存時に "" が書き戻されないよう、キー自体を作らない
    expect("thumbnailUrl" in normalized).toBe(false);
  });

  it("normalizeMediaIndex は書き換えが無ければ index ごと同一参照を返す", () => {
    const index = {
      version: CURRENT_MEDIA_INDEX_VERSION,
      updatedAt: "2026-01-01T00:00:00.000Z",
      media: [
        { fileId: "a", name: "a", type: "image", mimeType: "image/png", url: "u:a", uploadedAt: "2026-01-01T00:00:00.000Z", usedIn: [] },
        { fileId: "b", name: "b", type: "url", mimeType: "text/x-uri", url: "https://example.com/", thumbnailUrl: "https://example.com/favicon.ico", uploadedAt: "2026-01-01T00:00:00.000Z", usedIn: [], urlMeta: { domain: "example.com" } },
      ],
    } as unknown as MediaIndex;
    expect(normalizeMediaIndex(index)).toBe(index);
    // 2 回読んでも同じ参照（毎回作り直していないこと）
    expect(normalizeMediaIndex(index)).toBe(normalizeMediaIndex(index));
  });

  it("旧 favicon が混ざっている場合だけ index を作り直す", () => {
    const clean: MediaIndexEntry = {
      fileId: "a",
      name: "a",
      type: "image",
      mimeType: "image/png",
      url: "u:a",
      thumbnailUrl: "",
      uploadedAt: "2026-01-01T00:00:00.000Z",
      usedIn: [],
    };
    const index: MediaIndex = {
      version: CURRENT_MEDIA_INDEX_VERSION,
      updatedAt: "2026-01-01T00:00:00.000Z",
      media: [
        clean,
        {
          fileId: "b",
          name: "b",
          type: "url",
          mimeType: "text/x-uri",
          url: "https://internal.corp.example/doc",
          thumbnailUrl: LEGACY,
          uploadedAt: "2026-01-01T00:00:00.000Z",
          usedIn: [],
        },
      ],
    };
    const normalized = normalizeMediaIndex(index);
    expect(normalized).not.toBe(index);
    // 書き換え不要なエントリは参照ごと温存する
    expect(normalized.media[0]).toBe(clean);
    expect(normalized.media[1].thumbnailUrl).toBe("https://internal.corp.example/favicon.ico");
  });

  it("復元不能な旧 favicon は faviconUrl キーごと落とす", () => {
    const entry: MediaIndexEntry = {
      fileId: "url_3",
      name: "unknown",
      type: "url",
      mimeType: "text/x-uri",
      url: "https://example.com/",
      thumbnailUrl: "https://example.com/favicon.ico",
      uploadedAt: "2026-01-01T00:00:00.000Z",
      usedIn: [],
      urlMeta: { domain: "example.com", faviconUrl: legacyFavicon("sz=64") },
    };
    const normalized = normalizeMediaIndexEntry(entry);
    expect(normalized.urlMeta?.faviconUrl).toBeUndefined();
    expect("faviconUrl" in (normalized.urlMeta ?? {})).toBe(false);
    expect(normalized.urlMeta?.domain).toBe("example.com");
  });
});

describe("プレビュー画像（og:image をローカルに閉じ込める）", () => {
  const baseUrlEntry = (urlMeta: Record<string, unknown>): MediaIndexEntry => ({
    fileId: "url_1730000000000_abc123",
    name: "Example",
    type: "url",
    mimeType: "text/x-uri",
    url: "https://example.com/article",
    thumbnailUrl: "https://example.com/favicon.ico",
    uploadedAt: "2026-01-01T00:00:00.000Z",
    usedIn: [],
    urlMeta: urlMeta as MediaIndexEntry["urlMeta"],
  });

  it("参照は media-text 形式だけを受け付ける（remote URL は形の時点で通らない）", () => {
    expect(isLocalPreviewRef("media-text:preview_url_1730000000000_abc123")).toBe(true);
    // 描画に使われたら第三者へ GET が飛ぶ形は全部 false
    expect(isLocalPreviewRef("https://cdn.example.net/og.png")).toBe(false);
    expect(isLocalPreviewRef("http://tracker.example/px.png?v=1")).toBe(false);
    expect(isLocalPreviewRef("//cdn.example.net/og.png")).toBe(false);
    expect(isLocalPreviewRef("data:image/png;base64,iVBORw0KGgo=")).toBe(false);
    expect(isLocalPreviewRef("media-text:../../etc/passwd")).toBe(false);
    expect(isLocalPreviewRef("media-text:")).toBe(false);
    expect(isLocalPreviewRef(undefined)).toBe(false);
    expect(isLocalPreviewRef("")).toBe(false);
  });

  it("キーは fileId から導出し、パス区切りを含む fileId は拒否する", () => {
    // 保存先はデスクトップが <media_dir>/<key>.txt、sidecar が media-text/<key>.txt。
    // Rust 側はサニタイズしないので、キーの形をここで担保する。
    expect(previewImageKey("url_1730000000000_abc123")).toBe(
      "preview_url_1730000000000_abc123",
    );
    expect(previewImageRef("url_1730000000000_abc123")).toBe(
      "media-text:preview_url_1730000000000_abc123",
    );
    for (const bad of ["../evil", "a/b", "a\\b", "url:https://x", "a\0b", ""]) {
      expect(previewImageKey(bad)).toBeNull();
      expect(previewImageRef(bad)).toBeNull();
    }
    // sidecar の safeId（先頭ドット拒否）と Windows のファイル名（":" 不可）を満たす
    const key = previewImageKey("url_1_a")!;
    expect(key.startsWith(".")).toBe(false);
    expect(key).not.toContain(":");
    expect(previewRefKey(`media-text:${key}`)).toBe(key);
  });

  it("保存済みの remote な previewImage は読み込み時に落とす（再保存を要求しない）", () => {
    // 手編集・共有経由・旧バージョンから remote URL が紛れ込んでも、描画側には渡らない
    const entry = baseUrlEntry({
      domain: "example.com",
      previewImage: "https://cdn.example.net/og.png",
      ogImage: "https://cdn.example.net/og.png",
      leadImage: "https://tracker.example/px.png?v=visitor",
    });
    const normalized = normalizeMediaIndexEntry(entry);
    expect(normalized).not.toBe(entry);
    expect(normalized.urlMeta?.previewImage).toBeUndefined();
    expect("previewImage" in (normalized.urlMeta ?? {})).toBe(false);
    // ogImage / leadImage は来歴として残す（描画に使う経路がもう無いので害が無い）
    expect(normalized.urlMeta?.ogImage).toBe("https://cdn.example.net/og.png");
    expect(normalized.urlMeta?.leadImage).toBe("https://tracker.example/px.png?v=visitor");
    expect(normalized.urlMeta?.domain).toBe("example.com");
  });

  it("ローカル参照はそのまま残し、エントリの参照も作り直さない", () => {
    const entry = baseUrlEntry({
      domain: "example.com",
      previewImage: "media-text:preview_url_1730000000000_abc123",
      previewImageAt: "2026-07-01T00:00:00.000Z",
      ogImage: "https://cdn.example.net/og.png",
    });
    expect(normalizeMediaIndexEntry(entry)).toBe(entry);
  });

  it("ogImage だけを持つ既存エントリは同一参照のまま（不要な再生成をしない）", () => {
    const entry = baseUrlEntry({ domain: "example.com", ogImage: "https://cdn.example.net/og.png" });
    expect(normalizeMediaIndexEntry(entry)).toBe(entry);
  });

  it("normalizeMediaIndex は remote な previewImage を含むときだけ作り直す", () => {
    const clean = baseUrlEntry({ domain: "example.com", ogImage: "https://cdn.example.net/og.png" });
    const dirty = {
      ...baseUrlEntry({ domain: "evil.example", previewImage: "https://tracker.example/px.png" }),
      fileId: "url_2",
    };
    const index: MediaIndex = {
      version: CURRENT_MEDIA_INDEX_VERSION,
      updatedAt: "2026-01-01T00:00:00.000Z",
      media: [clean, dirty],
    };
    const normalized = normalizeMediaIndex(index);
    expect(normalized).not.toBe(index);
    expect(normalized.media[0]).toBe(clean);
    expect(normalized.media[1].urlMeta?.previewImage).toBeUndefined();
  });

  it("第三者 favicon と remote previewImage が同居していても両方潰す", () => {
    const entry = baseUrlEntry({
      domain: "internal.corp.example",
      faviconUrl: `${"https://www.google.com"}/${["s2", "favicons"].join("/")}?domain=internal.corp.example`,
      previewImage: "https://tracker.example/px.png",
    });
    entry.url = "https://internal.corp.example/doc";
    const normalized = normalizeMediaIndexEntry(entry);
    expect(normalized.urlMeta?.faviconUrl).toBe("https://internal.corp.example/favicon.ico");
    expect(normalized.urlMeta?.previewImage).toBeUndefined();
  });
});

describe("persistUrlMetaPatch（previewImage の後追い書き戻し）", () => {
  const provider = {
    readAppData: vi.fn(),
    writeAppData: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (getActiveProvider as any).mockReturnValue(provider);
  });

  const indexWith = (urlMeta: Record<string, unknown>): MediaIndex => ({
    version: CURRENT_MEDIA_INDEX_VERSION,
    updatedAt: "2026-01-01T00:00:00.000Z",
    media: [
      {
        fileId: "url_1",
        name: "Example",
        type: "url",
        mimeType: "text/x-uri",
        url: "https://example.com/article",
        thumbnailUrl: "",
        uploadedAt: "2026-01-01T00:00:00.000Z",
        usedIn: [],
        urlMeta: urlMeta as MediaIndexEntry["urlMeta"],
      },
    ],
  });

  it("previewImage / previewImageAt を書き戻して true を返す", async () => {
    provider.readAppData.mockResolvedValue(indexWith({ domain: "example.com" }));
    const applied = await persistUrlMetaPatch("url_1", {
      previewImage: "media-text:preview_url_1",
      previewImageAt: "2026-07-29T00:00:00.000Z",
    });
    expect(applied).toBe(true);
    const saved = provider.writeAppData.mock.calls[0][1] as MediaIndex;
    expect(saved.media[0].urlMeta?.previewImage).toBe("media-text:preview_url_1");
    expect(saved.media[0].urlMeta?.previewImageAt).toBe("2026-07-29T00:00:00.000Z");
  });

  it("失敗の記録（previewImageAt だけ）も書ける", async () => {
    provider.readAppData.mockResolvedValue(indexWith({ domain: "example.com" }));
    const applied = await persistUrlMetaPatch("url_1", {
      previewImageAt: "2026-07-29T00:00:00.000Z",
    });
    expect(applied).toBe(true);
    const saved = provider.writeAppData.mock.calls[0][1] as MediaIndex;
    expect(saved.media[0].urlMeta?.previewImageAt).toBe("2026-07-29T00:00:00.000Z");
    expect(saved.media[0].urlMeta?.previewImage).toBeUndefined();
  });

  it("値が同じなら書き込まず false を返す", async () => {
    provider.readAppData.mockResolvedValue(
      indexWith({
        domain: "example.com",
        previewImage: "media-text:preview_url_1",
        previewImageAt: "2026-07-29T00:00:00.000Z",
      }),
    );
    const applied = await persistUrlMetaPatch("url_1", {
      previewImage: "media-text:preview_url_1",
      previewImageAt: "2026-07-29T00:00:00.000Z",
    });
    expect(applied).toBe(false);
    expect(provider.writeAppData).not.toHaveBeenCalled();
  });

  it("エントリが index に無ければ false（登録直後のレースを呼び出し側が検出できる）", async () => {
    provider.readAppData.mockResolvedValue(indexWith({ domain: "example.com" }));
    const applied = await persistUrlMetaPatch("url_missing", {
      previewImageAt: "2026-07-29T00:00:00.000Z",
    });
    expect(applied).toBe(false);
    expect(provider.writeAppData).not.toHaveBeenCalled();
  });
});
