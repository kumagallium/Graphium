// 捕獲サムネイル（縮小 JPEG）の生成。
//
// 捕獲履歴（queue.ts）は送信が終わった時点で blob を捨てる（端末の容量を
// 捕獲物で埋めないため）。それでも履歴の行に「何を撮ったか」が残るよう、
// enqueue の時点で長辺 THUMBNAIL_MAX_EDGE px の JPEG を焼いて別フィールドに
// 持たせる。数十 KB なので 100 件残しても実害がない。
//
// 生成できない場合（画像でない / 大きすぎる / canvas が無い環境 / デコード失敗）は
// **null を返すだけ**で、例外は投げない。サムネは表示上の贅沢であって履歴レコードの
// 成立条件ではない — 呼び出し側は種別アイコンに倒す。
// 動画のフレーム抽出はしない（コストと権限の割に得るものが少ない。種別アイコン）。

/** 縮小後の長辺（px）。 */
export const THUMBNAIL_MAX_EDGE = 200;
/** JPEG 品質。0.7 で長辺 200px なら数十 KB に収まる。 */
export const THUMBNAIL_QUALITY = 0.7;
/** これより大きい元画像は焼かない（デコードコストが読めない）。 */
export const THUMBNAIL_SOURCE_MAX_BYTES = 20 * 1024 * 1024;

/** 長辺を THUMBNAIL_MAX_EDGE に収める寸法（縦横比は保つ。拡大はしない）。 */
function fitEdge(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= 0) return { width: 1, height: 1 };
  if (longest <= THUMBNAIL_MAX_EDGE) return { width, height };
  const scale = THUMBNAIL_MAX_EDGE / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** createImageBitmap + OffscreenCanvas 経路（メインスレッドを長く止めない）。 */
async function viaImageBitmap(blob: Blob): Promise<Blob | null> {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined") {
    return null;
  }
  let bitmap: ImageBitmap;
  try {
    // iOS の写真は EXIF 回転を持つ。オプション非対応の環境では素の呼び出しに落とす
    bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    bitmap = await createImageBitmap(blob);
  }
  try {
    const { width, height } = fitEdge(bitmap.width, bitmap.height);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);
    return await canvas.convertToBlob({ type: "image/jpeg", quality: THUMBNAIL_QUALITY });
  } finally {
    bitmap.close?.();
  }
}

/** DOM canvas 経路（OffscreenCanvas / convertToBlob が無い WebView 用のフォールバック）。 */
function viaHtmlImage(blob: Blob): Promise<Blob | null> {
  if (typeof document === "undefined" || typeof URL?.createObjectURL !== "function") {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const { width, height } = fitEdge(
          img.naturalWidth || img.width,
          img.naturalHeight || img.height,
        );
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((out) => resolve(out), "image/jpeg", THUMBNAIL_QUALITY);
      } catch {
        resolve(null);
      } finally {
        // drawImage は同期で済んでいるので、toBlob のコールバック前に revoke してよい
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

/**
 * 画像 Blob から履歴用サムネイル（長辺 200px の JPEG）を作る。
 * 画像でない・大きすぎる・作れない環境では null（呼び出し側はアイコン表示）。
 */
export async function createCaptureThumbnail(
  blob: Blob,
  mime: string = blob.type,
): Promise<Blob | null> {
  if (!mime.startsWith("image/")) return null;
  if (blob.size > THUMBNAIL_SOURCE_MAX_BYTES) return null;
  try {
    const bitmapThumb = await viaImageBitmap(blob);
    if (bitmapThumb) return bitmapThumb;
  } catch {
    // デコード失敗・convertToBlob 非対応 → DOM canvas 経路へ
  }
  try {
    return await viaHtmlImage(blob);
  } catch {
    return null;
  }
}
