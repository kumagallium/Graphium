// URL Reader Mode (PR3-d)
// @mozilla/readability + linkedom で URL を「読める形」に変換して返す。
// PDF Quote-to-Memo (PR2 #339) と対称な体験を URL アセットに与えるための
// バックエンド。/api/url/reader から呼ばれる。
//
// url-fetcher.ts とは独立した経路:
//   - url-fetcher.ts: LLM ingest 用の軽量パス。タイトル + プレーンテキスト + 抜粋
//   - url-reader.ts: Reader View 用。Readability で本文 HTML を抽出し、選択 →
//     Memo 化のために textContent も一緒に返す
//
// linkedom を使う理由: jsdom はパッケージ内部資産（default-stylesheet.css /
// data/patch.json 等）をランタイムで読み込むため、esbuild の ESM single-file
// bundle に載せると sidecar 起動時に確実にクラッシュする（0.9.2 で実害発生）。
// linkedom は ESM ネイティブ・依存資産ゼロで bundle 可能。Readability が要求
// する DOM インタフェースは linkedom 側で満たされている。

import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";

// 多くのサイトは "Graphium/1.0" のような非ブラウザ UA を素で 403 にする。
// 現実的なブラウザ UA + 充実した Accept ヘッダにして互換性を上げる
// （Reader 系サービスの慣例。ただし Cloudflare 等の JS チャレンジは UA では突破できない）。
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";
const ACCEPT_LANGUAGE = "en-US,en;q=0.9";
const FETCH_TIMEOUT_MS = 15_000;

/**
 * 本文画像を差し替える先（sidecar の image-proxy）。ここではルート相対で埋め込み、
 * クライアント側が apiBase() で解決する（Web は同一オリジン、Tauri は 127.0.0.1:3001）。
 */
const IMAGE_PROXY_PATH = "/api/url/image-proxy";

/** blank.gif / spacer.png のような「中身の無い」汎用画像。計測用か lazy-load の placeholder。 */
const BLANK_IMAGE_RE = /(blank|spacer|pixel|transparent)\.(gif|png|webp)([?#].*)?$/i;

export type ReaderArticle = {
  url: string;
  title: string;
  byline: string | null;
  siteName: string | null;
  lang: string | null;
  /**
   * Readability が抽出した本文 HTML（sanitize 済み）。
   * `<img src>` とインライン SVG の `<image href>` は `/api/url/image-proxy?url=...` の
   * ルート相対 URL に書き換えてあり、クライアントが apiBase() で解決する。
   */
  content: string;
  /** 本文プレーンテキスト（textFragment 構築用） */
  textContent: string;
  /** Readability の自動要約（先頭 1-2 段落、空文字の可能性あり） */
  excerpt: string;
  /**
   * 記事内の代表画像 URL（先頭の意味のある `<img>` を絶対 URL で）。
   * tracker 1x1 / data URI / 拡張子非画像は除外する。
   * 見つからなければ null。
   */
  leadImage: string | null;
  fetchedAt: string;
};

export type ReaderError = {
  status: 400 | 422 | 500;
  message: string;
  /**
   * 機械可読なエラー種別。ルート側が message 文字列に依存せず分岐するために使う。
   * "pdf" = content-type が application/pdf。Reader（Readability）では読めないが
   * クライアントの PdfViewer では表示できるので、ルートはこれを検知して
   * エラーではなく PDF シグナルへ変換する。
   */
  code?: "pdf";
};

/**
 * URL を fetch して Readability で本文抽出する。
 *
 * 失敗パターン:
 * - fetch 失敗 → 500
 * - HTTP non-200 → 400
 * - PDF / 非 HTML → 400（PDF は別経路）
 * - Readability が null を返した（reader 不能） → 422
 */
export async function fetchAsReaderArticle(url: string): Promise<ReaderArticle> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: ACCEPT,
        "Accept-Language": ACCEPT_LANGUAGE,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "URL fetch failed";
    throw { status: 500, message } satisfies ReaderError;
  }

  if (!res.ok) {
    // Cloudflare 等のボット保護は、ブラウザでは開けてもサーバー側 fetch では
    // 403/503 になる（TLS フィンガープリント + JS チャレンジ）。UA では突破できない
    // ので、ユーザーが「サイト側の保護」だと分かる文言にして無駄な再試行を防ぐ。
    const server = (res.headers.get("server") ?? "").toLowerCase();
    const botProtected =
      res.headers.get("cf-mitigated") !== null ||
      ((res.status === 403 || res.status === 503) &&
        (server.includes("cloudflare") || server.includes("akamai")));
    throw {
      status: 400,
      message: botProtected
        ? `This page is behind bot protection (e.g. Cloudflare) and cannot be fetched from the server, even though it may open in your browser. Try a different URL. (${res.status})`
        : `Fetch failed: ${res.status} ${res.statusText}`,
    } satisfies ReaderError;
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/pdf")) {
    // Reader では読めないが、ルートが code:"pdf" を検知して PdfViewer 表示へ回す。
    // message は他経路（テスト・ログ）向けのフォールバック。
    throw {
      status: 400,
      code: "pdf",
      message:
        "PDF URLs cannot be opened in Reader Mode. Paste the URL into a note as a PDF block instead.",
    } satisfies ReaderError;
  }

  const finalUrl = res.url || url;
  const html = await res.text();

  return extractReaderFromHtml(html, finalUrl);
}

