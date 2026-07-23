// EMF (Windows Enhanced Metafile) をブラウザで表示可能な画像 File に変換する。
//
// 研究文書の .docx には EMF 画像が頻出する（Excel/PowerPoint グラフの
// 「図として貼り付け」、VESTA/Origin 等からのコピペ）。EMF はブラウザの
// <img> で表示できないため、従来はスキップしていた。ここでは 2 系統で変換する:
//
// 1. bitmap ラップ型（STRETCHDIBITS / BITBLT が本体）
//    スクリーンショットや「図として貼り付け」た画像。埋め込まれた DIB を
//    そのまま BMP に組み立て、canvas 経由で PNG 化する。品質劣化なし。
//
// 2. ベクター型（POLYLINE16 / LINETO / EXTTEXTOUTW が本体）
//    Excel グラフ等。rtf.js の EMFJS で SVG 化するが、EMFJS は
//    SETWORLDTRANSFORM / MODIFYWORLDTRANSFORM / EXTTEXTOUTW 等を未実装のまま
//    無視するため、そのままでは座標が合わず文字も出ない。ここでは
//    - XFORM 行列を自前でパースして viewBox を world 座標系に補正
//    - stroke 系要素へ fill="none" を後付け（SVG の fill 既定は black のため）
//    - EXTTEXTOUTW を自前でパースして <text> レイヤーを追加
//    することで補う。world transform が回転を含む場合は補正不能として諦める
//    （Office 由来の EMF は scale+translate のみが実質全て）。
//
// EMF レコードの構造: 先頭から { iType: u32, nSize: u32, ... } の繰り返し。
// 仕様は MS-EMF (https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-emf)。
//
// rtf.js (EMFJS) はベクター型の描画時のみ dynamic import で遅延ロードする
// （バンドル ~100KB を通常起動パスに載せない。DIB 抽出やテストでは不要）。

/** EMF の MIME か（.docx の Content_Types は image/x-emf を使う） */
export function isEmfMime(mime: string): boolean {
  const m = mime.toLowerCase();
  return m === "image/x-emf" || m === "image/emf" || m === "image/x-mgx-emf";
}

// ---------------------------------------------------------------------------
// レコード走査の共通ヘルパ
// ---------------------------------------------------------------------------

const EMR = {
  HEADER: 1,
  EOF: 14,
  SETTEXTALIGN: 22,
  SETTEXTCOLOR: 24,
  SETWORLDTRANSFORM: 35,
  MODIFYWORLDTRANSFORM: 36,
  SELECTOBJECT: 37,
  BITBLT: 76,
  STRETCHDIBITS: 81,
  EXTCREATEFONTINDIRECTW: 82,
  EXTTEXTOUTA: 83,
  EXTTEXTOUTW: 84,
} as const;

/** EMF レコードを順に走査する。callback が false を返したら打ち切り */
function scanRecords(
  buf: ArrayBuffer,
  callback: (iType: number, offset: number, size: number, dv: DataView) => void | false,
): void {
  const dv = new DataView(buf);
  let off = 0;
  // 壊れたファイルでの無限ループ防止（レコード数上限は実用上十分大きく取る）
  let guard = 0;
  while (off + 8 <= buf.byteLength && guard++ < 500000) {
    const iType = dv.getUint32(off, true);
    const nSize = dv.getUint32(off + 4, true);
    if (nSize < 8 || off + nSize > buf.byteLength) break;
    if (callback(iType, off, nSize, dv) === false) break;
    if (iType === EMR.EOF) break;
    off += nSize;
  }
}

/** EMF ヘッダー（EMR_HEADER）か */
function isEmfHeader(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 88) return false;
  const dv = new DataView(buf);
  // iType=1 かつ dSignature=" EMF" (0x464D4520)
  return dv.getUint32(0, true) === 1 && dv.getUint32(40, true) === 0x464d4520;
}

type EmfHeader = {
  /** 描画範囲（デバイス座標） */
  boundsL: number;
  boundsT: number;
  boundsR: number;
  boundsB: number;
  /** 実寸（0.01mm 単位） */
  frameW: number;
  frameH: number;
};

