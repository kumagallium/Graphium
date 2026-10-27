import { describe, expect, it } from "vitest";

import { detectMode, DUPLICATE_THRESHOLD, textSimilarity } from "./text-similarity";

describe("textSimilarity", () => {
  it("言語を判別する", () => {
    expect(detectMode("均質なほど流れやすい")).toBe("cjk");
    expect(detectMode("Flow is easier when homogeneous")).toBe("word");
    expect(detectMode("SPS焼結で粒径が変わる")).toBe("cjk");
  });

  it("和文: 言い換えは候補になり、無関係な対は候補にならない", () => {
    const base = "構成要素が均質なほど流れが妨げられにくい\n構成要素の性質が均質なほど、内部の流れが妨げられにくい。キャリアの移動度が高まる。";
    const paraphrase = "均質な構成ほど流れが止まりにくい\n構成要素の性質がそろっているほど、内部の流れは妨げられにくくなる。移動度が高くなる。";
    const unrelated = "冷却を急ぐと秩序が崩れる\n冷却を急ぐほど、結晶の秩序が崩れやすい。急に冷やすと、内部にひずみが残る。";
    expect(textSimilarity(base, paraphrase)).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD.cjk);
    expect(textSimilarity(base, unrelated)).toBeLessThan(DUPLICATE_THRESHOLD.cjk);
  });

  it("英文: 言い換えは候補になり、無関係な対は候補にならない（文字 bigram だと無関係でも 0.4 になる対）", () => {
    const base = "The more homogeneous the components, the less the internal flow is impeded.\nWhen component properties are uniform, carriers move through the material with fewer obstacles.";
    const paraphrase = "Flow is impeded less when components are more homogeneous.\nUniform component properties let carriers move through the material with fewer obstacles.";
    const unrelated = "Rapid cooling destroys crystalline order.\nQuenching a melt quickly leaves residual strain inside the solid and lowers its crystallinity.";
    expect(textSimilarity(base, paraphrase)).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD.word);
    expect(textSimilarity(base, unrelated)).toBeLessThan(DUPLICATE_THRESHOLD.word);
  });

  it("言語が違う対や空文は 0", () => {
    expect(textSimilarity("均質なほど流れやすい", "homogeneous flow")).toBe(0);
    expect(textSimilarity("", "あ")).toBe(0);
  });
});
