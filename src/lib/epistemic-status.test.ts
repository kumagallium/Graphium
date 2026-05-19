// Phase η: epistemic-status helper（lowestEpistemicStatus / epistemicRank）の検証。
// 低 → 高: speculation < interpretation < observation < established
// 「不明な場合は低い側に倒す」のが保守デフォルト。

import { describe, expect, it } from "vitest";
import { epistemicRank, lowestEpistemicStatus } from "./document-types";

describe("epistemicRank", () => {
  it("低い status ほど小さい数値を返す", () => {
    expect(epistemicRank("speculation")).toBeLessThan(epistemicRank("interpretation"));
    expect(epistemicRank("interpretation")).toBeLessThan(epistemicRank("observation"));
    expect(epistemicRank("observation")).toBeLessThan(epistemicRank("established"));
  });

  it("undefined は interpretation 相当（rank 1）", () => {
    expect(epistemicRank(undefined)).toBe(1);
    expect(epistemicRank(undefined)).toBe(epistemicRank("interpretation"));
  });
});

describe("lowestEpistemicStatus", () => {
  it("単独 status はそのまま返る", () => {
    expect(lowestEpistemicStatus(["speculation"])).toBe("speculation");
    expect(lowestEpistemicStatus(["established"])).toBe("established");
  });

  it("speculation + observation → speculation", () => {
    expect(lowestEpistemicStatus(["observation", "speculation"])).toBe("speculation");
  });

  it("established + interpretation → interpretation", () => {
    expect(lowestEpistemicStatus(["established", "interpretation"])).toBe("interpretation");
  });

  it("undefined を含むが known もある場合は known の最低が返る", () => {
    expect(lowestEpistemicStatus([undefined, "observation"])).toBe("observation");
    expect(lowestEpistemicStatus(["speculation", undefined, "established"])).toBe("speculation");
  });

  it("全 undefined / 空 → interpretation (中立デフォルト)", () => {
    expect(lowestEpistemicStatus([])).toBe("interpretation");
    expect(lowestEpistemicStatus([undefined, undefined])).toBe("interpretation");
  });

  it("同じ status の重複 → そのまま", () => {
    expect(lowestEpistemicStatus(["observation", "observation", "observation"])).toBe(
      "observation",
    );
  });
});