/**
 * HTML 文字列から Reader 表現を抽出する（fetch 部分を切り離してテスト可能に）。
 */
export function extractReaderFromHtml(html: string, url: string): ReaderArticle {
  // linkedom で document を生成。スクリプトは実行されないため安全。
  // linkedom は `parseHTML(html, options)` に url を渡せないので、`<base href>`
  // を head に注入することで Readability の相対 URL 解決と documentURI/baseURI
  // を機能させる（既存の <base> がある場合はユーザー側を尊重して触らない）。
  const baseUrl = encodeAttr(url);
  let preparedHtml = html;
  if (!/<base[\s>]/i.test(html)) {
    if (/<head[^>]*>/i.test(html)) {
      preparedHtml = html.replace(/<head[^>]*>/i, (m) => `${m}<base href="${baseUrl}">`);
    } else if (/<html[^>]*>/i.test(html)) {
      // <head> が無い場合は <html> の直後に <head><base/></head> を差し込む
      preparedHtml = html.replace(/<html[^>]*>/i, (m) => `${m}<head><base href="${baseUrl}"></head>`);
    } else {
      preparedHtml = `<!doctype html><html><head><base href="${baseUrl}"></head><body>${html}</body></html>`;
    }
  }
  const { document: doc } = parseHTML(preparedHtml);
  // linkedom の document.documentURI は read-only な getter のみ提供されるケースが
  // あるため、Readability が直接 documentURI を読みに来るパスに備えて明示設定する。
  try {
    Object.defineProperty(doc, "documentURI", { value: url, configurable: true });
  } catch {
    // 既に固定の getter で設定されていたら諦める（Readability は baseURI 経由でも動く）
  }

  // lang は <html lang="..."> から事前に拾う（Readability が削るケースに備える）
  const lang = doc.documentElement.getAttribute("lang");

  const reader = new Readability(doc, {
    // 本文要素以外も拾うとサイドバーが混じる。Mozilla のデフォルトに任せる
    charThreshold: 500,
    // 通常 keepClasses は false。Reader 表示で見出しなど最小限の見た目を取りたい
    keepClasses: false,
  });

  const article = reader.parse();
  if (!article || !article.content || !article.textContent) {
    throw {
      status: 422,
      message: "Readability extraction returned null",
    } satisfies ReaderError;
  }

  // 記事の lead image を抽出する（OGP より記事ごとの hero 画像を優先したい）
  // article.content は parsed HTML 断片なので、別の JSDOM で wrap して走査する
  const leadImage = extractLeadImage(article.content, url);

  return {
    url,
    title: article.title ?? "",
    byline: article.byline ?? null,
    siteName: article.siteName ?? null,
    lang: article.lang ?? lang,
    content: sanitizeReaderHtml(article.content, url),
    textContent: normalizeWhitespace(article.textContent),
    excerpt: article.excerpt ?? "",
    leadImage,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * 本文 HTML から先頭の意味ある `<img>` を 1 件抽出して絶対 URL で返す。
 *
 * 除外条件:
 *   - width / height が 1 (tracker pixel)
 *   - data: URI（インライン画像、ほとんどはアイコン）
 *   - blank.gif / spacer.gif / pixel.gif 等の汎用空画像
 *   - srcset の先頭は src のフォールバック扱い
 */
export function extractLeadImage(contentHtml: string, baseUrl: string): string | null {
  // 相対 URL 解決はこの関数内で `new URL(rawSrc, baseUrl)` を明示的に行うので、
  // 文書側の baseURI は不要。linkedom に素の HTML だけ渡せばよい。
  const { document: doc } = parseHTML(
    `<!doctype html><html><body>${contentHtml}</body></html>`,
  );
  const imgs = Array.from(doc.querySelectorAll("img"));
  for (const img of imgs) {
    const rawSrc = pickImageSource(img);
    if (!rawSrc) continue;
    // 判定は本文サニタイズ側と共通のヘルパーに寄せる（lead 用と本文用が食い違わないように）
    if (isLikelyTrackingPixel(img, rawSrc)) continue;
    if (rawSrc.startsWith("data:")) continue;

    try {
      const absolute = new URL(rawSrc, baseUrl).toString();
      // http(s) のみ受け付ける（mailto:/javascript: 等を弾く）
      if (!/^https?:/i.test(absolute)) continue;
      return absolute;
    } catch {
      // 不正な URL → skip
      continue;
    }
  }
  return null;
}

/**
 * Readability の出力 HTML に対する軽量サニタイズ。
 *
 * Readability 自体が JSDOMParser ベースで `<script>` 等の危険要素を落としているが、
 * 念のため:
 *   - script / style / iframe / object / embed / link は削除
 *   - on* 属性（onclick 等）は削除
 *   - javascript: で始まる href / src を `#` に置換
 *
 * ここは文字列置換なので閉じタグを前提にした形しか落とせない（`<iframe src=x>` が
 * 閉じられていないと素通りする）。Readability の出力はシリアライズ済みで必ず閉じるが、
 * 取りこぼしは後段の `rewriteReaderMedia` が DOM 上でもう一度落とす。
 * baseUrl は相対 URL 解決用。省略時は絶対 URL の画像だけが残る。
 *
 * Reader 表示は本文のテキストを読ませるのが目的なので、外部リソースを過剰に許可しない。
 */
export function sanitizeReaderHtml(html: string, baseUrl?: string): string {
  // 危険なタグを丸ごと除去
  let out = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?<\/object>/gi, "")
    .replace(/<embed[\s\S]*?>/gi, "")
    .replace(/<link[\s\S]*?>/gi, "");

  // on* イベントハンドラ属性
  out = out.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "");
  out = out.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "");
  out = out.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "");

  // javascript: URL
  out = out.replace(/(href|src)\s*=\s*"javascript:[^"]*"/gi, '$1="#"');
  out = out.replace(/(href|src)\s*=\s*'javascript:[^']*'/gi, "$1='#'");

  return rewriteReaderMedia(out, baseUrl);
}

