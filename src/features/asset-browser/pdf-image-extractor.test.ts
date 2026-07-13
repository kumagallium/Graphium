// embeddedImageToFile のユニットテスト。
// extractEmbeddedPdfImages 本体は pdfjs / canvas に依存するためここでは扱わない。

import { describe, it, expect } from "vitest";
import {
  displayAreaFromMatrix,
  embeddedImageToFile,
  imageOrientationFromMatrix,
  type ExtractedEmbeddedImage,
} from "./pdf-image-extractor";

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

// 向き補正の符号をここで固定する。値は実 PDF 2 種から実測した CTM。
// この回帰テストが「今まで正しく出ていた画像を壊していないこと」を恒久的に守る。
// 符号を取り違えると、正常画像と反転画像のちょうど逆を補正してしまうため、
// 両ケースを必ず併記する。
describe("imageOrientationFromMatrix", () => {
  it("標準形（d>0, 軸並行）は no-op — 正立画像は不変", () => {
    // PSSb（正しい向き）で実測した CTM の代表値
    expect(imageOrientationFromMatrix([192.2, 0, 0, 148.4, 0, 0])).toEqual({
      flipX: false,
      flipY: false,
    });
    expect(imageOrientationFromMatrix([444.9, 0, 0, 487.7, 0, 0])).toEqual({
      flipX: false,
      flipY: false,
    });
  });

  it("d<0（軸並行）は縦反転で補正 — 反転画像だけ戻す", () => {
    // 79_JA201502（反転）で実測した CTM の代表値
    expect(imageOrientationFromMatrix([199.0, 0, 0, -253.0, 0, 0])).toEqual({
      flipX: false,
      flipY: true,
    });
    expect(imageOrientationFromMatrix([312.0, 0, 0, -120.0, 0, 0])).toEqual({
      flipX: false,
      flipY: true,
    });
  });

  it("a<0 は横反転で補正する", () => {
    expect(imageOrientationFromMatrix([-100, 0, 0, 100, 0, 0])).toEqual({
      flipX: true,
      flipY: false,
    });
  });

  it("回転・スキュー（b≠0 or c≠0）は判定せず no-op（過補正を避ける）", () => {
    expect(imageOrientationFromMatrix([0, 100, -100, 0, 0, 0])).toEqual({
      flipX: false,
      flipY: false,
    });
    // d<0 でも回転成分があれば触らない
    expect(imageOrientationFromMatrix([100, 5, 5, -100, 0, 0])).toEqual({
      flipX: false,
      flipY: false,
    });
  });
});

// 表示面積は |det| = |a·d − b·c|。回転・反転を通して不変であることをここで固定する。
// 軸並行の値は imageOrientationFromMatrix と同じ実測 CTM を流用している。
describe("displayAreaFromMatrix", () => {
  it("軸並行スケールは幅×高さ（pt²）", () => {
    expect(displayAreaFromMatrix([192.2, 0, 0, 148.4, 0, 0])).toBeCloseTo(28522.48, 1);
  });

  it("d<0（縦反転）でも面積は正", () => {
    expect(displayAreaFromMatrix([199.0, 0, 0, -253.0, 0, 0])).toBe(50347);
  });

  it("90 度回転でも面積は保存される", () => {
    expect(displayAreaFromMatrix([0, 100, -100, 0, 0, 0])).toBe(10000);
  });

  it("潰れた変換（det=0）は 0", () => {
    expect(displayAreaFromMatrix([100, 0, 0, 0, 0, 0])).toBe(0);
  });

  it("矢印・罫線パーツ相当（8pt 角）は図版と桁が分かれる", () => {
    expect(displayAreaFromMatrix([8, 0, 0, 8, 0, 0])).toBe(64);
  });
});