function parseEmfHeader(buf: ArrayBuffer): EmfHeader {
  const dv = new DataView(buf);
  return {
    boundsL: dv.getInt32(8, true),
    boundsT: dv.getInt32(12, true),
    boundsR: dv.getInt32(16, true),
    boundsB: dv.getInt32(20, true),
    frameW: dv.getInt32(32, true) - dv.getInt32(24, true),
    frameH: dv.getInt32(36, true) - dv.getInt32(28, true),
  };
}

// ---------------------------------------------------------------------------
// 系統 1: bitmap ラップ型 — DIB 抽出
// ---------------------------------------------------------------------------

type DibEntry = { cbBits: number; bmp: Uint8Array<ArrayBuffer> };

/**
 * STRETCHDIBITS / BITBLT レコードから DIB (BITMAPINFO + ピクセル) を取り出し、
 * BMP ファイルのバイト列に組み立てる。複数ある場合は最大のものを返す
 * （小さい DIB は背景塗りつぶし等のことが多い）。
 */
export function extractLargestDibAsBmp(buf: ArrayBuffer): Uint8Array<ArrayBuffer> | null {
  const dibs: DibEntry[] = [];
  scanRecords(buf, (iType, off, _size, dv) => {
    // offBmiSrc/cbBmiSrc/offBitsSrc/cbBitsSrc のレコード内オフセット
    // STRETCHDIBITS: 48/52/56/60, BITBLT: 84/88/92/96 (MS-EMF §2.3.1)
    let base: number | null = null;
    if (iType === EMR.STRETCHDIBITS) base = 48;
    else if (iType === EMR.BITBLT) base = 84;
    if (base === null) return;
    const offBmi = dv.getUint32(off + base, true);
    const cbBmi = dv.getUint32(off + base + 4, true);
    const offBits = dv.getUint32(off + base + 8, true);
    const cbBits = dv.getUint32(off + base + 12, true);
    if (cbBmi <= 0 || cbBits <= 0) return;
    if (off + offBmi + cbBmi > buf.byteLength) return;
    if (off + offBits + cbBits > buf.byteLength) return;
    // BMP file header (14 bytes) + BITMAPINFO + bits
    const fileSize = 14 + cbBmi + cbBits;
    const bmp = new Uint8Array(fileSize);
    const bdv = new DataView(bmp.buffer);
    bmp[0] = 0x42; // 'B'
    bmp[1] = 0x4d; // 'M'
    bdv.setUint32(2, fileSize, true);
    bdv.setUint32(10, 14 + cbBmi, true); // ピクセルデータ開始位置
    bmp.set(new Uint8Array(buf, off + offBmi, cbBmi), 14);
    bmp.set(new Uint8Array(buf, off + offBits, cbBits), 14 + cbBmi);
    dibs.push({ cbBits, bmp });
  });
  if (dibs.length === 0) return null;
  dibs.sort((a, b) => b.cbBits - a.cbBits);
  return dibs[0].bmp;
}

// ---------------------------------------------------------------------------
// 系統 2: ベクター型 — world transform / テキストの自前パース
// ---------------------------------------------------------------------------

type Xform = { m11: number; m12: number; m21: number; m22: number; dx: number; dy: number };

const IDENTITY: Xform = { m11: 1, m12: 0, m21: 0, m22: 1, dx: 0, dy: 0 };

/** a × b（GDI の XFORM は行ベクトル規約: p' = p × M） */
function multiplyXform(a: Xform, b: Xform): Xform {
  return {
    m11: a.m11 * b.m11 + a.m12 * b.m21,
    m12: a.m11 * b.m12 + a.m12 * b.m22,
    m21: a.m21 * b.m11 + a.m22 * b.m21,
    m22: a.m21 * b.m12 + a.m22 * b.m22,
    dx: a.dx * b.m11 + a.dy * b.m21 + b.dx,
    dy: a.dx * b.m12 + a.dy * b.m22 + b.dy,
  };
}