/**
 * 本文中のメディア要素を書き換える。
 *
 * 記事本文は WebView で dangerouslySetInnerHTML されるので、生き残った `<img>` は
 * そのまま WebView 自身の身元（そのホストの Cookie / Referer / 実 UA + client hints /
 * HTTP キャッシュの ETag）を付けた外部リクエストになる。ここでやること:
 *
 *   1. 計測用ピクセルらしき画像を落とす（1x1 / 0 サイズ / spacer.gif 等）
 *   2. `srcset` / `sizes` / `<source>` を除去する。ブラウザは srcset を src より
 *      優先するので、残すと 3. の書き換えが素通りされる
 *   3. https の src を sidecar の image-proxy 経由に差し替える
 *   4. 生き残った `<img>` に referrerpolicy="no-referrer" と loading="lazy" を付ける
 *   5. `<video>` / `<audio>` を落とす。media-src で再生自体が既に塞がれている一方、
 *      poster は img-src の fetch として生きており計測に使える
 *   6. 外部 `url(...)` を引く属性値と `background` 属性を落とす（`stripRemoteUrlAttrs`）
 *   7. インライン `<svg>` の href / xlink:href の外部参照を落とす（`stripSvgRemoteRefs`）
 *   8. `iframe` / `object` / `embed` / `link` / `track` / `meta` を落とす
 *
 * 対象は `<img>` だけでなく `<image>` も含む。`<image>` は 2 通りの意味を持つ:
 *   - `<svg>` の中: SVG の画像要素。src ではなく href / xlink:href を読む
 *   - `<svg>` の外: HTML パーサが `<img>` に読み替える（HTML 仕様の tag name 変換）
 * どちらも消さずに `<img>` と同じフィルタ・プロキシに通し、書き込む属性だけ解釈に
 * 合わせて変える。消さないのは、インライン SVG の図版がラスタ画像を `<image>` で
 * 重ねる形が実在し、落とすと本文の図が欠けるため。
 * ただし SVG の `<image>` は referrerpolicy も loading も解釈しない（SVG2 がこの 2 つを
 * 定義していない。applyReaderImgDefaults は属性を付けるが SVG 側では無視される）ので、
 * 4. の保険は `<img>` に読み替えられる場合にしか効かない。書き換え後の参照先が同一
 * マシンの sidecar なので Referer の宛先は 127.0.0.1 で、上流へ投げ直すのは sidecar
 * 側（Referer は付けない）。取りこぼすのは lazy 読み込みの分だけ。
 *
 * プロキシが実際に消すもの / 消さないもの（誇張しないこと）:
 *   消す = Cookie の送出と保存、Referer、WebView の実 UA / client hints、
 *          WebView の HTTP キャッシュ（ETag 経由の再識別）。
 *   消さない = リクエストそのものと送信元 IP。sidecar は同じマシンで動くので、
 *          配信元には「その IP がその時刻にその画像を取った」記録が変わらず残る。
 *   つまり「識別可能で紐付け可能な追跡」→「匿名の IP レベルのヒット」に落とすだけで、
 *   第三者ホストへの接続を無くすものではない。
 */
