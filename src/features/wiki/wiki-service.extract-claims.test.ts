// 知見（Claims）拡張の ON/OFF（2026-09-17 決定）で、各 ingest 関数が extractClaims=false の
// ときに /api/wiki/ingest を呼ばず、本文抽出だけを行って返すことを確認する。
// トピック段（runSourceTopicStage）は呼び出し側（note-app.tsx）が sourceText を使って
// 別途走らせるため、ここでは ingest 関数自体の呼び出し有無だけを検証する。
import { describe, expect, it, vi, afterEach } from "vitest";
import { ingestFromUrl, ingestFromChat } from "./wiki-service";

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

    const result = await ingestFromUrl("https://example.com", [], "ja", false);

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

    const result = await ingestFromUrl("https://example.com", [], "ja");

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

    await ingestFromUrl("https://example.com", [], "ja", true, controller.signal);

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ signal: controller.signal });
  });
});
