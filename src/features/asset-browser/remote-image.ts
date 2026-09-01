// 画像参照をローカルメディアとして取り込むヘルパー（クライアント側）
//
// 入口は 2 つある。外部ホストの URL（saveRemoteImageAsMedia）と、本文に直接
// 埋まった data URL（saveDataImageAsMedia）。前者だけがネットワークへ出る。
//
// リモートのバイトは sidecar の /url/image-proxy 経由で取得する:
//   - クロスオリジン画像は canvas の cross-origin taint があるため、表示はできても
//     ブラウザから直接バイトを取り込めない
//   - /url/reader が既に行っている「任意ユーザー URL をサーバ側で fetch する」のと
//     同じ信頼レベルであり、新たな到達性を増やすものではない
//
// 永続コンテンツにリモート URL を書かないための共通入口でもある。og:image や
// leadImage の URL をそのままブロックに埋めると、ノートを開くたび・PDF 書き出しの
// たびに配信元（CDN / 計測ドメイン）へ取りに行くことになる。取り込み時に一度だけ
// 取得してローカルメディアに保存し、本文にはそのローカル URL だけを書く。
//
// 現在の呼び出し元は 3 つ。どれも「ユーザーがその操作をした瞬間に 1 回だけ取る」:
//   - pdf-translate/translate-service.ts … 記事の lead 画像
//   - blocks/remote-content/use-remote-image-import.ts … 本文に入った画像
//   - note-app.tsx … Reader の「画像を素材として保存」（File だけ受け取る）
// 取り込み経路を増やすときも、ここを通す（no-remote-hero.test.ts が入口を数えている）。

import { apiBase, isTauri } from "../../lib/platform";
import { fetchCapabilities } from "../../lib/storage/providers/server-fs";

/**
 * 取得のタイムアウト。sidecar 側の fetch は 15s（server/routes/url.ts）なので、
 * その後の本文転送ぶんの余裕を足した長さにする。ここが無いと、応答を返さない
 * プロキシに当たったとき呼び出し側が永久に待つ。
 */
const REMOTE_IMAGE_TIMEOUT_MS = 20_000;

/**
 * 受け取るバイト数の上限。sidecar の IMAGE_PROXY_MAX_BYTES と同じ値。
 * 向こうは content-length しか見られない（chunked は素通し）ので、届いた実バイト数も
 * こちらで見る。ただし判定は blob 化の後なので、止まるのは「保存すること」までで、
 * 本文がメモリに載ること自体は止まらない。
 */
export const MAX_REMOTE_IMAGE_BYTES = 32 * 1024 * 1024;

/**
 * sidecar の image-proxy が届く環境か。
 *
 * ブラウザから配信元へ直接 fetch してもほとんど CORS で弾かれるので、プロキシが
 * 無い環境（GitHub Pages の静的配信）では取得そのものを諦める。判定をここに置いて
 * いるのは、image-proxy を叩く経路（本文の取り込みとプレビュー画像のキャッシュ）で
 * 同じ条件を使うため。
 */
export async function imageProxyAvailable(): Promise<boolean> {
  if (isTauri()) return true; // sidecar を同梱している
  if (typeof fetch === "undefined") return false;
  const caps = await fetchCapabilities();
  return caps?.serverStorage === true;
}

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
 * 取得失敗・画像以外（HTML エラーページ等）・上限超過は throw するので、呼び出し側で握る。
 *
 * プロキシの無い環境（web の静的配信）でも throw する。そこでブラウザから配信元へ
 * 直接取りに行くフォールバックは足さない —— CORS でほぼ弾かれるうえ、通った場合は
 * 「取り込みのつもりで配信元に直接アクセスした」ことになる。
 */
export async function fetchRemoteImageAsFile(imageUrl: string): Promise<File> {
  if (!(await imageProxyAvailable())) throw new Error("image-proxy unavailable");
  const proxied = `${apiBase()}/url/image-proxy?url=${encodeURIComponent(imageUrl)}`;
  const res = await fetch(proxied, { signal: AbortSignal.timeout(REMOTE_IMAGE_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`image-proxy ${res.status}`);
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_REMOTE_IMAGE_BYTES) {
    throw new Error("image too large");
  }
  const blob = await res.blob();
  if (!blob.type.startsWith("image/")) throw new Error("not an image");
  // content-length を付けない相手・chunked の相手はここで初めて判る
  if (blob.size > MAX_REMOTE_IMAGE_BYTES) throw new Error("image too large");
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

/**
 * `data:image/…` を File に組み直す。画像でない data URL・本文が壊れている data URL は null。
 *
 * 自前でデコードするのは、このファイルに取得の機構（要求を出す呼び出しや画像要素）を
 * 増やさないため。中身は既に手元にあるので文字列処理だけで足りるし、
 * no-remote-hero.test.ts はこのファイルの取得先を image-proxy 1 つに固定している。
 *
 * ファイル名は MIME だけから作る。data URL をそのまま remoteImageFileName へ渡すと
 * `data:` も URL として解析できてしまい base64 本体がファイル名に混ざるので、
 * 解析に失敗して既定名 "image" になる空文字で呼ぶ。
 */
function dataImageUrlToFile(dataUrl: string): File | null {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  // `data:image/png;base64` の部分。スキームもパラメータも大文字小文字を区別しない
  const params = dataUrl.slice(0, comma).toLowerCase().replace(/^data:/, "").split(";");
  const mime = params[0].trim();
  if (!mime.startsWith("image/")) return null;
  const body = dataUrl.slice(comma + 1);
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    if (params.some((p) => p.trim() === "base64")) {
      const binary = atob(body);
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    } else {
      // パーセントエンコードされた本文（`data:image/svg+xml;utf8,<svg …>` の形）
      bytes = new TextEncoder().encode(decodeURIComponent(body));
    }
  } catch {
    return null; // base64 として読めない / パーセントエンコードが壊れている
  }
  // 中身の無い data URL を素材として登録しない（画像として開けないゴミが残る）
  if (bytes.length === 0) return null;
  return new File([bytes], remoteImageFileName("", mime), { type: mime });
}

/**
 * 本文に直接埋まった `data:image/…` をメディアプロバイダへ保存し、ローカル URL と
 * 保存名を返す。組み直し・保存のどこかで失敗したら null（ベストエフォート）。
 *
 * data URL は要求を出さないのでプライバシー上の問題は無く、image-proxy も要らない。
 * それでも取り込むのは保存の都合 —— base64 のまま置くとノート JSON がその画像ぶん
 * 丸ごと膨らみ、開くたび・保存するたびに運ばれる。
 *
 * 失敗しても呼び出し側は URL を消さないこと。data URL は手元の実体なので、
 * 残しておけばそのまま表示できる。
 */
export async function saveDataImageAsMedia(
  dataUrl: string,
  uploadImage: (file: File) => Promise<string>,
): Promise<{ url: string; name: string } | null> {
  const file = dataImageUrlToFile(dataUrl);
  if (!file) return null;
  try {
    const url = await uploadImage(file);
    return { url, name: file.name };
  } catch {
    return null;
  }
}