function rewriteReaderMedia(html: string, baseUrl?: string): string {
  const { document: doc } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);

  // <video>/<audio> ごと削除。poster は img-src 扱いなので残すと計測経路になる。
  for (const el of Array.from(doc.querySelectorAll("video, audio"))) el.remove();
  // <picture><source srcset> は <img src> より優先されるので、<img> をフォールバックに残して落とす。
  for (const el of Array.from(doc.querySelectorAll("source"))) el.remove();
  // sanitizeReaderHtml の文字列置換は閉じタグを前提にしているので、閉じられていない
  // `<iframe src=x>` 等が素通りする。DOM 上ではその区別が無いのでここで落とし切る。
  // <track> は media 要素の子でなければ読み込まれず、その親は上で消しているので
  // ここに残るのは孤児だけだが、宙に浮いた参照を残さないよう一緒に落とす。
  // <meta> は本文に居る理由が無い一方、http-equiv="refresh" は挿入時に処理する実装がある。
  for (const el of Array.from(doc.querySelectorAll("iframe, object, embed, link, track, meta"))) {
    el.remove();
  }

  // 外部リソースを引く属性値。Readability の _cleanStyles も同じものを落とすが、
  // あれは svg で早期 return するのでインライン SVG の中には効かない。
  for (const el of Array.from(doc.querySelectorAll("*"))) stripRemoteUrlAttrs(el);
  // href / xlink:href の外部参照は svg の中だけ落とす（本文の <a href> は残すため）。
  for (const el of Array.from(doc.querySelectorAll("svg *"))) stripSvgRemoteRefs(el);

  for (const img of Array.from(doc.querySelectorAll("img, image"))) {
    // <svg> の中の <image> だけが href / xlink:href を実体として読む。
    // <svg> の中の <img>（foreignObject 経由）は通常の HTML 画像なので src のまま。
    const isSvgImage = img.tagName.toLowerCase() === "image" && img.closest("svg") !== null;
    const sourceAttrs = isSvgImage ? SVG_IMAGE_SOURCE_ATTRS : IMG_SOURCE_ATTRS;
    const targetAttr = isSvgImage ? "href" : "src";

    const raw = pickImageSource(img, sourceAttrs);
    if (!raw || isLikelyTrackingPixel(img, raw)) {
      img.remove();
      continue;
    }

    // DPR 選択は失われるが、srcset の候補を個別に書き換えるのは URL にカンマを含む
    // 配信元（imgix / Cloudinary 等）で壊れるので割に合わない。68ch 幅なら実害は小さい。
    img.removeAttribute("srcset");
    img.removeAttribute("sizes");
    // SVG 1.1 の xlink:href。SVG2 では href が優先だが古い実装は xlink 側を見るので、
    // 書き換えた href を迂回されないよう消す。
    if (isSvgImage) img.removeAttribute("xlink:href");

    if (raw.startsWith("data:")) {
      // インライン画像は外部に出ないのでそのまま残す
      img.setAttribute(targetAttr, raw);
      applyReaderImgDefaults(img);
      continue;
    }

    let absolute: URL;
    try {
      absolute = new URL(raw, baseUrl);
    } catch {
      img.remove();
      continue;
    }
    // https 以外は落とす。これが image-proxy の SSRF ゲートでもある: プレーン http を
    // 通すと記事側が <img src="http://192.168.1.1/..."> で sidecar に LAN を叩かせられる。
    // パッケージ版の CSP は元々 http: の画像を許可していないので表示上の後退も無い。
    if (absolute.protocol !== "https:") {
      img.remove();
      continue;
    }
    img.setAttribute(
      targetAttr,
      `${IMAGE_PROXY_PATH}?url=${encodeURIComponent(absolute.toString())}`,
    );
    applyReaderImgDefaults(img);
  }

  return doc.body.innerHTML;
}

