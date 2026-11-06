import { describe, expect, it } from "vitest";
import { buildLabelAlignerUserMessage, dropsQualifier, hasAlignWork, parseLabelAlignerOutput, type AlignRequest } from "./label-aligner";

const req: AlignRequest = {
  labels: { step: ["calcining", "焼成"], material: ["barium carbonate"], tool: ["furnace"] },
  candidates: { step: ["Calcination", "Sintering", "仮焼"], material: ["BaCO3"], output: ["BaFe12O19"] },
};

describe("label-aligner", () => {
  it("新しい名前と既存の名前が同じ種類に揃っている種類だけ prompt に載せる", () => {
    const msg = buildLabelAlignerUserMessage(req);
    expect(msg).toContain('key: "step"');
    expect(msg).toContain('key: "material"');
    expect(msg).not.toContain('key: "tool"');
    expect(msg).not.toContain('key: "output"');
    expect(hasAlignWork(req)).toBe(true);
    expect(hasAlignWork({ labels: { tool: ["x"] }, candidates: { step: ["y"] } })).toBe(false);
  });

  it("一覧に実在する名前どうしの寄せだけを通す", () => {
    const raw = `Here you go:\n{"step": {"calcining": "Calcination", "drying": "Drying"}, "material": {"barium carbonate": "BaCO3", "BaCO3": "BaCO3"}, "tool": {"furnace": "Tube furnace"}}`;
    const out = parseLabelAlignerOutput(raw, req);
    expect(out.step).toEqual({ calcining: "Calcination" });
    expect(out.material).toEqual({ "barium carbonate": "BaCO3" });
    expect(out.tool).toBeUndefined();
  });

  it("手順名は文字種の違う寄せを通さない（見出しの言語を崩さない）", () => {
    const out = parseLabelAlignerOutput(`{"step": {"焼成": "Sintering", "calcining": "仮焼"}}`, req);
    expect(out.step).toBeUndefined();
    const ok = parseLabelAlignerOutput(`{"step": {"焼成": "仮焼"}}`, req);
    expect(ok.step).toEqual({ 焼成: "仮焼" });
  });

  it("壊れた JSON や JSON 以外は空の表にする", () => {
    expect(parseLabelAlignerOutput("no json here", req)).toEqual({});
    expect(parseLabelAlignerOutput(`{"step": {"calcining": "Calcination"`, req)).toEqual({ step: { calcining: "Calcination" } });
  });

  it("限定語を落として汎用名に寄せる答えは弾く（装置のメーカー名と材料の形のことばは落としてよい）", () => {
    expect(dropsQualifier("step", "Measuring resistivity", "Measuring")).toBe(true);
    expect(dropsQualifier("step", "Spark plasma sintering", "Sintering")).toBe(true);
    expect(dropsQualifier("material", "1 h ball-milled powder", "ball-milled powder")).toBe(true);
    expect(dropsQualifier("output", "room temperature hysteresis loops", "hysteresis loops")).toBe(true);
    expect(dropsQualifier("attributeKey", "substrate temperature", "temperature")).toBe(true);
    expect(dropsQualifier("material", "Fe2O3 powder", "Fe2O3")).toBe(false);
    expect(dropsQualifier("tool", "Fritsch Pulverisette P-5 planetary ball mill", "planetary ball mill")).toBe(false);
    expect(dropsQualifier("step", "calcining", "Calcination")).toBe(false);
    expect(dropsQualifier("attributeKey", "magnetic_field", "magnetic_field_strength")).toBe(false);
    const r: AlignRequest = { labels: { step: ["Measuring resistivity", "calcining"] }, candidates: { step: ["Measuring", "Calcination"] } };
    expect(parseLabelAlignerOutput(`{"step": {"Measuring resistivity": "Measuring", "calcining": "Calcination"}}`, r).step).toEqual({ calcining: "Calcination" });
  });
});
