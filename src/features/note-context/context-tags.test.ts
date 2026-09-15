import { describe, it, expect } from "vitest";
import { normalizeNoteContexts, noteContextHue, replaceNoteContext } from "./context-tags";

describe("normalizeNoteContexts", () => {
  it("trim・空除去・小文字比較の重複除去（表示は初出の形）", () => {
    expect(normalizeNoteContexts(["  eureco ", "Eureco", "", "哲学"])).toEqual([
      "eureco",
      "哲学",
    ]);
  });

  it("1 つも残らなければ undefined（未分類）", () => {
    expect(normalizeNoteContexts(["", "  "])).toBeUndefined();
    expect(normalizeNoteContexts(undefined)).toBeUndefined();
  });
});

describe("noteContextHue", () => {
  it("同じ名前（表記ゆれ込み）は同じ色相", () => {
    expect(noteContextHue("eureco")).toBe(noteContextHue("  Eureco "));
  });

  it("0..359 の範囲に収まる", () => {
    for (const v of ["a", "実験A", "とても長い文脈ラベルの例", "🚀"]) {
      const h = noteContextHue(v);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });

  it("1 文字違いの連番タグ（実験A/実験B/実験C）でも色相が離れる", () => {
    // 逐次 % 360 の旧ハッシュは 205/206/207 とほぼ同色になり、
    // 全体グラフの文脈色分けで区別できなかった（avalanche 導入の理由）。
    const hues = ["実験A", "実験B", "実験C"].map(noteContextHue);
    for (let i = 0; i < hues.length; i++) {
      for (let j = i + 1; j < hues.length; j++) {
        // 円環上の距離（0..180）で最低 30 度は離れていること
        const d = Math.abs(hues[i] - hues[j]);
        const circular = Math.min(d, 360 - d);
        expect(circular).toBeGreaterThanOrEqual(30);
      }
    }
  });
});

describe("replaceNoteContext", () => {
  it("並び順を保ったまま名前を差し替える", () => {
    expect(replaceNoteContext(["Rye", "Sordough", "Starter"], "Sordough", "Sourdough")).toEqual([
      "Rye",
      "Sourdough",
      "Starter",
    ]);
  });

  it("大文字小文字を区別せずに探し、表記だけの直しもできる", () => {
    expect(replaceNoteContext(["sourdough"], "SOURDOUGH", "Sourdough")).toEqual(["Sourdough"]);
  });

  it("差し替え先が既に付いていれば 1 つに畳む", () => {
    expect(replaceNoteContext(["Sourdough", "Sordough"], "Sordough", "sourdough")).toEqual([
      "Sourdough",
    ]);
  });

  it("差し替え元が付いていなければ新しい名前を足さない", () => {
    expect(replaceNoteContext(["Rye"], "Sordough", "Sourdough")).toEqual(["Rye"]);
    expect(replaceNoteContext(undefined, "Sordough", "Sourdough")).toBeUndefined();
  });

  it("空の名前にすると外れる", () => {
    expect(replaceNoteContext(["Sordough"], "Sordough", "  ")).toBeUndefined();
  });
});
