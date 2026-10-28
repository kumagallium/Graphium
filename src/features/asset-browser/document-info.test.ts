// @vitest-environment jsdom
// ドキュメントのページ数・タイトルの取り出しと、ページ数の後追い付与

import { describe, it, expect, vi, beforeEach } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  isUsableTitle,
  normalizeTitleText,
  pickTitleFromPdfItems,
  titleToName,
  isSameName,
  canCountPages,
  countDocumentPages,
  extractDocumentTitle,
  backfillDocumentInfo,
  hasPageCountFailed,
} from "./document-info";
import {
  clearMediaIndexCache,
  readMediaIndex,
  CURRENT_MEDIA_INDEX_VERSION,
  type MediaIndex,
  type MediaIndexEntry,
} from "./media-index";
import { getActiveProvider } from "../../lib/storage/registry";

const pdfMock = vi.hoisted(() => ({ getDocument: vi.fn() }));

vi.mock("react-pdf", () => ({
  pdfjs: { GlobalWorkerOptions: {}, getDocument: pdfMock.getDocument },
}));
vi.mock("../../lib/storage/registry", () => ({
  getActiveProvider: vi.fn(),
}));

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const docxEntry = { type: "document" as const, mimeType: DOCX };
const pptxEntry = { type: "document" as const, mimeType: PPTX };
const pdfEntry = { type: "pdf" as const, mimeType: "application/pdf" };

