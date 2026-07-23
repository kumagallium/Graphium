// TIFF をブラウザで表示可能な PNG File に変換する。
// 研究文書では顕微鏡画像・スキャン図面などが TIFF で埋め込まれることがあるが、
// ブラウザの <img> は TIFF を表示できないため PNG に変換する。
// デコードは UTIF.js (utif2) に委ねる。マルチページ TIFF は先頭ページのみ。
// utif2 は TIFF に遭遇したときだけ dynamic import で遅延ロードする。

/** TIFF の MIME か */
export function isTiffMime(mime: string): boolean {
  const m = mime.toLowerCase();
  return m === "image/tiff" || m === "image/tif" || m === "image/x-tiff";
}

/** TIFF を PNG File に変換する。デコード不能なら null。ブラウザ専用（canvas 使用）。 */
export async function convertTiffToImageFile(
  buf: ArrayBuffer,
  baseName: string,
): Promise<File | null> {
  try {
    const UTIF = await import("utif2");
    const ifds = UTIF.decode(buf);
    if (!ifds || ifds.length === 0) return null;
    // 先頭ページ（サムネイルが混在する TIFF もあるが、実用上は先頭が本体）
    const ifd = ifds[0];
    UTIF.decodeImage(buf, ifd);
    const rgba = UTIF.toRGBA8(ifd);
    const width = ifd.width;
    const height = ifd.height;
    if (!rgba || width <= 0 || height <= 0) return null;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const imageData = ctx.createImageData(width, height);
    imageData.data.set(rgba);
    ctx.putImageData(imageData, 0, 0);

    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) return null;
    return new File([png], `${baseName}.png`, { type: "image/png" });
  } catch (err) {
    console.warn("[tiff-to-image] TIFF 変換失敗:", err);
    return null;
  }
}
