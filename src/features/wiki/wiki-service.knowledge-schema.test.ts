import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ingestFromChat,
  ingestFromDocx,
  ingestFromMultiSource,
  ingestFromPdf,
  ingestFromUrl,
} from "./wiki-service";

vi.mock("./pdf-text-extractor", () => ({
  extractPdfText: vi.fn(async () => ({
    text: "PDFから抽出した十分に長いテスト本文です。".repeat(4),
    title: "PDF title",
    pageCount: 2,
  })),
  capForSingleCall: vi.fn((text: string) => text),
}));

vi.mock("mammoth", () => ({
  extractRawText: vi.fn(async () => ({
    value: "DOCXから抽出した十分に長いテスト本文です。".repeat(4),
  })),
}));

describe("追加 ingest 経路の Knowledge Schema", () => {
  const originalFetch = global.fetch;
  const knowledgeSchema = "  Required schema  ";
  const ingestResponse = {
    ok: true,
    json: async () => ({
      wikis: [],
      tokenUsage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      model: "test-model",
    }),
  };

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  function expectIngestSchema(fetchMock: ReturnType<typeof vi.fn>) {
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/api/wiki/ingest"));
    expect(call).toBeDefined();
    expect(JSON.parse(String(call![1]?.body))).toMatchObject({ knowledgeSchema });
  }

  it("URL 経路で /ingest に Schema を含める", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: "Example",
          description: "",
          text: "URL body",
          url: "https://example.com",
        }),
      })
      .mockResolvedValueOnce(ingestResponse);
    global.fetch = fetchMock as unknown as typeof fetch;

    await ingestFromUrl("https://example.com", [], "ja", knowledgeSchema);

    expectIngestSchema(fetchMock);
  });

  it("PDF 経路で /ingest に Schema を含める", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ingestResponse);
    global.fetch = fetchMock as unknown as typeof fetch;

    await ingestFromPdf(new Blob(["pdf"]), "paper.pdf", "pdf:1", [], "ja", knowledgeSchema);

    expectIngestSchema(fetchMock);
  });

  it("DOCX 経路で /ingest に Schema を含める", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ingestResponse);
    global.fetch = fetchMock as unknown as typeof fetch;

    await ingestFromDocx(new Blob(["docx"]), "paper.docx", "document:1", [], "ja", knowledgeSchema);

    expectIngestSchema(fetchMock);
  });

  it("複数ソース経路で /ingest に Schema を含める", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ingestResponse);
    global.fetch = fetchMock as unknown as typeof fetch;

    await ingestFromMultiSource(
      [{ sourceNoteId: "note:1", title: "Note", text: "body", kind: "note" }],
      "Wiki",
      "wiki:1",
      [],
      "ja",
      knowledgeSchema,
    );

    expectIngestSchema(fetchMock);
  });

  it("チャット経路で /ingest に Schema を含める", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ingestResponse);
    global.fetch = fetchMock as unknown as typeof fetch;

    await ingestFromChat(
      [{ role: "user", content: "message" }],
      "Chat",
      [],
      "ja",
      knowledgeSchema,
    );

    expectIngestSchema(fetchMock);
  });
});
