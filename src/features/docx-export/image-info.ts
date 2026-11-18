// 画像バイト列から種類と縦横（px）を読む（純ロジック）
//
// Word に埋め込める PNG / JPEG / GIF / BMP だけを扱う。読めなければ null。
// docx は縦横を自分では読まないので、ここで先頭のヘッダから取る。

export type RasterImageInfo = {
  type: "png" | "jpg" | "gif" | "bmp";
  width: number;
  height: number;
};

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u32be = (b: Uint8Array, i: number) =>
  ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const i32le = (b: Uint8Array, i: number) =>
  (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) | 0;

function valid(w: number, h: number): boolean {
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 && w < 1e6 && h < 1e6;
}

function readPng(b: Uint8Array): RasterImageInfo | null {
  // 署名 8 + IHDR（長さ 4・種別 4・幅 4・高さ 4）
  if (b.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!sig.every((v, i) => b[i] === v)) return null;
  const width = u32be(b, 16);
  const height = u32be(b, 20);
  return valid(width, height) ? { type: "png", width, height } : null;
}

function readGif(b: Uint8Array): RasterImageInfo | null {
  if (b.length < 10) return null;
  if (!(b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38)) return null;
  const width = u16le(b, 6);
  const height = u16le(b, 8);
  return valid(width, height) ? { type: "gif", width, height } : null;
}

function readBmp(b: Uint8Array): RasterImageInfo | null {
  if (b.length < 26) return null;
  if (!(b[0] === 0x42 && b[1] === 0x4d)) return null;
  const headerSize = i32le(b, 14) >>> 0;
  let width: number;
  let height: number;
  if (headerSize === 12) {
    width = u16le(b, 18);
    height = u16le(b, 20);
  } else {
    width = i32le(b, 18);
    height = Math.abs(i32le(b, 22)); // 負は上から下の並び
  }
  return valid(width, height) ? { type: "bmp", width, height } : null;
}

function readJpeg(b: Uint8Array): RasterImageInfo | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    if (marker === 0xff) {
      i++; // 詰め物
      continue;
    }
    // 長さを持たないマーカー
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = u16be(b, i + 2);
    // SOF0〜SOF15（DHT=C4・JPG=C8・DAC=CC を除く）に縦横がある
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 8 >= b.length) return null;
      const height = u16be(b, i + 5);
      const width = u16be(b, i + 7);
      return valid(width, height) ? { type: "jpg", width, height } : null;
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

/** PNG / JPEG / GIF / BMP の種類と縦横を読む。読めなければ null */
export function readImageInfo(bytes: Uint8Array): RasterImageInfo | null {
  try {
    return readPng(bytes) ?? readJpeg(bytes) ?? readGif(bytes) ?? readBmp(bytes);
  } catch {
    return null;
  }
}
