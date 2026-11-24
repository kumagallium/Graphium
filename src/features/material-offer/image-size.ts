// 縮小図を作る前に、画像の寸法を頭の数バイトから読む（デコードしない）。
// 小さなファイルでも寸法が巨大な画像（単色の 60000×60000 の PNG など）は、デコードで画面の
// プロセスのメモリを使い切る。申し出は外の AI が置けるので、寸法の分かる形だけ縮小図にする。

/** 縮小図にしてよい画素数の上限 */
export const PREVIEW_MAX_PIXELS = 40_000_000;
/** 縮小図にしてよい 1 辺の上限 */
export const PREVIEW_MAX_SIDE = 16_384;

/** PNG・JPEG・GIF の寸法。読めない・ほかの形なら null */
export function imageDimensions(b: Uint8Array): { width: number; height: number } | null {
  const u32 = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  const u16le = (i: number) => b[i] | (b[i + 1] << 8);
  // PNG: 署名 8 バイト → IHDR（幅・高さ）
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    if (String.fromCharCode(b[12], b[13], b[14], b[15]) !== "IHDR") return null;
    return { width: u32(16), height: u32(20) };
  }
  // GIF: "GIF8" → 論理画面の幅・高さ（リトルエンディアン）
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
    return { width: u16le(6), height: u16le(8) };
  }
  // JPEG: SOI → マーカーをたどって SOF（0xC0〜0xCF、ただし C4・C8・CC を除く）
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      const len = u16be(i + 2);
      if (len < 2) return null;
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { width: u16be(i + 7), height: u16be(i + 5) };
      i += 2 + len;
    }
    return null;
  }
  return null;
}

/** 縮小図にしてよいか（寸法が読めて、上限の中） */
export function safeForPreview(b: Uint8Array): boolean {
  const d = imageDimensions(b);
  if (!d || d.width <= 0 || d.height <= 0) return false;
  if (d.width > PREVIEW_MAX_SIDE || d.height > PREVIEW_MAX_SIDE) return false;
  return d.width * d.height <= PREVIEW_MAX_PIXELS;
}