const zip = (files: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const coreXml = (title: string) =>
  `<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title></cp:coreProperties>`;
const para = (style: string | null, text: string) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t>${text}</w:t></w:r></w:p>`;
const docXml = (...paras: string[]) =>
  `<?xml version="1.0"?><w:document ${W}><w:body>${paras.join("")}</w:body></w:document>`;

describe("isUsableTitle", () => {
  it.each([
    ["材料科学における電子ノートの活用", true],
    ["A Study of Thermoelectric Materials", true],
    ["", false],
    ["   ", false],
    ["report.pdf", false],
    ["draft_v2.DOCX", false],
    ["slides.pptx", false],
    ["paper.tex", false],
    ["Microsoft Word - 議事録", false],
    ["Microsoft PowerPoint - deck", false],
    ["untitled", false],
    ["Untitled 1", false],
    ["無題", false],
    ["Title", false],
    ["Document", false],
    ["PowerPoint Presentation", false],
    ["ab", false],
    ["論文", false],
    ["12345", false],
    ["--- 2026 ---", false],
    // 組版システムが入れた原稿 ID（JACS Au の PDF の Title）
    ["au5c01087 1..12", false],
    ["acs.jpcc.4b01234", false],
    ["2026年度 研究報告", true],
    ["CO2 Reduction on Cu", true],
  ])("%j -> %s", (raw, expected) => {
    expect(isUsableTitle(raw)).toBe(expected);
  });

  it("null / undefined は使えない", () => {
    expect(isUsableTitle(null)).toBe(false);
    expect(isUsableTitle(undefined)).toBe(false);
  });
});

describe("normalizeTitleText", () => {
  it("前後空白・連続空白・改行を 1 つの空白にする", () => {
    expect(normalizeTitleText("  A \n\n  B\tC  ")).toBe("A B C");
  });
});

describe("pickTitleFromPdfItems", () => {
  it("いちばん文字の大きい行を題にする", () => {
    const items = [
      { str: "Journal of Things", height: 9, y: 800 },
      { str: "A Great Title", height: 24, y: 700 },
      { str: "Author Name", height: 12, y: 660 },
    ];
    expect(pickTitleFromPdfItems(items)).toBe("A Great Title");
  });

  it("同じ高さ・同じ y の連続 item は 1 行に連結する", () => {
    const items = [
      { str: "Deep ", height: 20, y: 700 },
      { str: "Learning", height: 20, y: 700 },
      { str: "body text", height: 10, y: 600 },
    ];
    expect(pickTitleFromPdfItems(items)).toBe("Deep Learning");
  });

  it("折り返したタイトルは上から続く行を空白で連結する", () => {
    const items = [
      { str: "A Very Long Title That", height: 22, y: 700 },
      { str: "Wraps Onto Two Lines", height: 22, y: 674 },
      { str: "abstract", height: 10, y: 600 },
    ];
    expect(pickTitleFromPdfItems(items)).toBe("A Very Long Title That Wraps Onto Two Lines");
  });

  it("離れた同じ高さの行（別の見出し）は連結しない", () => {
    const items = [
      { str: "Main Title", height: 22, y: 700 },
      { str: "Section Heading", height: 22, y: 300 },
    ];
    expect(pickTitleFromPdfItems(items)).toBe("Main Title");
  });

  it("使えない値（数字だけなど）なら undefined", () => {
    expect(pickTitleFromPdfItems([{ str: "2026", height: 20, y: 700 }])).toBeUndefined();
    expect(pickTitleFromPdfItems([])).toBeUndefined();
  });

  it("200 文字で切る", () => {
    const long = "あ".repeat(300);
    const t = pickTitleFromPdfItems([{ str: long, height: 20, y: 700 }]);
    expect(Array.from(t ?? "").length).toBe(200);
  });
});

describe("titleToName / isSameName", () => {
  it("元の拡張子を付け足す", () => {
    expect(titleToName("電子ノート入門", "scan0001.pdf")).toBe("電子ノート入門.pdf");
    expect(titleToName("Plan", "a.DOCX")).toBe("Plan.DOCX");
  });
  it("元の名前に拡張子が無ければ付けない", () => {
    expect(titleToName("電子ノート入門", "scan0001")).toBe("電子ノート入門");
  });
  it("タイトルが既に拡張子で終わっていれば重ねない", () => {
    expect(titleToName("Plan.pdf", "a.pdf")).toBe("Plan.pdf");
  });
  it("空白を整える", () => {
    expect(titleToName(" A \n B ", "x.pdf")).toBe("A B.pdf");
  });
  it("同じ名前は変更なし扱い", () => {
    expect(isSameName("A B.pdf", " A  B.pdf ")).toBe(true);
    expect(isSameName("A.pdf", "B.pdf")).toBe(false);
  });
});

describe("canCountPages", () => {
  it("PDF・docx・pptx だけ", () => {
    expect(canCountPages(pdfEntry)).toBe(true);
    expect(canCountPages(docxEntry)).toBe(true);
    expect(canCountPages(pptxEntry)).toBe(true);
    expect(canCountPages({ type: "document", mimeType: "application/msword" })).toBe(false);
    expect(
      canCountPages({
        type: "document",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    ).toBe(false);
    expect(canCountPages({ type: "image", mimeType: "image/png" })).toBe(false);
  });
});

describe("docx", () => {
  it("app.xml の Pages を読む", async () => {
    const bytes = zip({ "docProps/app.xml": "<Properties><Pages>12</Pages></Properties>" });
    expect(await countDocumentPages(bytes, docxEntry)).toBe(12);
  });
  it("Pages が無ければ undefined", async () => {
    expect(await countDocumentPages(zip({ "docProps/app.xml": "<Properties/>" }), docxEntry)).toBeUndefined();
    expect(await countDocumentPages(zip({ "word/document.xml": "x" }), docxEntry)).toBeUndefined();
  });
  it("壊れた zip でも落ちない", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await countDocumentPages(new Uint8Array([1, 2, 3]), docxEntry)).toBeUndefined();
  });

  it("core.xml の dc:title を使う（文字参照は復号）", async () => {
    const bytes = zip({ "docProps/core.xml": coreXml("Tom &amp; Jerry の研究") });
    expect(await extractDocumentTitle(bytes, docxEntry)).toBe("Tom & Jerry の研究");
  });

  it("メタデータが使えない値なら Title スタイルの段落", async () => {
    const bytes = zip({
      "docProps/core.xml": coreXml("Microsoft Word - foo"),
      "word/document.xml": docXml(para(null, "前置き"), para("Title", "本当の  題名"), para("Heading1", "見出し")),
    });
    expect(await extractDocumentTitle(bytes, docxEntry)).toBe("本当の 題名");
  });

  it("styleId が \"1\" の見出し 1 を styles.xml の名前から引く", async () => {
    const styles = `<w:styles ${W}><w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/></w:style></w:styles>`;
    const bytes = zip({
      "word/styles.xml": styles,
      "word/document.xml": docXml(para(null, "前置き"), para("1", "第1章 はじめに")),
    });
    expect(await extractDocumentTitle(bytes, docxEntry)).toBe("第1章 はじめに");
  });

  it("該当スタイルが無ければ最初の段落を採らず undefined", async () => {
    const bytes = zip({ "word/document.xml": docXml(para(null, "ただの最初の段落です")) });
    expect(await extractDocumentTitle(bytes, docxEntry)).toBeUndefined();
  });
});

describe("pptx", () => {
  const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const slide = (phType: string, text: string) =>
    `<p:sld ${A}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="${phType}"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  const presentation = `<p:presentation ${A}><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/></p:sldIdLst></p:presentation>`;
  const rels = `<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/></Relationships>`;

  it("スライド枚数を数える", async () => {
    const bytes = zip({
      "ppt/slides/slide1.xml": slide("title", "a"),
      "ppt/slides/slide2.xml": slide("title", "b"),
      "ppt/slides/slide3.xml": slide("title", "c"),
      "ppt/slides/_rels/slide1.xml.rels": "<x/>",
    });
    expect(await countDocumentPages(bytes, pptxEntry)).toBe(3);
  });

  it("presentation の並び順で 1 枚目のタイトルを取る", async () => {
    const bytes = zip({
      "ppt/presentation.xml": presentation,
      "ppt/_rels/presentation.xml.rels": rels,
      // 並び順の 1 枚目は slide2.xml
      "ppt/slides/slide1.xml": slide("title", "二枚目の題"),
      "ppt/slides/slide2.xml": slide("ctrTitle", "表紙の題名"),
    });
    expect(await extractDocumentTitle(bytes, pptxEntry)).toBe("表紙の題名");
  });

  it("core.xml が使えればそれを優先", async () => {
    const bytes = zip({
      "docProps/core.xml": coreXml("発表資料のタイトル"),
      "ppt/slides/slide1.xml": slide("title", "別の題"),
    });
    expect(await extractDocumentTitle(bytes, pptxEntry)).toBe("発表資料のタイトル");
  });

  it("タイトルのプレースホルダが無ければ undefined", async () => {
    const bytes = zip({ "ppt/slides/slide1.xml": slide("body", "本文だけのスライド") });
    expect(await extractDocumentTitle(bytes, pptxEntry)).toBeUndefined();
  });
});

