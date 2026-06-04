import { describe, it, expect } from "vitest";
import { isCaptionBlock, insertImagesAtCaptions } from "./figure-placement";

// テスト用の最小ブロック（content spans を持つ paragraph）
function para(text: string) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

describe("isCaptionBlock", () => {
  it("日本語の図表キャプションを検出する", () => {
    expect(isCaptionBlock(para("図1 Al3V の状態密度。"))).toBe(true);
    expect(isCaptionBlock(para("図 2  粉末 XRD パターン"))).toBe(true);
    expect(isCaptionBlock(para("表3 物性値の一覧"))).toBe(true);
  });
  it("英語の図表キャプションを検出する", () => {
    expect(isCaptionBlock(para("Figure 1. Density of states"))).toBe(true);
    expect(isCaptionBlock(para("Fig. 2 XRD patterns"))).toBe(true);
    expect(isCaptionBlock(para("Table 1: Summary"))).toBe(true);
  });
  it("通常の本文は検出しない", () => {
    expect(isCaptionBlock(para("また、試料密度は十分高密度を示した。"))).toBe(false);
    expect(isCaptionBlock(para("The Seebeck coefficient decreased with temperature."))).toBe(false);
  });

  it("本文中の図参照（行頭が図番号でも参照文）は誤検知しない", () => {
    // 番号直後に助詞 → 参照文
    expect(isCaptionBlock(para("Figure 3d は Al3V の Cp の温度依存性を示す。"))).toBe(false);
    expect(isCaptionBlock(para("図2 を参照のこと。"))).toBe(false);
    // 英語の参照動詞
    expect(isCaptionBlock(para("Figure 3 shows the temperature dependence."))).toBe(false);
    expect(isCaptionBlock(para("Figure 1 is the density of states."))).toBe(false);
  });

  it("枝番つきキャプション（Figure 3a 等）は検出する", () => {
    expect(isCaptionBlock(para("Figure 3a  Power factor vs temperature"))).toBe(true);
    expect(isCaptionBlock(para("Figure 1   Al3V の状態密度 (DOS)。インセット：結晶構造。"))).toBe(true);
  });
});

describe("insertImagesAtCaptions", () => {
  const img = (n: number) => ({ url: `u${n}`, name: `paper - p1 image ${n}.png` });

  it("各キャプションの直前（上）に順番で画像を差し込む", () => {
    const blocks = [para("intro"), para("図1 DOS"), para("between"), para("図2 XRD")];
    const r = insertImagesAtCaptions(blocks, [img(1), img(2)]);
    const texts = r.blocks.map((b) => (b.type === "image" ? `IMG:${b.props.url}` : b.content[0].text));
    expect(texts).toEqual(["intro", "IMG:u1", "図1 DOS", "between", "IMG:u2", "図2 XRD"]);
    expect(r.inserted).toBe(2);
    expect(r.leftover).toHaveLength(0);
  });

  it("キャプションより画像が多い場合は余りを leftover にする", () => {
    const blocks = [para("図1 DOS")];
    const r = insertImagesAtCaptions(blocks, [img(1), img(2)]);
    expect(r.inserted).toBe(1);
    expect(r.leftover).toEqual([img(2)]);
  });

  it("画像が無ければブロックをそのまま返す", () => {
    const blocks = [para("図1 DOS")];
    const r = insertImagesAtCaptions(blocks, []);
    expect(r.blocks).toBe(blocks);
    expect(r.inserted).toBe(0);
  });

  it("表（Table）キャプションには画像を割り当てない（図にだけ対応付ける）", () => {
    // Figure 1 → img a、Table 1 はスキップ、Figure 2 → img b
    const blocks = [para("Figure 1 DOS"), para("Table 1 格子定数"), para("Figure 2 XRD")];
    const r = insertImagesAtCaptions(blocks, [img(1), img(2)]);
    const texts = r.blocks.map((b) => (b.type === "image" ? `IMG:${b.props.url}` : b.content[0].text));
    expect(texts).toEqual(["IMG:u1", "Figure 1 DOS", "Table 1 格子定数", "IMG:u2", "Figure 2 XRD"]);
    expect(r.inserted).toBe(2);
    expect(r.leftover).toHaveLength(0);
  });

  it("キャプションと画像が別ページ相当（ブロック列のどこでも）でも出現順で対応付ける", () => {
    // Figure 3 のキャプションが本文ブロック群の後ろにあり、画像は文末側にある状況でも、
    // 出現順 index で Figure 3 の上に入る（グローバル対応）。
    const blocks = [para("Figure 3"), para("(a) S の温度依存性"), para("(b) σ の温度依存性")];
    const r = insertImagesAtCaptions(blocks, [img(1)]);
    const texts = r.blocks.map((b) => (b.type === "image" ? `IMG:${b.props.url}` : b.content[0].text));
    expect(texts).toEqual(["IMG:u1", "Figure 3", "(a) S の温度依存性", "(b) σ の温度依存性"]);
    expect(r.inserted).toBe(1);
  });
});
