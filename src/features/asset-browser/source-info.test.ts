import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  normalizeDoi,
  findDoiInText,
  parseAuthorsField,
  extractPdfSourceInfo,
  fetchCrossrefSourceInfo,
  CrossrefNotFoundError,
  sourceInfoSearchText,
  matchesAllTokens,
  formatSourceLine,
  mergeSourceInfo,
} from "./source-info";

const pdfMock = vi.hoisted(() => ({ getDocument: vi.fn() }));

vi.mock("react-pdf", () => ({
  pdfjs: { GlobalWorkerOptions: {}, getDocument: pdfMock.getDocument },
}));

describe("normalizeDoi", () => {
  it.each([
    ["10.1021/jacsau.4c01234", "10.1021/jacsau.4c01234"],
    ["  https://doi.org/10.1021/ABC.def  ", "10.1021/ABC.def"],
    ["http://dx.doi.org/10.1000/xyz123", "10.1000/xyz123"],
    ["doi:10.1000/xyz123", "10.1000/xyz123"],
    ["DOI: 10.1000/xyz123.", "10.1000/xyz123"],
    ["(10.1000/xyz123)", undefined],
    ["10.1000/xyz123);", "10.1000/xyz123"],
    ["not a doi", undefined],
    ["10.12/short", undefined],
  ])("%j -> %j", (raw, expected) => {
    expect(normalizeDoi(raw)).toBe(expected);
  });
});

describe("findDoiInText", () => {
  it("doi.org リンクと裸の DOI を拾う", () => {
    expect(findDoiInText("See https://doi.org/10.1021/jacsau.4c01234 for details")).toBe("10.1021/jacsau.4c01234");
    expect(findDoiInText("Published. 10.1038/s41586-020-2649-2, Nature")).toBe("10.1038/s41586-020-2649-2");
  });
  it("最初の DOI を返す・無ければ undefined", () => {
    expect(findDoiInText("a doi:10.1000/aaa b 10.2000/bbb")).toBe("10.1000/aaa");
    expect(findDoiInText("no identifiers here")).toBeUndefined();
  });
});

describe("parseAuthorsField", () => {
  it("; と and で分割する", () => {
    expect(parseAuthorsField("Alice Smith; Bob Lee and Carol Wu")).toEqual(["Alice Smith", "Bob Lee", "Carol Wu"]);
  });
  it("無意味な値とファイル名は捨てる", () => {
    expect(parseAuthorsField("Unknown")).toEqual([]);
    expect(parseAuthorsField("Administrator")).toEqual([]);
    expect(parseAuthorsField("draft_v2.docx")).toEqual([]);
    expect(parseAuthorsField("")).toEqual([]);
  });
});

describe("extractPdfSourceInfo（pdfjs をモック）", () => {
  function mockPdf(opts: { info?: unknown; metadata?: unknown; text?: string }) {
    const destroy = vi.fn();
    pdfMock.getDocument.mockReturnValue({
      destroy,
      promise: Promise.resolve({
        numPages: 1,
        getMetadata: async () => ({ info: opts.info ?? {}, metadata: opts.metadata ?? null }),
        getPage: async () => ({
          getTextContent: async () => ({ items: opts.text ? [{ str: opts.text }] : [] }),
        }),
      }),
    });
    return destroy;
  }

  it("Custom の prism:doi と Author を読む", async () => {
    const destroy = mockPdf({
      info: { Author: "Alice Smith; Bob Lee", Custom: { "prism:doi": "10.1021/jacsau.4c01234" } },
    });
    expect(await extractPdfSourceInfo(new Uint8Array([1]))).toEqual({
      authors: ["Alice Smith", "Bob Lee"],
      doi: "10.1021/jacsau.4c01234",
      origin: "file",
    });
    expect(destroy).toHaveBeenCalled();
  });

  it("メタデータに無ければ 1 ページ目の doi.org リンクから", async () => {
    mockPdf({ text: "Article https://doi.org/10.1038/s41586-020-2649-2 Received" });
    expect(await extractPdfSourceInfo(new Uint8Array([1]))).toEqual({
      doi: "10.1038/s41586-020-2649-2",
      origin: "file",
    });
  });

  it("何も無ければ undefined", async () => {
    mockPdf({ info: { Author: "Unknown" }, text: "just text" });
    expect(await extractPdfSourceInfo(new Uint8Array([1]))).toBeUndefined();
  });
});

