// emf-to-image のパーサー系ユニットテスト。
// EMF バイナリはテスト内で合成する（実ファイルはユーザーデータのため
// リポジトリに含めない）。EMFJS を使うベクターレンダリングは DOM 依存の
// ため実機（ブラウザ）検証で担保し、ここではレコードパーサーを検証する。

import { describe, expect, it } from "vitest";
import {
  composeWorldTransform,
  extractDibDraws,
  extractTextRuns,
  isEmfMime,
} from "./emf-to-image";
import { isTiffMime } from "./tiff-to-image";
import { isRenderableImageMime } from "./renderable-image";

// ---------------------------------------------------------------------------
// 合成 EMF ビルダー
// ---------------------------------------------------------------------------

type RecordBytes = Uint8Array;

/** EMR_HEADER (88 bytes 最小形) */
function emfHeader(): RecordBytes {
  const b = new Uint8Array(88);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, 1, true); // iType = EMR_HEADER
  dv.setUint32(4, 88, true); // nSize
  // rclBounds = (0, 0, 100, 50) device px
  dv.setInt32(8, 0, true);
  dv.setInt32(12, 0, true);
  dv.setInt32(16, 100, true);
  dv.setInt32(20, 50, true);
  // rclFrame = (0, 0, 2646, 1323) 0.01mm ≒ 100x50px @96dpi
  dv.setInt32(24, 0, true);
  dv.setInt32(28, 0, true);
  dv.setInt32(32, 2646, true);
  dv.setInt32(36, 1323, true);
  dv.setUint32(40, 0x464d4520, true); // " EMF"
  return b;
}

/** EMR_EOF */
function emfEof(): RecordBytes {
  const b = new Uint8Array(20);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, 14, true);
  dv.setUint32(4, 20, true);
  return b;
}

/** EMR_STRETCHDIBITS: 2x2 の 24bit DIB を埋め込む */
function emfStretchDiBits(pixelSeed: number): RecordBytes {
  const bmiSize = 40; // BITMAPINFOHEADER のみ
  const bitsSize = 16; // 2px * 3byte = 6 → 4 バイト境界で 8/行 * 2 行
  const recSize = 80 + bmiSize + bitsSize;
  const b = new Uint8Array(recSize);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, 81, true); // EMR_STRETCHDIBITS
  dv.setUint32(4, recSize, true);
  dv.setInt32(24, 10, true); // xDest
  dv.setInt32(28, 20, true); // yDest
  dv.setInt32(40, 2, true); // cxSrc
  dv.setInt32(44, 2, true); // cySrc
  dv.setUint32(48, 80, true); // offBmiSrc
  dv.setUint32(52, bmiSize, true); // cbBmiSrc
  dv.setUint32(56, 80 + bmiSize, true); // offBitsSrc
  dv.setUint32(60, bitsSize, true); // cbBitsSrc
  dv.setInt32(72, 50, true); // cxDest
  dv.setInt32(76, 60, true); // cyDest
  // BITMAPINFOHEADER
  dv.setUint32(80, 40, true); // biSize
  dv.setInt32(84, 2, true); // biWidth
  dv.setInt32(88, 2, true); // biHeight
  dv.setUint16(92, 1, true); // biPlanes
  dv.setUint16(94, 24, true); // biBitCount
  // ピクセル（適当な値）
  for (let i = 0; i < bitsSize; i++) b[80 + bmiSize + i] = (pixelSeed + i) & 0xff;
  return b;
}

/** EMR_SETWORLDTRANSFORM / EMR_MODIFYWORLDTRANSFORM */
function emfXform(
  iType: 35 | 36,
  m: { m11: number; m12: number; m21: number; m22: number; dx: number; dy: number },
  mode?: number,
): RecordBytes {
  const size = iType === 35 ? 32 : 36;
  const b = new Uint8Array(size);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, iType, true);
  dv.setUint32(4, size, true);
  dv.setFloat32(8, m.m11, true);
  dv.setFloat32(12, m.m12, true);
  dv.setFloat32(16, m.m21, true);
  dv.setFloat32(20, m.m22, true);
  dv.setFloat32(24, m.dx, true);
  dv.setFloat32(28, m.dy, true);
  if (iType === 36) dv.setUint32(32, mode ?? 2, true);
  return b;
}

