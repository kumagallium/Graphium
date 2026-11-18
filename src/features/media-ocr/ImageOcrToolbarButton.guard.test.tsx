// @vitest-environment jsdom
// 画像ツールバーのボタン: 共有フォルダの他人のノートから型の違う値・巨大な値が来ても描画で投げない。

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { MAX_OCR_TEXT_CHARS } from "../../lib/ocr-text";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ entry: undefined as unknown }));

vi.mock("./store", () => ({
  useMediaOcrStore: () => ({ getEntry: () => h.entry, setEntry: vi.fn() }),
}));
vi.mock("./run-ocr", () => ({ runOcrForImage: vi.fn() }));
vi.mock("./mirror-to-media-index", () => ({ mirrorOcrToMediaIndex: vi.fn() }));
vi.mock("../../i18n", () => ({
  useT: () => (key: string, vars?: Record<string, string>) =>
    vars ? `${key}:${Object.values(vars).join(",")}` : key,
}));
vi.mock("../../ui/floating-position", () => ({
  useFloatingPlacement: () => ({ top: 0, left: 0, maxHeight: 300 }),
}));

import { ImageOcrToolbarButton } from "./ImageOcrToolbarButton";

afterEach(() => {
  cleanup();
  h.entry = undefined;
});

const draw = () => {
  render(<ImageOcrToolbarButton blockId="b1" imageUrl="file-media://x" />);
  fireEvent.click(document.querySelector("[data-test=imageOcrButton]")!);
};

describe("ImageOcrToolbarButton（信用できない mediaOcr）", () => {
  const base = { confidence: 0, lang: "", extractedAt: "" };
  for (const [name, v] of [["数値", 123], ["オブジェクト", {}], ["配列", ["x"]], ["null", null]] as const) {
    it(`text が ${name} でも投げず、読み取りボタンのまま`, () => {
      h.entry = { ...base, text: v, confidence: "88", altText: v };
      expect(draw).not.toThrow();
    });
  }
  it("エントリ自体が null・文字列でも投げない", () => {
    for (const e of [null, "abc", 5]) {
      h.entry = e;
      expect(draw).not.toThrow();
      cleanup();
    }
  });
  it("confidence が文字列なら確度は出さない", () => {
    h.entry = { ...base, text: "焼給", confidence: "88" };
    draw();
    expect(document.body.textContent).not.toContain("88%");
  });
  it("5 MB の text は上限で切って表示する", () => {
    h.entry = { ...base, text: "あ".repeat(5 * 1024 * 1024) };
    draw();
    expect(document.querySelector("pre")!.textContent!.length).toBe(MAX_OCR_TEXT_CHARS);
  });
});
