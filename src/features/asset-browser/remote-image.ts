// リモート画像をローカルメディアとして取り込むヘルパー（クライアント側）
//
// バイトは sidecar の /url/image-proxy 経由で取得する:
//   - クロスオリジン画像は canvas の cross-origin taint があるため、表示はできても
//     ブラウザから直接バイトを取り込めない
//   - /url/reader が既に行っている「任意ユーザー URL をサーバ側で fetch する」のと
//     同じ信頼レベルであり、新たな到達性を増やすものではない
//
// 永続コンテンツにリモート URL を書かないための共通入口でもある。og:image や
// leadImage の URL をそのままブロックに埋めると、ノートを開くたび・PDF 書き出しの
// たびに配信元（CDN / 計測ドメイン）へ取りに行くことになる。取り込み時に一度だけ
// 取得してローカルメディアに保存し、本文にはそのローカル URL だけを書く。

import { apiBase } from "../../lib/platform";

/**
 * 保存ファイル名を「URL のベース名 + MIME 由来の拡張子」で組み立てる。
 * URL 解析に失敗した / パス末尾が空のときは "image" にフォールバックする。
 */
export function remoteImageFileName(imageUrl: string, mimeType: string): string {
  const ext =
    (mimeType.split("/")[1] || "img").split("+")[0].replace(/[^a-z0-9]/gi, "").slice(0, 5) || "img";
  let base = "image";
  try {
    const path = new URL(imageUrl).pathname;
    const last = path.substring(path.lastIndexOf("/") + 1).replace(/\.[a-z0-9]+$/i, "");
    if (last) base = decodeURIComponent(last).replace(/[^\w.\- ]/g, "").slice(0, 40) || "image";
  } catch {
    /* URL 解析失敗時は既定名を使う */
  }
  return `${base}.${ext}`;
}

/**
 * リモート画像を image-proxy 経由で取得して File 化する。
 * 取得失敗・画像以外（HTML エラーページ等）は throw するので、呼び出し側で握る。
 */
export async function fetchRemoteImageAsFile(imageUrl: string): Promise<File> {
  const proxied = `${apiBase()}/url/image-proxy?url=${encodeURIComponent(imageUrl)}`;
  const res = await fetch(proxied);
  if (!res.ok) throw new Error(`image-proxy ${res.status}`);
  const blob = await res.blob();
  if (!blob.type.startsWith("image/")) throw new Error("not an image");
  return new File([blob], remoteImageFileName(imageUrl, blob.type), { type: blob.type });
}

/**
 * リモート画像を取得してメディアプロバイダへ保存し、ローカル URL と保存名を返す。
 *
 * 取得・保存のどこかで失敗したら null を返す（ベストエフォート）。呼び出し側は
 * リモート URL へフォールバックせず画像ごと諦めること —— 永続コンテンツに外部 URL を
 * 残さないのがこの経路の目的で、フォールバックするとその目的が崩れる。
 */
export async function saveRemoteImageAsMedia(
  imageUrl: string,
  uploadImage: (file: File) => Promise<string>,
): Promise<{ url: string; name: string } | null> {
  try {
    const file = await fetchRemoteImageAsFile(imageUrl);
    const url = await uploadImage(file);
    return { url, name: file.name };
  } catch {
    return null;
  }
}
