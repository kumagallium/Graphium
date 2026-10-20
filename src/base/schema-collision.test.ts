// @vitest-environment jsdom
// Graphium の独自ブロック・インライン・スタイルの型名が、BlockNote の既定スキーマと
// 衝突していないことの検査。BlockNote を上げて既定ブロックが増えたとき（0.54 で math と
// diagram が xl 側に入った等）、同名の独自ブロックが黙って上書きされる／されるのを防ぐ。
// 衝突したら、独自側を改名するか、既定側を外す判断をしてからこのテストを更新する。
import { describe, it, expect, vi } from "vitest";

// registry は pdf-viewer 経由で react-pdf（canvas/DOMMatrix 前提）を読み込むため、
// blocks-to-markdown.test.ts と同じく差し替える
vi.mock("react-pdf", () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}));
vi.mock("../lib/pdfjs-config", () => ({}));

import { defaultBlockSpecs, defaultInlineContentSpecs, defaultStyleSpecs } from "@blocknote/core";
import { customBlockEntries, CUSTOM_INLINE_TYPES } from "../blocks/registry";
import { inlineLabelStyleSpecs } from "../features/inline-label/styles";

describe("独自スキーマと BlockNote 既定スキーマの衝突", () => {
  it("独自ブロックの型名は既定ブロックと重ならない", () => {
    const custom = customBlockEntries.map((b) => b.type);
    const overlap = custom.filter((t) => t in defaultBlockSpecs);
    expect(overlap).toEqual([]);
  });

  it("独自インラインの型名は既定インラインと重ならない", () => {
    const overlap = [...CUSTOM_INLINE_TYPES].filter((t) => t in defaultInlineContentSpecs);
    expect(overlap).toEqual([]);
  });

  it("独自スタイルの名前は既定スタイルと重ならない", () => {
    const overlap = Object.keys(inlineLabelStyleSpecs).filter((t) => t in defaultStyleSpecs);
    expect(overlap).toEqual([]);
  });

  it("独自ブロックの spec は config を持つ（ファクトリのまま登録していない）", () => {
    for (const entry of customBlockEntries) {
      const spec = typeof entry.spec === "function" ? entry.spec() : entry.spec;
      expect(spec?.config?.type, entry.type).toBe(entry.type);
    }
  });
});
