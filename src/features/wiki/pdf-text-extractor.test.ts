// extractPdfText の pageStarts（ページ開始オフセット）計算のテスト。
// pdfjs は node 環境では動かない（canvas/worker 前提）ため、react-pdf の pdfjs をモックする
// （先例: src/blocks/registry.test.ts）。

import { describe, expect, it, vi } from "vitest";

type FakePage = { text: string };

function makeFakeDoc(pages: FakePage[], title?: string) {
  return {
    numPages: pages.length,
    getPage: async (i: number) => ({
      getTextContent: async () => ({
        items: pages[i - 1].text ? [{ str: pages[i - 1].text }] : [],
      }),
    }),
    getMetadata: async () => ({ info: { Title: title ?? "" } }),
  };
}

let mockDoc: ReturnType<typeof makeFakeDoc>;

vi.mock("react-pdf", () => ({
  pdfjs: {
    GlobalWorkerOptions: {},
    getDocument: () => ({ promise: Promise.resolve(mockDoc) }),
  },
}));
vi.mock("../../lib/pdfjs-config", () => ({ PDFJS_DOC_OPTIONS: {} }));

import { extractPdfText } from "./pdf-text-extractor";

function setPages(pages: FakePage[], title?: string) {
  mockDoc = makeFakeDoc(pages, title);
}

describe("extractPdfText - pageStarts", () => {
  it("各ページの pageStarts が text 上の実際のページ開始位置と一致する", async () => {
    setPages([{ text: "1ページ目の内容。" }, { text: "2ページ目の内容。" }, { text: "3ページ目の内容。" }]);
    const result = await extractPdfText(new Blob());
    expect(result.pageCount).toBe(3);
    expect(result.pageStarts).toHaveLength(3);
    expect(result.text.slice(result.pageStarts![0])).toMatch(/^1ページ目の内容。/);
    expect(result.text.slice(result.pageStarts![1])).toMatch(/^2ページ目の内容。/);
    expect(result.text.slice(result.pageStarts![2])).toMatch(/^3ページ目の内容。/);
    // 既存の text 出力（ページを "\n\n" で連結）が変わっていないこと
    expect(result.text).toBe("1ページ目の内容。\n\n2ページ目の内容。\n\n3ページ目の内容。");
  });

  it("空ページ（画像だけ等）も境界として数える", async () => {
    setPages([{ text: "本文1。" }, { text: "" }, { text: "本文3。" }]);
    const result = await extractPdfText(new Blob());
    expect(result.pageStarts).toHaveLength(3);
    // text は変わらず "\n\n" 連結のまま（空ページは空文字列として連結される）
    expect(result.text).toBe("本文1。\n\n\n\n本文3。");
    expect(result.text.slice(result.pageStarts![2])).toMatch(/^本文3。/);
  });

  it("先頭ページが空で全体が trim される場合、pageStarts も trim 分だけ補正される", async () => {
    setPages([{ text: "" }, { text: "本文開始。" }]);
    const result = await extractPdfText(new Blob());
    // 先頭の "\n\n"（空ページ由来）が trim で消える
    expect(result.text).toBe("本文開始。");
    expect(result.pageStarts![0]).toBe(0);
    expect(result.pageStarts![1]).toBe(0);
    expect(result.text.slice(result.pageStarts![1])).toMatch(/^本文開始。/);
  });

  it("80,000 字打ち切りで、本文からはみ出たページの pageStarts は含まれず、注記が付く", async () => {
    const bigPage = "実測データが多数含まれる本文の一部。".repeat(5000); // 十分長い1ページ
    setPages([{ text: bigPage }, { text: "次のページの内容。" }]);
    const result = await extractPdfText(new Blob());
    expect(result.pageCount).toBe(2);
    expect(result.text.length).toBeGreaterThan(80_000); // 注記込みで 80,000 を超える
    expect(result.text).toMatch(/\[\.\.\. truncated: read \d+ of 2 pages\]$/);
    // 1 ページ目しか本文に残っていない（2 ページ目は打ち切りで消えている）
    expect(result.pageStarts).toHaveLength(1);
    expect(result.pageStarts![0]).toBe(0);
  });

  it("既存の text 出力（タイトル・pageCount 含む）が変わっていないこと", async () => {
    setPages([{ text: "本文。" }], "テストPDF");
    const result = await extractPdfText(new Blob());
    expect(result).toMatchObject({ title: "テストPDF", text: "本文。", pageCount: 1 });
  });
});