describe("fetchCrossrefSourceInfo", () => {
  const ok = (message: unknown) =>
    vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, status: 200, json: async () => ({ message }) }) as unknown as Response);

  it("著者・発行元・年・題名を読む", async () => {
    const f = ok({
      author: [{ given: "Alice", family: "Smith" }, { name: "Consortium X" }],
      "container-title": ["JACS Au"],
      publisher: "ACS",
      title: ["A study"],
      "published-online": { "date-parts": [[2025, 3]] },
      issued: { "date-parts": [[2024]] },
    });
    const r = await fetchCrossrefSourceInfo("10.1021/a/b", f as unknown as typeof fetch);
    expect(r.info).toEqual({
      authors: ["Alice Smith", "Consortium X"],
      venue: "JACS Au",
      year: 2025,
      doi: "10.1021/a/b",
      origin: "crossref",
    });
    expect(r.title).toBe("A study");
    expect(f.mock.calls[0][0]).toBe(`https://api.crossref.org/works/${encodeURIComponent("10.1021/a/b")}`);
  });

  it("container-title が無ければ publisher、年は issued に落ちる", async () => {
    const f = ok({ publisher: "Some Press", issued: { "date-parts": [[2020]] } });
    const r = await fetchCrossrefSourceInfo("10.1000/xyz123", f as unknown as typeof fetch);
    expect(r.info.venue).toBe("Some Press");
    expect(r.info.year).toBe(2020);
  });

  it("404 は CrossrefNotFoundError", async () => {
    const f = vi.fn(async () => ({ ok: false, status: 404 }) as unknown as Response);
    await expect(fetchCrossrefSourceInfo("10.1000/xyz123", f as unknown as typeof fetch)).rejects.toBeInstanceOf(
      CrossrefNotFoundError,
    );
  });

  it("その他の失敗は Error", async () => {
    const f = vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response);
    await expect(fetchCrossrefSourceInfo("10.1000/xyz123", f as unknown as typeof fetch)).rejects.toThrow(/500/);
  });

  describe("タイムアウト", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    it("10 秒応答が無ければ Error", async () => {
      const f = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_res, rej) => {
            init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
          }),
      );
      const p = fetchCrossrefSourceInfo("10.1000/xyz123", f as unknown as typeof fetch);
      const assertion = expect(p).rejects.toThrow(/タイムアウト/);
      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;
      vi.useRealTimers();
    });
  });
});

describe("検索・表示の純関数", () => {
  const info = { authors: ["Alice Farris", "Bob Lee"], year: 2025, venue: "JACS Au", doi: "10.1021/x/y" };

  it("sourceInfoSearchText", () => {
    expect(sourceInfoSearchText(info)).toBe("Alice Farris Bob Lee JACS Au 2025 10.1021/x/y");
    expect(sourceInfoSearchText(undefined)).toBe("");
  });

  it("matchesAllTokens", () => {
    expect(matchesAllTokens("Alice Farris 2025", "farris 2025")).toBe(true);
    expect(matchesAllTokens("Alice Farris 2025", "farris 2024")).toBe(false);
    expect(matchesAllTokens("anything", "  ")).toBe(true);
  });

  it("formatSourceLine", () => {
    expect(formatSourceLine(info, "et al.")).toBe("Farris et al. · 2025 · JACS Au");
    expect(formatSourceLine({ authors: ["Solo Author"], year: 2020 }, "et al.")).toBe("Author · 2020");
    expect(formatSourceLine({ doi: "10.1/x" }, "et al.")).toBeUndefined();
    expect(formatSourceLine(undefined, "et al.")).toBeUndefined();
  });

  it("mergeSourceInfo は patch の定義済み項目で上書きする", () => {
    expect(mergeSourceInfo({ year: 2000, doi: "10.1/a", origin: "file" }, { year: 2025, venue: "V", origin: "crossref" })).toEqual({
      year: 2025,
      doi: "10.1/a",
      venue: "V",
      origin: "crossref",
    });
  });
});
