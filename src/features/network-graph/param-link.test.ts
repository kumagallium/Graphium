// パラメータ・属性値の @参照リンク解決
import { afterEach, describe, expect, it } from "vitest";
import { resolveParamLinkTarget, setParamLinkResolver } from "./param-link";

afterEach(() => setParamLinkResolver(null));

describe("resolveParamLinkTarget", () => {
  const resolver = (name: string) =>
    name === "測定.csv" ? "data:f9" : name === "実験ノート" ? "n1" : null;

  it("@名前 をリゾルバで解決する（前後の空白は許容）", () => {
    setParamLinkResolver(resolver);
    expect(resolveParamLinkTarget("@測定.csv")).toBe("data:f9");
    expect(resolveParamLinkTarget("  @実験ノート  ")).toBe("n1");
  });

  it("@ で始まらない値・解決できない名前・空値は null", () => {
    setParamLinkResolver(resolver);
    expect(resolveParamLinkTarget("900℃")).toBeNull();
    expect(resolveParamLinkTarget("@知らない名前")).toBeNull();
    expect(resolveParamLinkTarget("@")).toBeNull();
    expect(resolveParamLinkTarget("")).toBeNull();
    expect(resolveParamLinkTarget(null)).toBeNull();
    expect(resolveParamLinkTarget(undefined)).toBeNull();
  });

  it("リゾルバ未登録なら常に null（グラフ単体表示・Storybook 等）", () => {
    expect(resolveParamLinkTarget("@測定.csv")).toBeNull();
  });
});
