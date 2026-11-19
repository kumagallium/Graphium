// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

// pdf.js 本体は読み込まない（共通オプションの値だけ確かめる）
vi.mock("react-pdf", () => ({ pdfjs: { GlobalWorkerOptions: {}, version: "0" } }));

import { PDFJS_DOC_OPTIONS } from "./pdfjs-config";

describe("PDFJS_DOC_OPTIONS", () => {
  it("PDF 内の式を eval で実行させない", () => {
    expect(PDFJS_DOC_OPTIONS.isEvalSupported).toBe(false);
  });
});
