import { describe, expect, it } from "vitest";
import { buildGeneratedNoteFolders } from "./generated-folders";

describe("buildGeneratedNoteFolders", () => {
  it("元がフォルダに入っていなくても種類のフォルダに入る（未分類に落ちない）", () => {
    expect(buildGeneratedNoteFolders("翻訳", [])).toEqual(["翻訳"]);
    expect(buildGeneratedNoteFolders("翻訳")).toEqual(["翻訳"]);
  });

  it("元のフォルダを種類のフォルダの後ろに引き継ぐ", () => {
    expect(buildGeneratedNoteFolders("翻訳", ["熱電", "論文/2026"])).toEqual(["翻訳", "熱電", "論文/2026"]);
  });

  it("重複は大文字小文字を無視して 1 つにする", () => {
    expect(buildGeneratedNoteFolders("Translations", ["translations", "Bread"])).toEqual([
      "Translations",
      "Bread",
    ]);
  });

  it("予約フォルダ「計画」とその子は引き継がない（計画ノート扱いにしない）", () => {
    expect(buildGeneratedNoteFolders("手順", ["計画", "計画/パン", "Plan", "熱電"])).toEqual(["手順", "熱電"]);
  });

  it("種類のフォルダが空なら元のフォルダだけ、どちらも無ければ undefined", () => {
    expect(buildGeneratedNoteFolders("", ["熱電"])).toEqual(["熱電"]);
    expect(buildGeneratedNoteFolders("  ", [])).toBeUndefined();
  });
});
