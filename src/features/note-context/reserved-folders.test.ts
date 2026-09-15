import { describe, it, expect } from "vitest";
import { isPlanFolderPath, isPlanNote, normalizeFolderKey } from "./reserved-folders";

describe("normalizeFolderKey", () => {
  it("trim + 小文字化する", () => {
    expect(normalizeFolderKey(" Plan ")).toBe("plan");
  });

  it("全角英字は NFKC で半角に畳む（IME の変換残りを取りこぼさない）", () => {
    expect(normalizeFolderKey("ｐｌａｎ")).toBe("plan");
    expect(isPlanFolderPath("Ｐｌａｎ")).toBe(true);
  });
});

describe("isPlanFolderPath", () => {
  it("予約語そのもの（大文字小文字・前後空白ゆれ）は true", () => {
    expect(isPlanFolderPath("計画")).toBe(true);
    expect(isPlanFolderPath("Plan")).toBe(true);
    expect(isPlanFolderPath(" plan ")).toBe(true);
  });

  it("子フォルダは true", () => {
    expect(isPlanFolderPath("計画/2026春")).toBe(true);
    expect(isPlanFolderPath("plan/x/y")).toBe(true);
  });

  it("前方一致もどき（別語の一部）は false", () => {
    expect(isPlanFolderPath("計画中")).toBe(false);
    expect(isPlanFolderPath("planning")).toBe(false);
    expect(isPlanFolderPath("myplan")).toBe(false);
  });

  it("空文字は false", () => {
    expect(isPlanFolderPath("")).toBe(false);
  });
});

describe("isPlanNote", () => {
  it("予約フォルダを含む noteContexts は true", () => {
    expect(isPlanNote(["計画"])).toBe(true);
    expect(isPlanNote(["その他", "plan/x"])).toBe(true);
  });

  it("undefined / null / 空配列は false", () => {
    expect(isPlanNote(undefined)).toBe(false);
    expect(isPlanNote(null)).toBe(false);
    expect(isPlanNote([])).toBe(false);
  });

  it("予約フォルダを含まない配列は false", () => {
    expect(isPlanNote(["計画中", "planning"])).toBe(false);
  });

  it("数値混じりの配列は文字列要素だけ見る", () => {
    expect(isPlanNote([1, "計画", null])).toBe(true);
    expect(isPlanNote([1, 2, null])).toBe(false);
  });
});
