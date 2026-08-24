import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadUrlText, __clearUrlTextCacheForTest } from "./url-text-loader";

// Reader（fetchReaderArticle）と PDF テキスト抽出（extractPdfText）をモックし、
// loadUrlText の経路分岐（通常記事 / PDF URL / 失敗）だけを検証する。
const fetchReaderArticle = vi.fn();
vi.mock("../pdf-translate/translate-service", () => ({
  fetchReaderArticle: (url: string) => fetchReaderArticle(url),
}));

const extractPdfText = vi.fn();
vi.mock("../wiki/pdf-text-extractor", () => ({
  extractPdfText: (blob: Blob) => extractPdfText(blob),
}));

vi.mock("../../lib/platform", () => ({
  apiBase: () => "/api",
}));

function makeArticle(partial: Record<string, unknown>) {
  return {
    title: "t",
    textContent: "",
    lang: null,
    leadImage: null,
    fetchedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  __clearUrlTextCacheForTest();
  fetchReaderArticle.mockReset();
  extractPdfText.mockReset();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("loadUrlText", () => {
  it("通常ページは Reader 本文をそのまま返す", async () => {
    fetchReaderArticle.mockResolvedValue(makeArticle({ textContent: "  本文です  " }));
    expect(await loadUrlText("https://example.com/a")).toBe("本文です");
  });

  it("PDF URL（kind:'pdf'）は pdf-proxy 経由で取得してテキスト抽出する", async () => {
    fetchReaderArticle.mockResolvedValue(makeArticle({ kind: "pdf" }));
    const blob = new Blob(["%PDF"]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    extractPdfText.mockResolvedValue({ text: "PDF 本文" });

    expect(await loadUrlText("https://arxiv.org/pdf/1234.5678")).toBe("PDF 本文");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/url/pdf-proxy?url=" + encodeURIComponent("https://arxiv.org/pdf/1234.5678"),
    );
    expect(extractPdfText).toHaveBeenCalledWith(blob);
  });

  it("pdf-proxy が失敗（非 2xx）したら undefined", async () => {
    fetchReaderArticle.mockResolvedValue(makeArticle({ kind: "pdf" }));
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;
    expect(await loadUrlText("https://example.com/b.pdf")).toBeUndefined();
  });

  it("PDF 抽出結果が空なら undefined（空文字をキャッシュしない）", async () => {
    fetchReaderArticle.mockResolvedValue(makeArticle({ kind: "pdf" }));
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, blob: async () => new Blob([""]) }) as unknown as typeof fetch;
    extractPdfText.mockResolvedValue({ text: "   " });
    expect(await loadUrlText("https://example.com/c.pdf")).toBeUndefined();
  });

  it("Reader が throw（オフライン・bot 保護）したら undefined", async () => {
    fetchReaderArticle.mockRejectedValue(new Error("Fetch failed: 403"));
    expect(await loadUrlText("https://example.com/d")).toBeUndefined();
  });

  it("成功した本文はセッションキャッシュされ、2 回目は Reader を叩かない", async () => {
    fetchReaderArticle.mockResolvedValue(makeArticle({ textContent: "cached" }));
    expect(await loadUrlText("https://example.com/e")).toBe("cached");
    expect(await loadUrlText("https://example.com/e")).toBe("cached");
    expect(fetchReaderArticle).toHaveBeenCalledTimes(1);
  });
});