/** EMR_EXTCREATEFONTINDIRECTW（LOGFONT 最小形） */
function emfCreateFont(
  ihFont: number,
  height: number,
  face: string,
  charSet = 0,
  escapement = 0,
): RecordBytes {
  const size = 104 + 260; // 実ファイルは LOGFONTEXDV まで含み大きいが、パーサーは先頭しか読まない
  const b = new Uint8Array(size);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, 82, true);
  dv.setUint32(4, size, true);
  dv.setUint32(8, ihFont, true);
  dv.setInt32(12, height, true);
  dv.setInt32(20, escapement, true); // lfEscapement
  dv.setInt32(28, 400, true); // weight
  dv.setUint8(35, charSet); // lfCharSet
  for (let i = 0; i < Math.min(face.length, 31); i++) {
    dv.setUint16(40 + i * 2, face.charCodeAt(i), true);
  }
  return b;
}

/** EMR_SELECTOBJECT */
function emfSelectObject(ih: number): RecordBytes {
  const b = new Uint8Array(12);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, 37, true);
  dv.setUint32(4, 12, true);
  dv.setUint32(8, ih, true);
  return b;
}

/** EMR_SETTEXTCOLOR */
function emfSetTextColor(r: number, g: number, bch: number): RecordBytes {
  const b = new Uint8Array(12);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, 24, true);
  dv.setUint32(4, 12, true);
  dv.setUint32(8, r | (g << 8) | (bch << 16), true);
  return b;
}

/** EMR_EXTTEXTOUTW */
function emfTextOutW(x: number, y: number, text: string, options = 0): RecordBytes {
  const offString = 76;
  const size = offString + text.length * 2;
  const b = new Uint8Array(size);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, 84, true);
  dv.setUint32(4, size, true);
  dv.setInt32(36, x, true);
  dv.setInt32(40, y, true);
  dv.setUint32(44, text.length, true);
  dv.setUint32(48, offString, true);
  dv.setUint32(52, options, true);
  for (let i = 0; i < text.length; i++) dv.setUint16(offString + i * 2, text.charCodeAt(i), true);
  return b;
}

function buildEmf(...records: RecordBytes[]): ArrayBuffer {
  const total = records.reduce((a, r) => a + r.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const r of records) {
    out.set(r, off);
    off += r.length;
  }
  return out.buffer;
}

// ---------------------------------------------------------------------------

describe("isEmfMime / isTiffMime / isRenderableImageMime", () => {
  it("docx の Content_Types が使う MIME を判定できる", () => {
    expect(isEmfMime("image/x-emf")).toBe(true);
    expect(isEmfMime("image/emf")).toBe(true);
    expect(isTiffMime("image/tiff")).toBe(true);
    expect(isTiffMime("image/tif")).toBe(true);
    expect(isEmfMime("image/png")).toBe(false);
    expect(isTiffMime("image/x-emf")).toBe(false);
  });

  it("表示可能 MIME の判定は従来どおり", () => {
    expect(isRenderableImageMime("image/png")).toBe(true);
    expect(isRenderableImageMime("IMAGE/JPEG")).toBe(true);
    expect(isRenderableImageMime("image/x-emf")).toBe(false);
    expect(isRenderableImageMime("image/tiff")).toBe(false);
  });
});

