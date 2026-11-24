import { describe, expect, it } from "vitest";
import { forcesWebSearch, includesCrossSearch, isHelpScope } from "./grounding-scope";

describe("grounding-scope", () => {
  it("横断検索は内部参照と外部参照だけ（ノート内参照と使い方はしない）", () => {
    expect(includesCrossSearch("internal")).toBe(true);
    expect(includesCrossSearch("external")).toBe(true);
    expect(includesCrossSearch("notes")).toBe(false);
    expect(includesCrossSearch("help")).toBe(false);
  });
  it("Web 検索を強制するのは外部参照だけ", () => {
    expect(forcesWebSearch("external")).toBe(true);
    expect(forcesWebSearch("help")).toBe(false);
  });
  it("使い方の判定", () => {
    expect(isHelpScope("help")).toBe(true);
    expect(isHelpScope("internal")).toBe(false);
    expect(isHelpScope(undefined)).toBe(false);
  });
});
