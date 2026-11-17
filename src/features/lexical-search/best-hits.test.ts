import { afterEach, describe, expect, it, vi } from "vitest";
import { bestHitsBySource, phraseHitsBySource } from "./best-hits";
import { lexicalSearch } from "./service";

describe("bestHitsBySource — minTermMatches", () => {
  afterEach(() => vi.restoreAllMocks());

  const mock = () => {
    vi.spyOn(lexicalSearch, "isReady").mockReturnValue(true);
    return vi.spyOn(lexicalSearch, "search").mockReturnValue([] as any);
  };

  it("未指定なら従来どおり（3 語以下は 1、4 語以上は 2）", () => {
    const search = mock();
    bestHitsBySource("alpha beta", ["note"]);
    bestHitsBySource("alpha beta gamma delta", ["note"]);
    expect(search.mock.calls[0][1]).toMatchObject({ minTermMatches: 1 });
    expect(search.mock.calls[1][1]).toMatchObject({ minTermMatches: 2 });
  });

  it("指定すればその値を検索に渡す", () => {
    const search = mock();
    bestHitsBySource("alpha beta", ["note"], { minTermMatches: 2 });
    expect(search.mock.calls[0][1]).toMatchObject({ minTermMatches: 2 });
  });
});

describe("phraseHitsBySource — 入れた言葉がそのまま入っている断片だけ", () => {
  afterEach(() => vi.restoreAllMocks());

  it("断片の文章に、空白で区切った言葉がすべて入っているものだけを通す", () => {
    vi.spyOn(lexicalSearch, "isReady").mockReturnValue(true);
    const search = vi.spyOn(lexicalSearch, "search").mockReturnValue([] as any);
    phraseHitsBySource("聞こえ ますか", ["asset"]);
    const options = search.mock.calls[0][1]!;
    expect(options).toMatchObject({ kinds: ["asset"], perSourceLimit: 1 });
    // 「聞こ」だけ・「こえ」だけの断片は落とす
    expect(options.accept!("声が聞こえますか")).toBe(true);
    expect(options.accept!("聞こうとした")).toBe(false);
    expect(options.accept!("聞こえた")).toBe(false);
    // 全角・半角、大文字・小文字の違いは吸収する
    phraseHitsBySource("Shredded", ["asset"]);
    expect(search.mock.calls[1][1]!.accept!("ｓｈｒｅｄｄｅｄ cheese")).toBe(true);
  });

  it("索引がまだ無ければ空を返す", () => {
    vi.spyOn(lexicalSearch, "isReady").mockReturnValue(false);
    expect(phraseHitsBySource("温度", ["note"]).size).toBe(0);
  });
});