describe("extractDibDraws", () => {
  it("STRETCHDIBITS から BMP と配置情報を取り出す", () => {
    const emf = buildEmf(emfHeader(), emfStretchDiBits(10), emfEof());
    const draws = extractDibDraws(emf);
    expect(draws).toHaveLength(1);
    const d = draws[0];
    // 配置情報（emfStretchDiBits が書いた値）
    expect(d).toMatchObject({ xDest: 10, yDest: 20, cxDest: 50, cyDest: 60, cxSrc: 2, cySrc: 2 });
    // BMP マジック "BM"
    expect(d.bmp[0]).toBe(0x42);
    expect(d.bmp[1]).toBe(0x4d);
    const dv = new DataView(d.bmp.buffer);
    // ファイルサイズ = 14 + 40 (BITMAPINFOHEADER) + 16 (bits)
    expect(dv.getUint32(2, true)).toBe(14 + 40 + 16);
    // ピクセルデータ開始 = 14 + 40
    expect(dv.getUint32(10, true)).toBe(54);
    // BITMAPINFOHEADER が保持されている
    expect(dv.getUint32(14, true)).toBe(40);
    expect(dv.getInt32(18, true)).toBe(2); // biWidth
  });

  it("複数 DIB は全部レコード順に取り出す（本体 + 座標軸オーバーレイ等）", () => {
    const first = emfStretchDiBits(1);
    const second = emfStretchDiBits(2);
    // 2 つ目は配置を変えておく（オーバーレイ想定）
    const sdv = new DataView(second.buffer);
    sdv.setInt32(24, 0, true); // xDest
    sdv.setInt32(28, 1505, true); // yDest
    const emf = buildEmf(emfHeader(), first, second, emfEof());
    const draws = extractDibDraws(emf);
    expect(draws).toHaveLength(2);
    expect(draws[0].xDest).toBe(10);
    expect(draws[1]).toMatchObject({ xDest: 0, yDest: 1505 });
  });

  it("DIB が無ければ空配列", () => {
    const emf = buildEmf(emfHeader(), emfEof());
    expect(extractDibDraws(emf)).toHaveLength(0);
  });

  it("DIB を持たない BITBLT（no-op ROP 等）は対象外", () => {
    // BITBLT レコード（cbBmi=0, cbBits=0 — 実物の DSTCOPY no-op と同じ形）
    const rec = new Uint8Array(100);
    const dv = new DataView(rec.buffer);
    dv.setUint32(0, 76, true); // EMR_BITBLT
    dv.setUint32(4, 100, true);
    const emf = buildEmf(emfHeader(), rec, emfEof());
    expect(extractDibDraws(emf)).toHaveLength(0);
  });

  it("バッファ外を指す壊れた DIB オフセットは無視する", () => {
    const rec = emfStretchDiBits(0);
    // offBitsSrc をバッファ外に書き換える
    new DataView(rec.buffer).setUint32(56, 100000, true);
    const emf = buildEmf(emfHeader(), rec, emfEof());
    expect(extractDibDraws(emf)).toHaveLength(0);
  });
});

describe("composeWorldTransform", () => {
  it("XFORM 未使用なら単位行列", () => {
    const emf = buildEmf(emfHeader(), emfEof());
    expect(composeWorldTransform(emf)).toEqual({ m11: 1, m12: 0, m21: 0, m22: 1, dx: 0, dy: 0 });
  });

  it("SETWORLDTRANSFORM は行列を置き換える", () => {
    const emf = buildEmf(
      emfHeader(),
      emfXform(35, { m11: 0.5, m12: 0, m21: 0, m22: 0.25, dx: 10, dy: 20 }),
      emfEof(),
    );
    const m = composeWorldTransform(emf);
    expect(m.m11).toBeCloseTo(0.5);
    expect(m.m22).toBeCloseTo(0.25);
    expect(m.dx).toBeCloseTo(10);
    expect(m.dy).toBeCloseTo(20);
  });

  it("MODIFYWORLDTRANSFORM (LEFTMULTIPLY) は scale を合成する", () => {
    // Excel 実物と同じパターン: SET(identity) → MODIFY(scale, LEFTMULTIPLY)
    const emf = buildEmf(
      emfHeader(),
      emfXform(35, { m11: 1, m12: 0, m21: 0, m22: 1, dx: 0, dy: 0 }),
      emfXform(36, { m11: 0.0637, m12: 0, m21: 0, m22: 0.0637, dx: 0, dy: 0 }, 2),
      emfEof(),
    );
    const m = composeWorldTransform(emf);
    expect(m.m11).toBeCloseTo(0.0637, 4);
    expect(m.m22).toBeCloseTo(0.0637, 4);
    expect(m.m12).toBe(0);
    expect(m.m21).toBe(0);
  });

  it("MWT_IDENTITY で単位行列に戻る", () => {
    const emf = buildEmf(
      emfHeader(),
      emfXform(35, { m11: 2, m12: 0, m21: 0, m22: 2, dx: 5, dy: 5 }),
      emfXform(36, { m11: 9, m12: 9, m21: 9, m22: 9, dx: 9, dy: 9 }, 1),
      emfEof(),
    );
    expect(composeWorldTransform(emf)).toEqual({ m11: 1, m12: 0, m21: 0, m22: 1, dx: 0, dy: 0 });
  });
});

