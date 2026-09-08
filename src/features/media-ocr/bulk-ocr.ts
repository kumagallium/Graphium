// 複数画像をまとめて OCR する実行器（純関数）
//
// 素材ギャラリーの一括読み取りと、投入口が取り込み直後に裏で走らせる読み取りの
// 両方から使う共通ロジック。もとは AssetGalleryView の handleBulkOcr にあった
// 逐次ループ・連続タイムアウト打ち切りをそのまま切り出したもので、挙動は変えていない。

import { runOcrForImage } from "./run-ocr";
import { persistOcrTextPatch } from "../asset-browser/media-index";
import { OcrTimeoutError } from "../../lib/ocr";

/** 一括 OCR を打ち切る連続タイムアウト回数 */
export const BULK_OCR_MAX_CONSECUTIVE_TIMEOUTS = 2;

export type BulkOcrTarget = { fileId: string; url: string; name: string };

export type BulkOcrProgress = {
  /** 残り件数（0 なら完了） */
  running: number;
  /** ここまでの抽出文字数の合計 */
  chars: number;
  /** 文字が取れなかった枚数 */
  empty: number;
  /** 読み取り自体に失敗した枚数（タイムアウト・画像を開けない等） */
  failed: number;
  /** 連続タイムアウトで打ち切ったか */
  aborted: boolean;
};

/**
 * 対象の画像を順に読み取り、素材インデックスへ書き戻す。
 *
 * 順次実行なのは media-index への書き戻しが競合しないようにするため
 * （一括削除・一括画像抽出と同じ理由）。OCR 自体も worker 1 つを直列で使う。
 * 連続でタイムアウト（宙吊り）したら、残りを 1 件ずつ待つのは無意味なので
 * 打ち切る。recognizeImage が 1 回目のタイムアウトで worker を作り直しているので、
 * 2 回続けば「作り直しても動かない」＝この環境では今は読めない、と判断する。
 */
export async function runBulkOcr(
  targets: BulkOcrTarget[],
  opts: { onProgress: (s: BulkOcrProgress) => void },
): Promise<BulkOcrProgress> {
  const total = targets.length;
  let chars = 0;
  let empty = 0;
  let failed = 0;
  let consecutiveTimeouts = 0;
  let aborted = false;

  opts.onProgress({ running: total, chars, empty, failed, aborted });

  for (const [i, target] of targets.entries()) {
    try {
      const result = await runOcrForImage(target.url);
      await persistOcrTextPatch(target.fileId, result.text);
      consecutiveTimeouts = 0;
      if (result.text) chars += result.text.replace(/\s/g, "").length;
      else empty += 1;
    } catch (err) {
      console.error("[bulk-ocr] OCR 失敗:", target.name, err);
      failed += 1;
      if (err instanceof OcrTimeoutError && ++consecutiveTimeouts >= BULK_OCR_MAX_CONSECUTIVE_TIMEOUTS) {
        aborted = true;
      }
    }
    opts.onProgress({ running: total - (i + 1), chars, empty, failed, aborted });
    if (aborted) break;
  }

  const result = { running: 0, chars, empty, failed, aborted };
  opts.onProgress(result);
  return result;
}
