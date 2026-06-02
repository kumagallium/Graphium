// Cytoscape の background-image 等で使う静止画サムネイル URL を作るヘルパー。
//
// 画像と動画でアプローチが違う:
//   - 画像: provider.getMediaBlobUrl(fileId) で取った blob URL をそのまま静止画として使う
//   - 動画: 一旦 blob URL を <video> に流し、最初のフレームを canvas に焼いて data URL を作る
//
// Cytoscape の "background-image" は image MIME のみ受け付けるため、動画ファイル URL を
// 直に渡しても表示できない。AssetGalleryView の VideoThumbnail（DOM の <video> 要素）と
// 同じ発想で、フレーム 1 枚を抜き出した data URL を返す。

import { getActiveProvider } from "../../lib/storage/registry";
import type { MediaIndexEntry, MediaType } from "./media-index";

/** 既存呼び出しのための薄いラッパー。MediaIndexEntry を直接受け取るバージョン。 */
export function isThumbnailable(entry: MediaIndexEntry): boolean {
  return entry.type === "image" || entry.type === "video";
}

/** resolveMediaThumbUrl が必要な最小限のフィールド（NoteNode からも呼べるよう抽象化）。 */
export type ThumbResolverInput = {
  type: MediaType | undefined;
  url: string;
  fileId: string;
};

/**
 * メディアアセットから Cytoscape で表示できる静止画 URL を作る。
 * 解決できない場合は null を返す（呼び出し側でアイコンフォールバック）。
 */
export async function resolveMediaThumbUrl(input: ThumbResolverInput): Promise<string | null> {
  const provider = getActiveProvider();
  const fileId = provider.extractFileId(input.url) ?? input.fileId;
  if (!fileId) return null;
  let blobUrl: string;
  try {
    blobUrl = await provider.getMediaBlobUrl(fileId);
  } catch {
    return null;
  }
  if (input.type === "image") return blobUrl;
  if (input.type === "video") return await captureVideoFrameDataUrl(blobUrl);
  return null;
}

/**
 * 動画 blob URL から先頭付近のフレームを 1 枚キャプチャして PNG data URL にする。
 *
 * 安定化のポイント:
 *   - `preload="auto"` でメタデータだけでなく実データもプリフェッチさせる
 *   - `loadedmetadata` 後に `currentTime = 0.1` を立てて `seeked` を待つ。先頭 0
 *     秒だと黒フレームしかない動画があるため、わずかにシークさせる
 *   - `crossOrigin` は付けない（同一オリジン扱いの blob URL に anonymous を付けると
 *     一部ブラウザで tainted canvas になり toDataURL が SecurityError を投げる）
 *   - 解像度は最長辺 240px に縮小、Cytoscape ノードに乗せるのにちょうど良いサイズ
 */
function captureVideoFrameDataUrl(videoBlobUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    // 描画させたいが UI には出したくないので画面外に置く
    video.style.position = "fixed";
    video.style.left = "-9999px";
    video.style.top = "-9999px";
    video.style.width = "1px";
    video.style.height = "1px";

    let settled = false;
    const cleanup = () => {
      try {
        video.removeAttribute("src");
        video.load();
      } catch {
        // ignore
      }
      if (video.parentNode) video.parentNode.removeChild(video);
    };
    const finish = (result: string | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const drawCurrentFrame = () => {
      try {
        const sw = video.videoWidth;
        const sh = video.videoHeight;
        if (!sw || !sh) {
          finish(null);
          return;
        }
        const MAX = 240;
        const scale = Math.min(1, MAX / Math.max(sw, sh));
        const w = Math.max(1, Math.round(sw * scale));
        const h = Math.max(1, Math.round(sh * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          finish(null);
          return;
        }
        ctx.drawImage(video, 0, 0, w, h);
        finish(canvas.toDataURL("image/png"));
      } catch {
        finish(null);
      }
    };

    video.addEventListener(
      "loadedmetadata",
      () => {
        try {
          // 先頭 0 秒は黒フレームのことがあるので少し前進してシーク。
          // 動画長より短い時間で安全側にクランプ。
          const target = Math.min(0.1, Math.max(0, (video.duration || 0) * 0.05));
          video.currentTime = target;
        } catch {
          // currentTime の代入が同期 throw した場合は seeked を待たず描画
          drawCurrentFrame();
        }
      },
      { once: true },
    );
    video.addEventListener("seeked", drawCurrentFrame, { once: true });
    video.addEventListener("error", () => finish(null), { once: true });
    // フォールバックタイムアウト（壊れた動画で永久に待たないため）
    setTimeout(() => finish(null), 8000);

    // DOM に挿入してから src を設定すると、Safari など一部ブラウザで
    // metadata イベントが安定して発火する
    document.body.appendChild(video);
    video.src = videoBlobUrl;
    video.load();
  });
}