describe("extractTextRuns", () => {
  it("フォント・色を追跡しつつ EXTTEXTOUTW を取り出す", () => {
    const emf = buildEmf(
      emfHeader(),
      emfCreateFont(3, -184, "Arial"),
      emfSelectObject(3),
      emfSetTextColor(255, 0, 0),
      emfTextOutW(120, 340, "Energy (eV)"),
      emfEof(),
    );
    const runs = extractTextRuns(emf);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      x: 120,
      y: 340,
      text: "Energy (eV)",
      fontHeight: -184,
      fontFace: "Arial",
      color: "rgb(255,0,0)",
    });
  });

  it("空白のみのテキストと ETO_GLYPH_INDEX は捨てる", () => {
    const emf = buildEmf(
      emfHeader(),
      emfTextOutW(0, 0, "  "),
      emfTextOutW(0, 0, "glyphs", 0x10),
      emfTextOutW(5, 5, "keep"),
      emfEof(),
    );
    const runs = extractTextRuns(emf);
    expect(runs).toHaveLength(1);
    expect(runs[0].text).toBe("keep");
  });

  it("Symbol フォント（charSet=2）はギリシャ文字を Unicode に変換する", () => {
    const emf = buildEmf(
      emfHeader(),
      emfCreateFont(2, -217, "Symbol", 2),
      emfSelectObject(2),
      emfTextOutW(10, 20, "q"), // Symbol の q = θ
      emfCreateFont(3, -217, "Arial", 0),
      emfSelectObject(3),
      emfTextOutW(30, 20, "q"), // 通常フォントの q はそのまま
      emfEof(),
    );
    const runs = extractTextRuns(emf);
    expect(runs).toHaveLength(2);
    expect(runs[0].text).toBe("θ");
    expect(runs[0].fontFace).toBe("serif"); // Symbol 指定は通常フォントに落とす
    expect(runs[1].text).toBe("q");
    expect(runs[1].fontFace).toBe("Arial");
  });

  it("Symbol フォントの PUA コード（U+F000 オフセット）も変換する", () => {
    // Windows 実物の EMF は θ を 0xF071（U+F000 + 'q'）で記録する
    const emf = buildEmf(
      emfHeader(),
      emfCreateFont(2, -217, "Symbol", 2),
      emfSelectObject(2),
      emfTextOutW(10, 20, ""), // θα
      emfEof(),
    );
    const runs = extractTextRuns(emf);
    expect(runs).toHaveLength(1);
    expect(runs[0].text).toBe("θα");
  });

  it("lfEscapement（縦書き軸タイトル等の回転角）を取り出す", () => {
    const emf = buildEmf(
      emfHeader(),
      emfCreateFont(4, -217, "Arial", 0, 900), // Excel Y 軸タイトルの 90° 回転
      emfSelectObject(4),
      emfTextOutW(678, 2748, "Energy (eV)"),
      emfEof(),
    );
    const runs = extractTextRuns(emf);
    expect(runs).toHaveLength(1);
    expect(runs[0].escapement).toBe(900);
  });

  it("ストックオブジェクト SELECTOBJECT でフォント追跡が壊れない", () => {
    const emf = buildEmf(
      emfHeader(),
      emfCreateFont(1, -300, "Times New Roman"),
      emfSelectObject(1),
      emfSelectObject(0x80000007), // ストックオブジェクト（フォント表に無い）
      emfTextOutW(1, 2, "abc"),
      emfEof(),
    );
    const runs = extractTextRuns(emf);
    expect(runs[0].fontFace).toBe("Times New Roman");
    expect(runs[0].fontHeight).toBe(-300);
  });
});
