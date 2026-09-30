import { describe, expect, it } from "vitest";
import { buildSavedForm } from "../note-save/saved-form";
import type { GraphiumDocument } from "../../lib/document-types";
import {
  STANDARD_BODY_WIDTH,
  bodyWidthToDocFields,
  withNormalizedBodyWidth,
  effectivePaperMode,
  resolveBodyWidth,
  toggleA4Choice,
  toggleFullWidthChoice,
} from "./body-width";

describe("resolveBodyWidth", () => {
  it("項目が無ければ標準", () => {
    expect(resolveBodyWidth({})).toEqual(STANDARD_BODY_WIDTH);
    expect(resolveBodyWidth(undefined)).toEqual(STANDARD_BODY_WIDTH);
  });

  it("fullWidth / paperSize をそのまま読む", () => {
    expect(resolveBodyWidth({ fullWidth: true })).toEqual({ fullWidth: true, paperSize: undefined });
    expect(resolveBodyWidth({ paperSize: "a4" })).toEqual({ fullWidth: false, paperSize: "a4" });
  });

  it("知らない値は標準に戻す（将来の版が書いた値）", () => {
    expect(resolveBodyWidth({ paperSize: "letter" })).toEqual(STANDARD_BODY_WIDTH);
  });

  it("両方が立っていたら A4 を優先し、幅いっぱいは外す", () => {
    expect(resolveBodyWidth({ fullWidth: true, paperSize: "a4" })).toEqual({
      fullWidth: false,
      paperSize: "a4",
    });
  });
});

describe("メニューの排他", () => {
  it("A4 を選ぶと幅いっぱいが外れる", () => {
    expect(toggleA4Choice({ fullWidth: true, paperSize: undefined })).toEqual({
      fullWidth: false,
      paperSize: "a4",
    });
  });

  it("幅いっぱいを選ぶと A4 が外れる", () => {
    expect(toggleFullWidthChoice({ fullWidth: false, paperSize: "a4" })).toEqual({
      fullWidth: true,
      paperSize: undefined,
    });
  });

  it("入っている方をもう一度選ぶと標準に戻る", () => {
    expect(toggleA4Choice({ fullWidth: false, paperSize: "a4" })).toEqual(STANDARD_BODY_WIDTH);
    expect(toggleFullWidthChoice({ fullWidth: true, paperSize: undefined })).toEqual(
      STANDARD_BODY_WIDTH,
    );
  });

  it("どの操作の結果も両方が立たない", () => {
    const starts = [
      STANDARD_BODY_WIDTH,
      { fullWidth: true, paperSize: undefined },
      { fullWidth: false, paperSize: "a4" as const },
    ];
    for (const s of starts) {
      for (const next of [toggleA4Choice(s), toggleFullWidthChoice(s)]) {
        expect(next.fullWidth && next.paperSize === "a4").toBe(false);
      }
    }
  });
});

describe("effectivePaperMode", () => {
  it("デスクトップで A4 のときだけ a4", () => {
    expect(effectivePaperMode("a4", { isDesktop: true })).toBe("a4");
    expect(effectivePaperMode(undefined, { isDesktop: true })).toBe("standard");
  });

  it("モバイルは A4 を選んでいても標準", () => {
    expect(effectivePaperMode("a4", { isDesktop: false })).toBe("standard");
  });
});

describe("bodyWidthToDocFields（buildDocument が書く 2 項目）", () => {
  it("標準は両方 undefined（fullWidth: false を書かない）", () => {
    expect(bodyWidthToDocFields(STANDARD_BODY_WIDTH)).toEqual({ fullWidth: undefined, paperSize: undefined });
  });

  it("幅いっぱいは fullWidth だけ、A4 は paperSize だけを運ぶ", () => {
    expect(bodyWidthToDocFields({ fullWidth: true, paperSize: undefined })).toEqual({
      fullWidth: true,
      paperSize: undefined,
    });
    expect(bodyWidthToDocFields({ fullWidth: false, paperSize: "a4" })).toEqual({
      fullWidth: undefined,
      paperSize: "a4",
    });
  });
});

describe("withNormalizedBodyWidth（開いただけで書き込まないための基準）", () => {
  const doc = (o: Partial<Omit<GraphiumDocument, "paperSize">> & { paperSize?: unknown }) =>
    ({ version: 6, title: "t", pages: [], modifiedAt: "x", ...o }) as unknown as GraphiumDocument;
  // buildDocument が読み込み直後に組み立てる形（resolveBodyWidth → bodyWidthToDocFields）
  const rebuilt = (d: GraphiumDocument) => ({ ...d, ...bodyWidthToDocFields(resolveBodyWidth(d)) });

  it("両方が立った doc・知らない paperSize・fullWidth: false の明示でも、組み立て直した形と同じになる", () => {
    for (const d of [
      doc({ fullWidth: true, paperSize: "a4" }),
      doc({ paperSize: "letter" }),
      doc({ fullWidth: false }),
      doc({}),
    ]) {
      expect(buildSavedForm(withNormalizedBodyWidth(d))).toBe(buildSavedForm(rebuilt(d)));
    }
  });

  it("正規化しないと食い違う（両方が立った doc）", () => {
    const d = doc({ fullWidth: true, paperSize: "a4" });
    expect(buildSavedForm(d)).not.toBe(buildSavedForm(rebuilt(d)));
  });
});