/**
 * 外部リソースを引く CSS の値。次のどれかを含めば落とす。
 *   - `url(...)` のうち同一文書内フラグメント（`url(#id)`）でないもの。引用符付きも見る
 *   - `image-set()` / `-webkit-image-set()` / `image()` — これらは引数をベア文字列で
 *     書けるため（`image-set("https://…/a.png" 1x)`）、`url(` だけを見ると素通りする
 *
 * この判定は全要素の全属性に掛かる（`querySelectorAll("*")`）ので、記事本文の
 * `<a href="https://…">` を巻き込まないよう「スキームを含む値」では判定しない。
 * `image(` も CSS の値位置（先頭・`:`・`,`・`(` の直後）に限り、`alt="photo image(1)"`
 * のような散文を誤検出しないようにする。`image-set(` は `image(` と一致しないので別に並べる。
 */
const REMOTE_URL_FUNC_RE =
  /url\(\s*['"]?(?!#)|(?:-webkit-)?image-set\(|(?:^|[:,(])\s*image\(/i;

/**
 * 外部リソースを引く「値」を持つ属性を落とす。
 *   - `url(#...)` 以外の url(...) を含む値。style だけでなく fill / mask / clip-path /
 *     filter も取りうるので、属性名の列挙ではなく値の形で判定する
 *   - `background`（`<table background>` 等の表示用属性）
 *
 * Readability の _cleanStyles も style / background を落とすが、あれは svg で早期
 * return するのでインライン SVG の中（`<foreignObject>` の HTML を含む）には効かない。
 * 実装依存にしないよう本文全体に一律で掛ける。
 */
function stripRemoteUrlAttrs(el: SweepElement): void {
  for (const name of el.getAttributeNames()) {
    if (name.toLowerCase() === "background") {
      el.removeAttribute(name);
      continue;
    }
    if (REMOTE_URL_FUNC_RE.test(el.getAttribute(name) ?? "")) el.removeAttribute(name);
  }
}

/**
 * インライン `<svg>` の中の href / xlink:href の外部参照を落とす。`<image>` は上の
 * プロキシ経路に回すので触らず、それ以外は書き換え先が無いので属性ごと削除する
 * （`<use>` / `<feImage>` 等）。`#id`（同一文書内）参照は残す。
 * `<a href>` はクリック起点なので本文の HTML リンクと同じ扱いで残す。
 *
 * ここで落とす参照が実際にリクエストになるかはブラウザ次第（外部 `<use>` を読まない
 * 実装、外部 paint server を無視する実装がある）。当てにせず、参照そのものを消す。
 */
function stripSvgRemoteRefs(el: SweepElement): void {
  const tag = el.tagName.toLowerCase();
  if (tag === "image" || tag === "a") return;
  for (const name of el.getAttributeNames()) {
    const lower = name.toLowerCase();
    if (lower !== "href" && lower !== "xlink:href") continue;
    if (!(el.getAttribute(name) ?? "").trim().startsWith("#")) el.removeAttribute(name);
  }
}

/** 生き残った画像に共通で付ける保険。SVG の `<image>` では解釈されない（属性が無視される）。 */
function applyReaderImgDefaults(img: AttrElement): void {
  // プロキシを通らない経路（data:）や将来の抜け漏れに備える。
  // コードベース全体で外部画像を出すときの作法（favicon.tsx 等）と揃える。
  img.setAttribute("referrerpolicy", "no-referrer");
  // 画面外の画像は取りに行かない。フィルタをすり抜けた計測用画像も、
  // そこまでスクロールされなければリクエスト自体が発生しない。
  img.setAttribute("loading", "lazy");
}

type AttrElement = {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
};

type SweepElement = AttrElement & {
  tagName: string;
  getAttributeNames(): string[];
  removeAttribute(name: string): void;
};

/** `<img>` が実体として読む属性（優先順）。`srcset` は先頭候補に潰して比べる。 */
const IMG_SOURCE_ATTRS = ["src", "srcset", "data-src", "data-original"] as const;
/** `<svg>` の中の `<image>` が読む属性。src は解釈されない。 */
const SVG_IMAGE_SOURCE_ATTRS = ["href", "xlink:href"] as const;

/**
 * 画像要素の実体 src を選ぶ。`<img>` なら src → srcset の先頭候補 → data-src →
 * data-original、SVG の `<image>` なら href → xlink:href の順。
 *
 * lazy-load サイトは src に placeholder（spacer.gif 等）を置いて実体を data-src に
 * 逃がすので、placeholder らしい候補は後回しにする。全部 placeholder なら先頭を返し、
 * 呼び出し側の計測ピクセル判定に委ねる。
 */
function pickImageSource(img: AttrElement, attrs: readonly string[] = IMG_SOURCE_ATTRS): string {
  const candidates = attrs
    .map((name) => {
      const value = img.getAttribute(name) ?? "";
      return name === "srcset" ? firstSrcsetCandidate(value) : value;
    })
    .filter((c) => c.length > 0);
  return candidates.find((c) => !BLANK_IMAGE_RE.test(c)) ?? candidates[0] ?? "";
}

/**
 * `"a.jpg 1x, b.jpg 2x"` の先頭 URL を返す。srcset を落とすときの src フォールバック用。
 *
 * カンマではなく空白で切る。srcset の URL は空白だけが必ず percent-encode される一方
 * カンマは生で入りうる（imgix / Cloudinary の変換パラメータ）ので、カンマで切ると
 * それらの URL を途中でぶった切ってしまう。先頭候補の URL は必ず先頭から最初の
 * 空白までなので、この切り方なら descriptor の有無にも左右されない。
 */
function firstSrcsetCandidate(srcset: string): string {
  return srcset.replace(/^[\s,]+/, "").split(/\s+/)[0] ?? "";
}

/**
 * 計測用ピクセルらしい `<img>` か。
 * width / height が 0 か 1、または blank.gif / spacer.png 等の汎用空画像。
 * 完全ではない（CSS で 1px にするタイプは見抜けない）が、素直なものは落とせる。
 */
function isLikelyTrackingPixel(img: AttrElement, rawSrc: string): boolean {
  const w = parseInt(img.getAttribute("width") ?? "", 10);
  const h = parseInt(img.getAttribute("height") ?? "", 10);
  if (w === 0 || w === 1 || h === 0 || h === 1) return true;
  return BLANK_IMAGE_RE.test(rawSrc);
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[  -​]+/g, " ") // nbsp 等の特殊空白
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 注入用 `<base href="...">` の値として URL を埋め込めるように
 * HTML 属性で問題になる文字（&, ", <, >）だけ最小エスケープする。
 * URL 自体は RFC 的に "/<>& を生で持たないので、防衛的に処理する程度で十分。
 */
function encodeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── 取得結果のメモリ LRU キャッシュ ──
// 同一 URL の再取得を防ぐ。Reader Mode は読み返し頻度が高いので 30s で十分。
// 永続化はしない（プロセス再起動で消える）。

type CacheEntry = { article: ReaderArticle; expiresAt: number };
const CACHE_TTL_MS = 30_000;
const CACHE_MAX = 256;
const cache = new Map<string, CacheEntry>();

export function getCachedReaderArticle(url: string): ReaderArticle | null {
  const entry = cache.get(url);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(url);
    return null;
  }
  // LRU: 取得した key を末尾に移す
  cache.delete(url);
  cache.set(url, entry);
  return entry.article;
}

export function setCachedReaderArticle(url: string, article: ReaderArticle): void {
  if (cache.size >= CACHE_MAX) {
    // 先頭（最古）を 1 つ捨てる
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(url, { article, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** テスト用。プロセス内のキャッシュをクリア。 */
export function clearReaderCache(): void {
  cache.clear();
}
