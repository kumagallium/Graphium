// Reader 本文画像の URL 変換（url-reader.ts の sanitizeReaderHtml と対）
//
// サーバーは本文の `<img src>` とインライン SVG の `<image href>` を
// `/api/url/image-proxy?url=<encoded>` というルート相対パスで返す。ルート相対なのは、
// Web / Tauri のどちらでも同じ本文文字列をサーバー側 LRU に載せられるようにするため。
// クライアント側の役目は 2 つだけ:
//
//   1. 描画前に apiBase() 基準へ解決する（Tauri では http://127.0.0.1:3001/api/...）
//   2. 「Graphium に保存」へ渡すときは元のリモート URL に戻す
//
// UrlReaderView.tsx から切り出しているのは、あちらが PdfViewer 経由で pdfjs を
// 引き込むため（純粋な文字列処理だけを import できるようにする）。

/** サーバーが画像要素に埋め込むプロキシパスの目印。 */
const IMAGE_PROXY_MARK = "/url/image-proxy?url=";
/**
 * プロキシパスを載せうる属性。`<img src>` に加えて `href` を見るのは、インライン SVG の
 * `<image>` が src を解釈せず href（サーバー側もそちらに書き込む）を読むため。
 */
const PROXIED_ATTRS = ["src", "href"] as const;

/**
 * 本文 HTML 中のルート相対な image-proxy パスを、base（apiBase() の戻り値）基準に解決する。
 *
 * マッチを `属性="` 込みに絞ってあるので、本文の散文に同じ文字列が出てきても書き換わらない。
 * `href` も対象なので `<a href="/api/url/image-proxy?url=...">` があれば一緒に絶対化されるが、
 * 行き先は自分の sidecar のままで、Readability は本文のリンクを絶対 URL に直すため
 * このルート相対な形が本文リンクとして現れることはない。
 * base が "/api" の Web 版では結果が同じ文字列になり実質 no-op。
 */
export function resolveProxiedImageSrc(html: string, base: string): string {
  let out = html;
  for (const attr of PROXIED_ATTRS) {
    // split/join = 正規表現を挟まない全置換（tsconfig の lib が replaceAll に届かない）
    out = out
      .split(`${attr}="/api${IMAGE_PROXY_MARK}`)
      .join(`${attr}="${base}${IMAGE_PROXY_MARK}`);
  }
  return out;
}

/**
 * image-proxy 経由の URL から元のリモート URL を取り出す。プロキシ URL でなければそのまま返す。
 *
 * これを忘れると保存側（note-app の onSaveImageAsAsset）がプロキシ URL をさらに
 * プロキシに包み、sidecar が自分自身を叩いたうえにファイル名の導出も壊れる。
 */
export function unwrapProxiedImageUrl(src: string): string {
  const at = src.indexOf(IMAGE_PROXY_MARK);
  if (at < 0) return src;
  // url は encodeURIComponent 済みの唯一のクエリパラメータなので、以降を丸ごと復号すればよい
  try {
    return decodeURIComponent(src.slice(at + IMAGE_PROXY_MARK.length));
  } catch {
    return src;
  }
}