describe("PDF（pdfjs をモック）", () => {
  function mockPdf(opts: { numPages: number; title?: string; items?: unknown[] }) {
    const destroy = vi.fn();
    pdfMock.getDocument.mockReturnValue({
      destroy,
      promise: Promise.resolve({
        numPages: opts.numPages,
        getMetadata: async () => ({ info: { Title: opts.title } }),
        getPage: async () => ({ getTextContent: async () => ({ items: opts.items ?? [] }) }),
      }),
    });
    return destroy;
  }

  it("numPages を返し、終わったら destroy する", async () => {
    const destroy = mockPdf({ numPages: 7 });
    expect(await countDocumentPages(new Uint8Array([1]), pdfEntry)).toBe(7);
    expect(destroy).toHaveBeenCalled();
  });

  it("メタデータの Title が使えればそれ", async () => {
    mockPdf({ numPages: 1, title: "  ちゃんとした題名  " });
    expect(await extractDocumentTitle(new Uint8Array([1]), pdfEntry)).toBe("ちゃんとした題名");
  });

  it("Title が使えなければ 1 ページ目の最大の文字", async () => {
    mockPdf({
      numPages: 3,
      title: "Microsoft Word - x.docx",
      items: [
        { str: "small", transform: [10, 0, 0, 10, 0, 500] },
        { str: "Big Title", transform: [24, 0, 0, 24, 0, 700] },
      ],
    });
    expect(await extractDocumentTitle(new Uint8Array([1]), pdfEntry)).toBe("Big Title");
  });

  it("Title が原稿 ID なら 1 ページ目の折り返した題（学術誌の PDF）", async () => {
    mockPdf({
      numPages: 12,
      title: "au5c01087 1..12",
      items: [
        { str: "Accelerating Catalysis Understanding via Large Language Model", transform: [17, 0, 0, 17, 0, 677] },
        { str: "Data Extraction and Shallow Machine Learning Techniques", transform: [17, 0, 0, 17, 0, 658.9] },
        { str: "Brianna R. Farris and Kevin C. Leonard", transform: [13, 0, 0, 13, 0, 638.9] },
      ],
    });
    expect(await extractDocumentTitle(new Uint8Array([1]), pdfEntry)).toBe(
      "Accelerating Catalysis Understanding via Large Language Model Data Extraction and Shallow Machine Learning Techniques",
    );
  });
});

