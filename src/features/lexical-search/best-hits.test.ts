import { afterEach, describe, expect, it, vi } from "vitest";
import { bestHitsBySource } from "./best-hits";
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
