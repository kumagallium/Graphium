// TIFF の同期デコード（utif2）。メインスレッドでは呼ばず、tiff-decode.worker.ts から使う。
// テストは検査側（isSafeTiff）と分けてこの関数を直接呼べる。
import * as UTIF from "utif2";
import type { TiffDecoded } from "./tiff-to-image";

/** 先頭ページを RGBA 8bit にデコードする。読めなければ null。 */
export function decodeTiffSync(buf: ArrayBuffer): TiffDecoded | null {
  // MakerNote の入れ子解析は表示に要らないので切る
  const ifds = (UTIF as unknown as {
    decode: (b: ArrayBuffer, prm: { parseMN: boolean; debug: boolean }) => ReturnType<typeof UTIF.decode>;
  }).decode(buf, { parseMN: false, debug: false });
  if (!ifds || ifds.length === 0) return null;
  // 先頭ページ（サムネイルが混在する TIFF もあるが、実用上は先頭が本体）
  const ifd = ifds[0];
  UTIF.decodeImage(buf, ifd);
  const rgba = UTIF.toRGBA8(ifd);
  if (!rgba || ifd.width <= 0 || ifd.height <= 0) return null;
  return { rgba, width: ifd.width, height: ifd.height };
}
