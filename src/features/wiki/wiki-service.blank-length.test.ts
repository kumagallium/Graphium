// PR #1079 で isBlankText を導入した後、レビューで isBlankText が当たっていないと分かった
// 残りの入口（ingestFromPdf / ingestFromDocx の 50 文字下限）のテスト。
// 「不可視文字だけで長さ 50 以上」の本文は、以前は素の .length で判定され AI に渡っていたが、
// 見える文字の長さ（visibleTextLength）で数えることで弾かれることを確認する。
// 普通の本文（50 文字以上）は今までどおり通ること、49 字の普通の本文は今までどおり断られる
// ことも合わせて確認する。
import { describe, expect, it, vi, afterEach } from "vitest";

// react-pdf 経由の pdfjs は jsdom 環境で読み込むと重いので、extractPdfText 自体をモックする。
vi.mock("./pdf-text-extractor", () => ({
  extractPdfText: vi.fn(),
  capForSingleCall: (text: string) => text,
}));

vi.mock("mammoth", () => ({
  extractRawText: vi.fn(),
}));

import { ingestFromPdf, ingestFromDocx } from "./wiki-service";
import { extractPdfText } from "./pdf-text-extractor";
import * as mammoth from "mammoth";

const INVISIBLE = "​"; // ゼロ幅スペース

describe("ingestFromPdf: 50 文字の下限は見える文字で数える", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("不可視文字だけで長さ 50 以上の本文は断る（/ingest を呼ばない）", async () => {
    (extractPdfText as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      title: "テストPDF",
      text: INVISIBLE.repeat(60),
      pageCount: 1,
    });
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      ingestFromPdf(new Blob(["dummy"]), "test.pdf", "note-1", [], "ja", "schema"),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("普通の本文（50 文字以上）は今までどおり /ingest を呼ぶ", async () => {
    const text = "あ".repeat(50);
    (extractPdfText as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      title: "テストPDF",
      text,
      pageCount: 1,
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ wikis: [], tokenUsage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, model: "test-model" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await ingestFromPdf(new Blob(["dummy"]), "test.pdf", "note-1", [], "ja", "schema");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.model).toBe("test-model");
  });

  it("49 字の普通の本文は今までどおり断られる", async () => {
    const text = "あ".repeat(49);
    (extractPdfText as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      title: "テストPDF",
      text,
      pageCount: 1,
    });
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      ingestFromPdf(new Blob(["dummy"]), "test.pdf", "note-1", [], "ja", "schema"),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("ingestFromDocx: 50 文字の下限は見える文字で数える", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("不可視文字だけで長さ 50 以上の本文は断る（/ingest を呼ばない）", async () => {
    (mammoth.extractRawText as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      value: INVISIBLE.repeat(60),
    });
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      ingestFromDocx(new Blob(["dummy"]), "test.docx", "note-1", [], "ja", "schema"),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("普通の本文（50 文字以上）は今までどおり /ingest を呼ぶ", async () => {
    const text = "あ".repeat(50);
    (mammoth.extractRawText as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ value: text });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ wikis: [], tokenUsage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, model: "test-model" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await ingestFromDocx(new Blob(["dummy"]), "test.docx", "note-1", [], "ja", "schema");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.model).toBe("test-model");
  });

  it("49 字の普通の本文は今までどおり断られる", async () => {
    const text = "あ".repeat(49);
    (mammoth.extractRawText as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ value: text });
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      ingestFromDocx(new Blob(["dummy"]), "test.docx", "note-1", [], "ja", "schema"),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
