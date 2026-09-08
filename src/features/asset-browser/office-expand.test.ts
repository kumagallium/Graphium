// PowerPoint (.pptx) / Excel (.xlsx) の「展開できる / 展開済み」判定のテスト
// 「まだ取り出していないものは、取り込みからでも素材の詳細からでも取り出せる」の土台

import { describe, expect, it } from "vitest";
import { canExpandOffice, hasExpandedOffice } from "./media-index";

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("canExpandOffice", () => {
  it("pptx は展開対象", () => {
    expect(canExpandOffice({ type: "document", mimeType: PPTX_MIME })).toBe(true);
  });

  it("xlsx は展開対象", () => {
    expect(canExpandOffice({ type: "document", mimeType: XLSX_MIME })).toBe(true);
  });

  it("docx は展開対象外（別の抽出経路がある）", () => {
    expect(canExpandOffice({ type: "document", mimeType: DOCX_MIME })).toBe(false);
  });

  it("pdf は展開対象外", () => {
    expect(canExpandOffice({ type: "pdf", mimeType: "application/pdf" })).toBe(false);
  });
});

describe("hasExpandedOffice", () => {
  it("pptx: 派生画像があれば展開済み", () => {
    const entry = { fileId: "pptx-1", type: "document" as const, mimeType: PPTX_MIME };
    const index = { media: [{ derivedFromAssets: ["pptx-1"] }] };
    expect(hasExpandedOffice(entry, index)).toBe(true);
  });

  it("pptx: 画像が無くても ocrText（スライド文字）が入っていれば展開済み", () => {
    const entry = { fileId: "pptx-1", type: "document" as const, mimeType: PPTX_MIME, ocrText: "--- slide 1 ---\nhello" };
    const index = { media: [] };
    expect(hasExpandedOffice(entry, index)).toBe(true);
  });

  it("pptx: 派生素材も ocrText も無ければ未展開", () => {
    const entry = { fileId: "pptx-1", type: "document" as const, mimeType: PPTX_MIME };
    const index = { media: [] };
    expect(hasExpandedOffice(entry, index)).toBe(false);
  });

  it("xlsx: 派生 CSV が無ければ未展開", () => {
    const entry = { fileId: "xlsx-1", type: "document" as const, mimeType: XLSX_MIME };
    const index = { media: [] };
    expect(hasExpandedOffice(entry, index)).toBe(false);
  });

  it("xlsx: 派生 CSV があれば展開済み", () => {
    const entry = { fileId: "xlsx-1", type: "document" as const, mimeType: XLSX_MIME };
    const index = { media: [{ derivedFromAssets: ["xlsx-1"] }] };
    expect(hasExpandedOffice(entry, index)).toBe(true);
  });
});