/**
 * SETWORLDTRANSFORM / MODIFYWORLDTRANSFORM を合成した最終行列を返す。
 * Office 由来の EMF は冒頭で 1 回設定するのが実質全てなので、
 * 「最後に有効だった行列」を全描画に適用される行列とみなす。
 */
export function composeWorldTransform(buf: ArrayBuffer): Xform {
  let m: Xform = { ...IDENTITY };
  scanRecords(buf, (iType, off, _size, dv) => {
    if (iType !== EMR.SETWORLDTRANSFORM && iType !== EMR.MODIFYWORLDTRANSFORM) return;
    const x: Xform = {
      m11: dv.getFloat32(off + 8, true),
      m12: dv.getFloat32(off + 12, true),
      m21: dv.getFloat32(off + 16, true),
      m22: dv.getFloat32(off + 20, true),
      dx: dv.getFloat32(off + 24, true),
      dy: dv.getFloat32(off + 28, true),
    };
    if (iType === EMR.SETWORLDTRANSFORM) {
      m = x;
      return;
    }
    const mode = dv.getUint32(off + 32, true);
    if (mode === 1) m = { ...IDENTITY }; // MWT_IDENTITY
    else if (mode === 2) m = multiplyXform(x, m); // MWT_LEFTMULTIPLY
    else if (mode === 3) m = multiplyXform(m, x); // MWT_RIGHTMULTIPLY
    else if (mode === 4) m = x; // MWT_SET
  });
  return m;
}

export type EmfTextRun = {
  x: number;
  y: number;
  text: string;
  /** フォント高さ（論理単位、負値は em height） */
  fontHeight: number;
  fontFace: string;
  italic: boolean;
  weight: number;
  color: string;
  /** GDI の TA_* フラグ */
  align: number;
};

/**
 * Symbol フォント（lfCharSet=SYMBOL_CHARSET）の文字コード → Unicode 変換。
 * Symbol フォントの文字列は ASCII コードでグリフを直接指す（'q'=θ, 'a'=α 等）ため、
 * そのまま出すと豆腐になる。研究文書で頻出するギリシャ文字と主要記号を変換する。
 * （Adobe Symbol encoding のうち実用部分。表に無い文字はそのまま残す）
 */
const SYMBOL_TO_UNICODE: Record<string, string> = {
  A: "Α", B: "Β", G: "Γ", D: "Δ", E: "Ε", Z: "Ζ", H: "Η", Q: "Θ", I: "Ι",
  K: "Κ", L: "Λ", M: "Μ", N: "Ν", X: "Ξ", O: "Ο", P: "Π", R: "Ρ", S: "Σ",
  T: "Τ", U: "Υ", F: "Φ", C: "Χ", Y: "Ψ", W: "Ω",
  a: "α", b: "β", g: "γ", d: "δ", e: "ε", z: "ζ", h: "η", q: "θ", i: "ι",
  k: "κ", l: "λ", m: "μ", n: "ν", x: "ξ", o: "ο", p: "π", r: "ρ", s: "σ",
  t: "τ", u: "υ", f: "φ", c: "χ", y: "ψ", w: "ω",
  J: "ϑ", j: "ϕ", V: "ς", v: "ϖ",
  "\xB0": "°", "\xB1": "±", "\xB4": "×", "\xB8": "÷", "\xD6": "√",
  "\xA5": "∞", "\xBB": "≈", "\xB9": "≠", "\xA3": "≤", "\xB3": "≥",
  "\xAE": "→", "\xAC": "←", "\xAD": "↑", "\xAF": "↓", "\xD7": "⋅",
  "\xB7": "·", "\xC5": "⊕", "\xC4": "⊗", "\xD8": "¬", "\xD5": "∏",
  "\xE5": "∑", "\xF2": "∫", "\xB6": "∂", "\xD1": "∇", "\xCE": "∈",
};

