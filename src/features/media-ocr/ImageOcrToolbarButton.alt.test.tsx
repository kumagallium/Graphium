// @vitest-environment jsdom
// 画像ツールバーのボタン: PP-OCR の text が空で別の読み（altText）だけがある状態の見え方。
// 「0 文字」とは出さず、別の読みの欄だけを出す。コピーの対象は text だけ（alt は入れない）。

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ entry: undefined as undefined | Record<string, unknown> }));

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

const base = { confidence: 0, lang: "", extractedAt: "2026-01-01T00:00:00Z" };

describe("ImageOcrToolbarButton（text が空で altText だけあるとき）", () => {
  it("文字数のバッジ・コピーは出さず、別の読みの欄だけを出す", () => {
    h.entry = { ...base, text: "", altText: "焼結温度を上げた", altEngine: "apple-vision" };
    render(<ImageOcrToolbarButton blockId="b1" imageUrl="file-media://x" />);
    fireEvent.click(document.querySelector("[data-test=imageOcrButton]")!);
    expect(screen.getByText("焼結温度を上げた")).toBeTruthy();
    expect(screen.getByText("ocr.altReading")).toBeTruthy();
    expect(screen.queryByText(/ocr\.chars/)).toBeNull();
    expect(screen.queryByLabelText("ocr.copy")).toBeNull();
  });

  it("text があるときは従来どおり（文字数あり・コピーあり）", () => {
    h.entry = { ...base, text: "焼給 800", altText: "焼結 800" };
    render(<ImageOcrToolbarButton blockId="b1" imageUrl="file-media://x" />);
    fireEvent.click(document.querySelector("[data-test=imageOcrButton]")!);
    expect(screen.getByText("焼給 800")).toBeTruthy();
    expect(screen.getByLabelText("ocr.copy")).toBeTruthy();
  });
});
