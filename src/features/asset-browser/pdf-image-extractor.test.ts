// embeddedImageToFile のユニットテスト。
// extractEmbeddedPdfImages 本体は pdfjs / canvas に依存するためここでは扱わない。

import { describe, it, expect } from "vitest";
import { embeddedImageToFile, type ExtractedEmbeddedImage } from "./pdf-image-extractor";

function makeImage(pageNumber: number, imageIndex: number): ExtractedEmbeddedImage {
  return {
    pageNumber,
    imageIndex,
    blob: new Blob([new Uint8Array([0])], { type: "image/png" }),
    width: 100,
    height: 200,
  };
}

describe("embeddedImageToFile", () => {
  it(".pdf 拡張子を除いてページ番号と画像番号付きの PNG ファイル名を作る", () => {
    const file = embeddedImageToFile(makeImage(3, 2), "paper.pdf");
    expect(file.name).toBe("paper - p3 image 2.png");
    expect(file.type).toBe("image/png");
  });

  it("大文字拡張子 .PDF も除去する", () => {
    const file = embeddedImageToFile(makeImage(1, 1), "REPORT.PDF");
    expect(file.name).toBe("REPORT - p1 image 1.png");
  });

  it(".pdf 以外の拡張子はそのまま残す（誤削除を防ぐ）", () => {
    const file = embeddedImageToFile(makeImage(7, 4), "notes.pdf.bak");
    expect(file.name).toBe("notes.pdf.bak - p7 image 4.png");
  });
});