function symbolToUnicode(text: string): string {
  let out = "";
  for (const ch of text) {
    let c = ch;
    const code = ch.charCodeAt(0);
    // Windows は Symbol グリフを U+F000 + コードの Private Use Area で記録する
    // ことが多い（0xF071 = 'q' = θ）。まず生コードに正規化してから変換する。
    if (code >= 0xf000 && code <= 0xf0ff) c = String.fromCharCode(code - 0xf000);
    out += SYMBOL_TO_UNICODE[c] ?? c;
  }
  return out;
}

/**
 * EXTTEXTOUTW / EXTTEXTOUTA からテキスト描画命令を取り出す。
 * EMFJS が EXTTEXTOUT 系を未実装のため、SVG <text> レイヤーの材料にする。
 * フォント・色・アラインは直前の EXTCREATEFONTINDIRECTW / SELECTOBJECT /
 * SETTEXTCOLOR / SETTEXTALIGN を線形に追跡する（SAVEDC/RESTOREDC の
 * 状態復元までは追わない簡易版。軸ラベル用途には十分）。
 */
export function extractTextRuns(buf: ArrayBuffer): EmfTextRun[] {
  type FontDef = { height: number; face: string; italic: boolean; weight: number; symbol: boolean };
  const fonts = new Map<number, FontDef>();
  let curFont: FontDef | null = null;
  let curColor = "#000000";
  let curAlign = 0;
  const runs: EmfTextRun[] = [];

  scanRecords(buf, (iType, off, size, dv) => {
    if (iType === EMR.EXTCREATEFONTINDIRECTW && size >= 104) {
      const ih = dv.getUint32(off + 8, true);
      const height = dv.getInt32(off + 12, true);
      const weight = dv.getInt32(off + 28, true);
      const italic = dv.getUint8(off + 32) !== 0;
      const charSet = dv.getUint8(off + 35); // SYMBOL_CHARSET = 2
      // LOGFONT.FaceName: UTF-16LE 固定 32 文字（null 終端）
      let face = "";
      for (let i = 0; i < 32; i++) {
        const c = dv.getUint16(off + 40 + i * 2, true);
        if (c === 0) break;
        face += String.fromCharCode(c);
      }
      fonts.set(ih, { height, face, italic, weight, symbol: charSet === 2 });
    } else if (iType === EMR.SELECTOBJECT) {
      const ih = dv.getUint32(off + 8, true);
      const f = fonts.get(ih);
      if (f) curFont = f;
    } else if (iType === EMR.SETTEXTCOLOR) {
      const cr = dv.getUint32(off + 8, true); // COLORREF は 0x00BBGGRR
      const r = cr & 0xff;
      const g = (cr >> 8) & 0xff;
      const b = (cr >> 16) & 0xff;
      curColor = `rgb(${r},${g},${b})`;
    } else if (iType === EMR.SETTEXTALIGN) {
      curAlign = dv.getUint32(off + 8, true);
    } else if (iType === EMR.EXTTEXTOUTW || iType === EMR.EXTTEXTOUTA) {
      const isWide = iType === EMR.EXTTEXTOUTW;
      // EMR_EXTTEXTOUTW: Bounds(8..24), iGraphicsMode(24), exScale(28), eyScale(32),
      // EmrText(36..): Reference(36,40), Chars(44), offString(48), Options(52)
      if (size < 76) return;
      const refX = dv.getInt32(off + 36, true);
      const refY = dv.getInt32(off + 40, true);
      const chars = dv.getUint32(off + 44, true);
      const offString = dv.getUint32(off + 48, true);
      const options = dv.getUint32(off + 52, true);
      // ETO_GLYPH_INDEX: 文字列がグリフ番号で文字に復元できないため捨てる
      if (options & 0x10) return;
      const bytes = isWide ? chars * 2 : chars;
      if (chars === 0 || chars > 10000 || off + offString + bytes > buf.byteLength) return;
      let text = "";
      for (let i = 0; i < chars; i++) {
        const c = isWide
          ? dv.getUint16(off + offString + i * 2, true)
          : dv.getUint8(off + offString + i);
        text += String.fromCharCode(c);
      }
      if (text.trim().length === 0) return;
      // Symbol フォントはグリフ直指しのコードなので Unicode に変換し、
      // フォント指定は通常フォントに落とす（Symbol 指定のままだと環境依存で豆腐化）
      const isSymbol = curFont?.symbol ?? false;
      runs.push({
        x: refX,
        y: refY,
        text: isSymbol ? symbolToUnicode(text) : text,
        fontHeight: curFont?.height ?? -200,
        fontFace: isSymbol ? "serif" : (curFont?.face ?? "sans-serif"),
        italic: curFont?.italic ?? false,
        weight: curFont?.weight ?? 400,
        color: curColor,
        align: curAlign,
      });
    }
  });
  return runs;
}

