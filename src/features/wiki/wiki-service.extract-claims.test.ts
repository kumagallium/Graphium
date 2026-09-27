// 知見（Claims）拡張の ON/OFF（2026-09-17 決定）で、各 ingest 関数が extractClaims=false の
// ときに /api/wiki/ingest を呼ばず、本文抽出だけを行って返すことを確認する。
// トピック段（runSourceTopicStage）は呼び出し側（note-app.tsx）が sourceText を使って
// 別途走らせるため、ここでは ingest 関数自体の呼び出し有無だけを検証する。
// ingestNote は知見 ON でも、本文が空のノートでは /api/wiki/ingest を呼ばない
// （空のまま送るとサーバーが 400 "noteContent is required" で断り、英語の文言がトーストに出ていた）。
import { describe, expect, it, vi, afterEach } from "vitest";
import { ingestFromUrl, ingestFromChat, ingestNote } from "./wiki-service";
import type { GraphiumDocument } from "../../lib/document-types";

function noteDoc(blocks: any[]): GraphiumDocument {
  return {
    version: 6,
    title: "テストノート",
    pages: [{ id: "main", title: "テストノート", blocks, labels: {}, provLinks: [], knowledgeLinks: [] }],
    createdAt: "2026-09-27T00:00:00Z",
    modifiedAt: "2026-09-27T00:00:00Z",
  } as GraphiumDocument;
}

const paragraph = (id: string, text: string | null) => ({
  id,
  type: "paragraph",
  props: {},
  content: text === null ? [] : [{ type: "text", text, styles: {} }],
  children: [],
});

describe("ingestNote: 本文が空のノートは知見 ON でも /ingest を呼ばない", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it.each([
    ["空の段落だけ", [paragraph("b1", null)]],
    ["空白と改行だけ", [paragraph("b1", "   "), paragraph("b2", "\n\t")]],
    ["文字の無い画像だけ", [{ id: "img", type: "image", props: { url: "https://example.com/a.png", caption: "" }, children: [] }]],
    ["ブロックが 1 つも無い", []],
  ])("%s → /ingest を呼ばず、知見 0 件で返す", async (_label, blocks) => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await ingestNote("note-1", noteDoc(blocks), [], "ja", "m", undefined, "schema", undefined, true);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.wikis).toEqual([]);
    expect(result.model).toBeNull();
  });

  it("本文があれば /ingest を呼ぶ", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ wikis: [], tokenUsage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, model: "test-model" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await ingestNote("note-1", noteDoc([paragraph("b1", "パン生地を 60 分発酵させた")]), [], "ja", "m", undefined, "schema", undefined, true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/ingest$/);
    expect(result.model).toBe("test-model");
  });
});

describe("ingest 関数の extractClaims フラグ（知見の ON/OFF）", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("ingestFromChat: extractClaims=false のときは /ingest を呼ばず、sourceText だけ返す", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await ingestFromChat(
      [{ role: "user", content: "テスト本文" }],
      "テストチャット",
      [],
      "ja",
      "schema",
      false,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.wikis).toEqual([]);
    expect(result.sourceText).toContain("テスト本文");
  });

  it("ingestFromChat: extractClaims=true（既定）のときは /ingest を呼ぶ", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ wikis: [], tokenUsage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, model: "test-model" }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await ingestFromChat(
      [{ role: "user", content: "テスト本文" }],
      "テストチャット",
      [],
      "ja",
      "schema",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.model).toBe("test-model");
  });

  it("ingestFromUrl: extractClaims=false のときは fetch-url だけ呼び、/ingest は呼ばない", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ title: "テストページ", description: "", text: "本文テキスト", url: "https://example.com" }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await ingestFromUrl("https://example.com", [], "ja", "schema", false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.wikis).toEqual([]);
    expect(result.sourceText).toContain("本文テキスト");
    expect(result.sourceTitle).toBe("テストページ");
  });

  it("ingestFromUrl: extractClaims=true（既定）のときは fetch-url と /ingest の 2 回呼ぶ", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ title: "テストページ", description: "", text: "本文テキスト", url: "https://example.com" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ wikis: [], tokenUsage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, model: "test-model" }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await ingestFromUrl("https://example.com", [], "ja", "schema");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.model).toBe("test-model");
  });

  it("ingestFromUrl は停止シグナルを URL 取得と知見抽出の両方へ渡す", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ title: "テストページ", description: "", text: "本文テキスト", url: "https://example.com" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ wikis: [], tokenUsage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, model: "test-model" }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;
    const controller = new AbortController();

    await ingestFromUrl("https://example.com", [], "ja", "schema", true, controller.signal);

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ signal: controller.signal });
  });
});