describe("backfillDocumentInfo（ページ数）", () => {
  beforeEach(() => {
    clearMediaIndexCache();
    vi.clearAllMocks();
  });

  function entry(over: Partial<MediaIndexEntry> & { fileId: string }): MediaIndexEntry {
    return {
      name: `${over.fileId}.docx`,
      type: "document",
      mimeType: DOCX,
      url: `local-media://${over.fileId}`,
      thumbnailUrl: "",
      uploadedAt: "2026-08-01T00:00:00.000Z",
      usedIn: [],
      ...over,
    };
  }
  const index = (media: MediaIndexEntry[]): MediaIndex => ({
    version: CURRENT_MEDIA_INDEX_VERSION,
    updatedAt: "2026-08-01T00:00:00.000Z",
    media,
  });
  function mockProvider(initial: MediaIndex | null) {
    const store = { value: initial };
    vi.mocked(getActiveProvider).mockReturnValue({
      readAppData: vi.fn(async () => store.value),
      writeAppData: vi.fn(async (_k: string, data: unknown) => {
        store.value = data as MediaIndex;
      }),
    } as never);
    return store;
  }
  const docxWith = (pages: number) =>
    zip({ "docProps/app.xml": `<Properties><Pages>${pages}</Pages></Properties>` });
  type ReadBytes = (fileId: string, maxBytes: number) => Promise<Uint8Array | undefined>;
  const backfillPageCounts = async (read: ReadBytes, signal?: { aborted: boolean }) =>
    (await backfillDocumentInfo(read, signal, { concurrency: 1, flushEvery: 1 })).pageCounts;

  it("ページ数を持たないドキュメントにだけ付ける", async () => {
    const store = mockProvider(
      index([entry({ fileId: "a" }), entry({ fileId: "b", pageCount: 3 })]),
    );
    await readMediaIndex();
    const read = vi.fn(async () => docxWith(9));
    expect(await backfillPageCounts(read)).toBe(1);
    expect(store.value!.media.find((m) => m.fileId === "a")!.pageCount).toBe(9);
    expect(store.value!.media.find((m) => m.fileId === "b")!.pageCount).toBe(3);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("数えない種類（Excel・旧形式・画像・URL）は読みにも行かない", async () => {
    mockProvider(
      index([
        entry({ fileId: "x", mimeType: "application/vnd.ms-excel" }),
        entry({ fileId: "o", mimeType: "application/msword" }),
        entry({ fileId: "i", type: "image", mimeType: "image/png" }),
        entry({ fileId: "u", type: "url", mimeType: "text/html" }),
      ]),
    );
    await readMediaIndex();
    const read = vi.fn(async () => docxWith(1));
    expect(await backfillPageCounts(read)).toBe(0);
    expect(read).not.toHaveBeenCalled();
  });

  it("読めない・数えられない素材は飛ばして先へ進む", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = mockProvider(
      index([entry({ fileId: "gone" }), entry({ fileId: "big" }), entry({ fileId: "broken" }), entry({ fileId: "ok" })]),
    );
    await readMediaIndex();
    const filled = await backfillPageCounts(async (id: string) => {
      if (id === "gone") throw new Error("消えている");
      if (id === "big") return undefined;
      if (id === "broken") return new Uint8Array([1, 2, 3]);
      return docxWith(4);
    });
    expect(filled).toBe(1);
    expect(store.value!.media.find((m) => m.fileId === "ok")!.pageCount).toBe(4);
    expect(store.value!.media.find((m) => m.fileId === "broken")!.pageCount).toBeUndefined();
  });

  it("走査中に消えた素材は復活させない", async () => {
    const store = mockProvider(index([entry({ fileId: "a" }), entry({ fileId: "b" })]));
    await readMediaIndex();
    const { saveMediaIndex } = await import("./media-index");
    const filled = await backfillPageCounts(async (id: string) => {
      if (id === "a") await saveMediaIndex(index([entry({ fileId: "a" })]));
      return docxWith(2);
    });
    expect(filled).toBe(1);
    expect(store.value!.media.map((m) => m.fileId)).toEqual(["a"]);
  });

  it("中断されたらそこで止める", async () => {
    mockProvider(index([entry({ fileId: "a" }), entry({ fileId: "b" })]));
    await readMediaIndex();
    const signal = { aborted: false };
    const read = vi.fn(async () => {
      signal.aborted = true;
      return docxWith(1);
    });
    await backfillPageCounts(read, signal);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("インデックスが無ければ何もしない", async () => {
    mockProvider(null);
    const read = vi.fn(async () => docxWith(1));
    expect(await backfillPageCounts(read)).toBe(0);
    expect(read).not.toHaveBeenCalled();
  });

  it("1 件付けるごとに一覧へ通知する（全件の後にまとめてではなく）", async () => {
    mockProvider(index([entry({ fileId: "a" }), entry({ fileId: "b" })]));
    await readMediaIndex();
    const reasons: string[] = [];
    const onChanged = (e: Event) => reasons.push((e as CustomEvent).detail.reason);
    window.addEventListener("graphium:media-index-changed", onChanged);
    try {
      expect(await backfillPageCounts(async () => docxWith(2))).toBe(2);
    } finally {
      window.removeEventListener("graphium:media-index-changed", onChanged);
    }
    expect(reasons).toEqual(["page-count-backfill", "page-count-backfill"]);
  });

  it("読めなかった素材は覚えておき、最後に 1 回だけ通知する", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockProvider(index([entry({ fileId: "broken-x" }), entry({ fileId: "fine-x" })]));
    await readMediaIndex();
    const reasons: string[] = [];
    const onChanged = (e: Event) => reasons.push((e as CustomEvent).detail.reason);
    window.addEventListener("graphium:media-index-changed", onChanged);
    try {
      await backfillPageCounts(async (id: string) => (id === "broken-x" ? new Uint8Array([1]) : docxWith(3)));
    } finally {
      window.removeEventListener("graphium:media-index-changed", onChanged);
    }
    expect(hasPageCountFailed("broken-x")).toBe(true);
    expect(hasPageCountFailed("fine-x")).toBe(false);
    expect(reasons).toEqual(["page-count-backfill", "page-count-backfill-done"]);
  });
});

describe("backfillDocumentInfo（PDF のページ数と出どころをまとめて）", () => {
  beforeEach(() => {
    clearMediaIndexCache();
    vi.clearAllMocks();
  });

  function pdf(over: Partial<MediaIndexEntry> & { fileId: string }): MediaIndexEntry {
    return {
      name: `${over.fileId}.pdf`,
      type: "pdf",
      mimeType: "application/pdf",
      url: `local-media://${over.fileId}`,
      thumbnailUrl: "",
      uploadedAt: "2026-08-01T00:00:00.000Z",
      usedIn: [],
      ...over,
    };
  }
  const index = (media: MediaIndexEntry[]): MediaIndex => ({
    version: CURRENT_MEDIA_INDEX_VERSION,
    updatedAt: "2026-08-01T00:00:00.000Z",
    media,
  });
  function mockProvider(initial: MediaIndex) {
    const store = { value: initial, writes: 0 };
    vi.mocked(getActiveProvider).mockReturnValue({
      readAppData: vi.fn(async () => store.value),
      writeAppData: vi.fn(async (_k: string, data: unknown) => {
        store.value = data as MediaIndex;
        store.writes += 1;
      }),
    } as never);
    return store;
  }
  /** fileId ごとに中身を変えられる PDF のモック（bytes の 1 バイト目で見分ける） */
  function mockPdfs(byKey: Record<number, { numPages: number; author?: string; text?: string }>) {
    pdfMock.getDocument.mockImplementation(({ data }: { data: Uint8Array }) => {
      const p = byKey[data[0]];
      return {
        destroy: vi.fn(),
        promise: Promise.resolve({
          numPages: p.numPages,
          getMetadata: async () => ({ info: { Author: p.author } }),
          getPage: async () => ({
            getTextContent: async () => ({ items: p.text ? [{ str: p.text }] : [] }),
          }),
        }),
      };
    });
  }
  const find = (store: { value: MediaIndex }, id: string) => store.value.media.find((m) => m.fileId === id)!;

  it("PDF は 1 回だけ開いて、ページ数と著者・DOI を一緒に付ける", async () => {
    const store = mockProvider(index([pdf({ fileId: "a" })]));
    await readMediaIndex();
    mockPdfs({ 1: { numPages: 12, author: "Alice Smith; Bob Lee", text: "doi: 10.1021/jacs.5b01234" } });
    const result = await backfillDocumentInfo(async () => new Uint8Array([1]));
    expect(result).toEqual({ pageCounts: 1, sourceInfos: 1 });
    expect(pdfMock.getDocument).toHaveBeenCalledTimes(1);
    const a = find(store, "a");
    expect(a.pageCount).toBe(12);
    expect(a.sourceInfo).toEqual({ authors: ["Alice Smith", "Bob Lee"], doi: "10.1021/jacs.5b01234", origin: "file" });
    expect(a.sourceInfoScanned).toBe(true);
  });

  it("出どころが何も無い PDF にも読み終えた印を付け、次は読みに行かない", async () => {
    const store = mockProvider(index([pdf({ fileId: "a", pageCount: 3 })]));
    await readMediaIndex();
    mockPdfs({ 1: { numPages: 3 } });
    const read = vi.fn(async () => new Uint8Array([1]));
    expect(await backfillDocumentInfo(read)).toEqual({ pageCounts: 0, sourceInfos: 0 });
    expect(find(store, "a").sourceInfoScanned).toBe(true);
    expect(find(store, "a").sourceInfo).toBeUndefined();

    expect(await backfillDocumentInfo(read)).toEqual({ pageCounts: 0, sourceInfos: 0 });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("開けない PDF は出どころを読み終えた扱いにし、実体を読めなかったものは次回また試す", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = mockProvider(index([pdf({ fileId: "broken" }), pdf({ fileId: "gone" })]));
    await readMediaIndex();
    pdfMock.getDocument.mockImplementation(() => ({
      destroy: vi.fn(),
      promise: Promise.reject(new Error("Invalid PDF structure")),
    }));
    await backfillDocumentInfo(async (id) => {
      if (id === "gone") throw new Error("消えている");
      return new Uint8Array([1]);
    });
    expect(find(store, "broken").sourceInfoScanned).toBe(true);
    expect(find(store, "broken").pageCount).toBeUndefined();
    expect(find(store, "gone").sourceInfoScanned).toBeUndefined();
    expect(hasPageCountFailed("broken")).toBe(true);
  });

  it("ページ数も出どころも持つ PDF は読まない", async () => {
    mockProvider(
      index([pdf({ fileId: "a", pageCount: 3, sourceInfo: { doi: "10.1000/xyz123", origin: "file" } })]),
    );
    await readMediaIndex();
    const read = vi.fn(async () => new Uint8Array([1]));
    await backfillDocumentInfo(read);
    expect(read).not.toHaveBeenCalled();
  });

  it("走査中に人が入れた出どころは上書きしない（印だけ付ける）", async () => {
    const store = mockProvider(index([pdf({ fileId: "a" })]));
    await readMediaIndex();
    mockPdfs({ 1: { numPages: 2, author: "From File" } });
    const { persistSourceInfoPatch } = await import("./media-index");
    await backfillDocumentInfo(async () => {
      await persistSourceInfoPatch("a", { authors: ["Typed By Hand"], origin: "manual" });
      return new Uint8Array([1]);
    });
    const a = find(store, "a");
    expect(a.sourceInfo).toEqual({ authors: ["Typed By Hand"], origin: "manual" });
    expect(a.sourceInfoScanned).toBe(true);
    expect(a.pageCount).toBe(2);
  });

  it("保存はまとめて行う（件数ぶん書き直さない）", async () => {
    const store = mockProvider(index(Array.from({ length: 10 }, (_, i) => pdf({ fileId: `p${i}` }))));
    await readMediaIndex();
    mockPdfs({ 1: { numPages: 5 } });
    const reasons: string[] = [];
    const onChanged = (e: Event) => reasons.push((e as CustomEvent).detail.reason);
    window.addEventListener("graphium:media-index-changed", onChanged);
    try {
      const result = await backfillDocumentInfo(async () => new Uint8Array([1]), undefined, {
        flushEvery: 4,
        flushIntervalMs: 60_000,
      });
      expect(result.pageCounts).toBe(10);
    } finally {
      window.removeEventListener("graphium:media-index-changed", onChanged);
    }
    // 4 件・4 件・残り 2 件の 3 回
    expect(store.writes).toBe(3);
    expect(reasons).toEqual(["page-count-backfill", "page-count-backfill", "page-count-backfill"]);
    expect(store.value.media.every((m) => m.pageCount === 5 && m.sourceInfoScanned)).toBe(true);
  });

  it("並べて読んでも、全件の結果が残る", async () => {
    const store = mockProvider(index(Array.from({ length: 7 }, (_, i) => pdf({ fileId: `p${i}` }))));
    await readMediaIndex();
    mockPdfs({ 1: { numPages: 1 }, 2: { numPages: 2 } });
    await backfillDocumentInfo(
      async (id) => {
        // 読み終わる順をばらつかせる
        await new Promise((r) => setTimeout(r, Number(id.slice(1)) % 3));
        return new Uint8Array([Number(id.slice(1)) % 2 === 0 ? 1 : 2]);
      },
      undefined,
      { concurrency: 3, flushEvery: 2 },
    );
    expect(store.value.media.map((m) => m.pageCount)).toEqual([1, 2, 1, 2, 1, 2, 1]);
  });
});