/** GDI の TA_* フラグを SVG の text-anchor に変換 */
function textAnchorOf(align: number): string {
  if (align & 0x6) return align & 0x2 ? "end" : "middle"; // TA_CENTER=6 / TA_RIGHT=2
  return "start";
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * ベクター型 EMF を EMFJS で SVG 化し、未実装レコードの穴を後処理で補う。
 * 描画要素がゼロ（EMFJS が全レコードを無視した等）なら null。
 * DOM (document) が必要なのでブラウザ専用。
 */
export async function renderVectorEmfToSvg(buf: ArrayBuffer): Promise<string | null> {
  const hdr = parseEmfHeader(buf);
  const boundsW = hdr.boundsR - hdr.boundsL;
  const boundsH = hdr.boundsB - hdr.boundsT;
  if (boundsW <= 0 || boundsH <= 0 || hdr.frameW <= 0 || hdr.frameH <= 0) return null;

  // world transform を逆算して「EMFJS が出力する座標系（= world 座標のまま）」
  // での表示範囲を求める。回転成分があると viewBox 補正では直せないので断念。
  const m = composeWorldTransform(buf);
  if (Math.abs(m.m12) > 1e-6 || Math.abs(m.m21) > 1e-6) return null;
  const sx = m.m11 !== 0 ? m.m11 : 1;
  const sy = m.m22 !== 0 ? m.m22 : 1;
  const wx0 = (hdr.boundsL - m.dx) / sx;
  const wy0 = (hdr.boundsT - m.dy) / sy;
  const wx1 = (hdr.boundsR - m.dx) / sx;
  const wy1 = (hdr.boundsB - m.dy) / sy;
  const vbX = Math.min(wx0, wx1);
  const vbY = Math.min(wy0, wy1);
  const vbW = Math.abs(wx1 - wx0);
  const vbH = Math.abs(wy1 - wy0);
  if (vbW <= 0 || vbH <= 0) return null;

  // 表示サイズは実寸（0.01mm → px @96dpi）
  const wPx = Math.max(1, Math.round((hdr.frameW / 100) * (96 / 25.4)));
  const hPx = Math.max(1, Math.round((hdr.frameH / 100) * (96 / 25.4)));

  // UMD バンドルの CJS interop はバンドラ経路で default / モジュール直と揺れる
  // ため、両対応で受ける（dev: esbuild 事前バンドル、build: Rollup commonjs）。
  const mod = await import("rtf.js/dist/EMFJS.bundle.js");
  const EMFJS = (mod as { default?: typeof mod.default }).default ?? (mod as unknown as NonNullable<typeof mod.default>);
  if (!EMFJS?.Renderer) return null;
  EMFJS.loggingEnabled(false);
  const renderer = new EMFJS.Renderer(buf);
  // wExt/hExt と xExt/yExt を同値にして identity mapping で再生させ、
  // 出力座標 = 論理座標のまま viewBox でスケールする
  const svg = renderer.render({
    width: `${wPx}px`,
    height: `${hPx}px`,
    wExt: vbW,
    hExt: vbH,
    xExt: vbW,
    yExt: vbH,
    mapMode: 8, // MM_ANISOTROPIC
  });
  if (!svg) return null;

  // EMFJS は stroke 系要素に fill を付けないことがあり、SVG の fill 既定値
  // (black) で塗り潰されてしまう。明示的に fill="none" を補う。
  svg.querySelectorAll("polyline, line, path").forEach((el) => {
    if (!el.hasAttribute("fill")) el.setAttribute("fill", "none");
  });

  // viewBox を world 座標系に差し替える。EMFJS は内側にも <svg> を
  // 入れ子にする（SAVEDC 等の区切り）ため、内側もまとめて補正する。
  const viewBox = `${vbX} ${vbY} ${vbW} ${vbH}`;
  svg.setAttribute("viewBox", viewBox);
  svg.querySelectorAll("svg").forEach((inner) => {
    inner.setAttribute("viewBox", viewBox);
    inner.removeAttribute("x");
    inner.removeAttribute("y");
  });

  // EXTTEXTOUT 系は EMFJS 未実装。自前パースした <text> レイヤーを重ねる。
  const textRuns = extractTextRuns(buf);
  let textCount = 0;
  if (textRuns.length > 0) {
    const layer = document.createElementNS(SVG_NS, "g");
    for (const run of textRuns) {
      const t = document.createElementNS(SVG_NS, "text");
      t.setAttribute("x", String(run.x));
      t.setAttribute("y", String(run.y));
      t.setAttribute("font-size", String(Math.abs(run.fontHeight)));
      t.setAttribute("font-family", `'${run.fontFace}', sans-serif`);
      t.setAttribute("fill", run.color);
      const anchor = textAnchorOf(run.align);
      if (anchor !== "start") t.setAttribute("text-anchor", anchor);
      if (run.italic) t.setAttribute("font-style", "italic");
      if (run.weight >= 600) t.setAttribute("font-weight", "bold");
      // TA_BASELINE(24) 以外（TOP 基準等）は em 高さ分だけベースラインを下げる
      if ((run.align & 24) !== 24) t.setAttribute("dominant-baseline", "hanging");
      t.textContent = run.text;
      layer.appendChild(t);
      textCount++;
    }
    svg.appendChild(layer);
  }

  // 品質ゲート: 何も描けていない SVG（空白画像）は保存しない
  const drawn = svg.querySelectorAll("polyline, line, path, polygon, rect, ellipse, circle, image").length;
  if (drawn === 0 && textCount === 0) return null;

  svg.setAttribute("xmlns", SVG_NS);
  return new XMLSerializer().serializeToString(svg);
}

// ---------------------------------------------------------------------------
// 統合エントリ
// ---------------------------------------------------------------------------

/** BMP バイト列を canvas 経由で PNG Blob に変換（ブラウザの BMP デコーダを利用） */
async function bmpToPngBlob(bmp: Uint8Array<ArrayBuffer>): Promise<Blob | null> {
  const url = URL.createObjectURL(new Blob([bmp], { type: "image/bmp" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("BMP decode failed"));
      img.src = url;
    });
    if (img.naturalWidth === 0 || img.naturalHeight === 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * EMF を表示可能な画像 File に変換する。
 * - bitmap ラップ型 → PNG（無圧縮 DIB を PNG に再圧縮）
 * - ベクター型 → SVG（テキスト・拡大に強い）
 * - 変換不能（EMF でない / 対応外レコード構成）→ null
 */
export async function convertEmfToImageFile(
  buf: ArrayBuffer,
  baseName: string,
): Promise<File | null> {
  if (!isEmfHeader(buf)) return null;

  try {
    // bitmap ラップ型を優先（DIB があるならそれが本体で、ベクターは飾りが多い）
    const bmp = extractLargestDibAsBmp(buf);
    if (bmp) {
      const png = await bmpToPngBlob(bmp);
      if (png) {
        return new File([png], `${baseName}.png`, { type: "image/png" });
      }
    }

    const svg = await renderVectorEmfToSvg(buf);
    if (svg) {
      return new File([svg], `${baseName}.svg`, { type: "image/svg+xml" });
    }
  } catch (err) {
    console.warn("[emf-to-image] EMF 変換失敗:", err);
  }
  return null;
}
