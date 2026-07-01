import { afterEach, describe, expect, it, vi } from "vitest";

import {
  searchWikipedia,
  searchOpenAlex,
  formatEvidence,
  runBuiltinGroundingSearch,
  type EvidenceItem,
} from "./grounding-providers.js";

function stubFetch(routes: (url: string) => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (u: unknown) => {
      const body = routes(String(u));
      if (body === undefined) return { ok: false, json: async () => ({}) };
      return { ok: true, json: async () => body };
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("searchWikipedia", () => {
  it("検索ヒットを記事 URL + 抜粋（HTML 除去）に整形する", async () => {
    stubFetch((url) =>
      url.includes("en.wikipedia.org")
        ? {
            query: {
              search: [
                { title: "Thermal conductivity", snippet: 'low <span class="searchmatch">thermal</span> conductivity' },
              ],
            },
          }
        : undefined,
    );
    const out = await searchWikipedia("thermal conductivity", "en");
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("https://en.wikipedia.org/wiki/Thermal_conductivity");
    expect(out[0].snippet).toBe("low thermal conductivity");
    expect(out[0].source).toBe("wikipedia");
  });

  it("language=ja は ja.wikipedia を引く", async () => {
    const fetchMock = vi.fn(async (_url: unknown) => ({
      ok: true,
      json: async () => ({ query: { search: [{ title: "熱伝導率", snippet: "x" }] } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await searchWikipedia("熱伝導率", "ja");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("ja.wikipedia.org");
    expect(out[0].url).toContain("ja.wikipedia.org/wiki/");
  });

  it("HTTP エラーは空配列に倒す", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    expect(await searchWikipedia("x", "en")).toEqual([]);
  });
});

describe("searchOpenAlex", () => {
  it("DOI・被引用数・復元した abstract を返す", async () => {
    stubFetch(() => ({
      results: [
        {
          title: "On grain growth",
          doi: "https://doi.org/10.1016/j.actamat.2020.01.001",
          id: "https://openalex.org/W123",
          cited_by_count: 42,
          publication_year: 2020,
          // "grain growth occurs" を倒置インデックスで表現
          abstract_inverted_index: { grain: [0], growth: [1], occurs: [2] },
        },
      ],
    }));
    const out = await searchOpenAlex("grain growth");
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("https://doi.org/10.1016/j.actamat.2020.01.001");
    expect(out[0].snippet).toContain("cited by 42");
    expect(out[0].snippet).toContain("grain growth occurs");
    expect(out[0].source).toBe("openalex");
  });

  it("DOI が無ければ OpenAlex landing URL にフォールバックする", async () => {
    stubFetch(() => ({
      results: [{ title: "No DOI work", doi: null, id: "https://openalex.org/W999", cited_by_count: 0 }],
    }));
    const out = await searchOpenAlex("x");
    expect(out[0].url).toBe("https://openalex.org/W999");
  });

  it("title も url も無いものは捨てる", async () => {
    stubFetch(() => ({ results: [{ cited_by_count: 1 }] }));
    expect(await searchOpenAlex("x")).toEqual([]);
  });
});

describe("formatEvidence", () => {
  it("provider ラベル付きで title / url / snippet を並べる", () => {
    const items: EvidenceItem[] = [
      { title: "Entropy", url: "https://en.wikipedia.org/wiki/Entropy", snippet: "a measure", source: "wikipedia" },
      { title: "Paper", url: "https://doi.org/10.1/x", snippet: "cited by 5", source: "openalex" },
    ];
    const text = formatEvidence(items);
    expect(text).toContain("[Wikipedia] Entropy");
    expect(text).toContain("https://en.wikipedia.org/wiki/Entropy");
    expect(text).toContain("[OpenAlex] Paper");
    expect(text).toContain("https://doi.org/10.1/x");
  });
});

describe("runBuiltinGroundingSearch", () => {
  it("Wikipedia + OpenAlex を統合し、証拠テキストに残った URL だけ返す", async () => {
    stubFetch((url) => {
      if (url.includes("wikipedia.org"))
        return { query: { search: [{ title: "Sintering", snippet: "process" }] } };
      if (url.includes("openalex.org"))
        return {
          results: [{ title: "Sintering paper", doi: "https://doi.org/10.1/s", id: "https://openalex.org/W1", cited_by_count: 3 }],
        };
      return undefined;
    });
    const out = await runBuiltinGroundingSearch("sintering", "en");
    expect(out.items).toHaveLength(2);
    expect(out.urls).toContain("https://en.wikipedia.org/wiki/Sintering");
    expect(out.urls).toContain("https://doi.org/10.1/s");
    expect(out.evidenceText).toContain("[Wikipedia]");
    expect(out.evidenceText).toContain("[OpenAlex]");
  });

  it("両方失敗なら空（parametric フォールバックの入口）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    const out = await runBuiltinGroundingSearch("x", "en");
    expect(out.evidenceText).toBe("");
    expect(out.urls).toEqual([]);
  });
});
