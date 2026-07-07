// pdfjs worker のロケーション設定
// 全ての pdfjs 利用箇所が import するだけで side-effect として workerPort が設定される。
//
// 以前は unpkg.com の CDN を直叩きしていたが、Tauri デスクトップ配布の CSP と
// オフライン環境で動かないため worker をローカルに同梱する方式へ移行した。
// さらに `?url` + workerSrc（URL 参照）方式では、Tauri の asset protocol が worker の
// .mjs を正しい MIME で返せず module worker の起動に失敗する（Web は動くのに
// デスクトップだけ「PDF の読み込みに失敗しました」になる）。そこで `?worker&inline` で
// worker を blob として埋め込み、workerPort に渡すことで asset protocol を一切経由させず
// MIME 問題を回避する。
import { pdfjs } from "react-pdf";
import PdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker&inline";

// Worker が存在する環境（ブラウザ／Tauri WebView）でのみ worker を起動する。
// jsdom/vitest など Worker 未定義の環境では import 時の `new PdfjsWorker()` が
// ReferenceError になる（テストは PDF を実描画しないため起動不要）。
if (typeof Worker !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerPort = new PdfjsWorker();
}

// CJK（日本語・中国語・韓国語）PDF は CID フォント（Adobe-Japan1 等）を使う。
// pdf.js はフォントが埋め込まれていても、これらを描画するには cmap データを
// 必要とし、未指定だと translateFont が失敗してテキストだけ消える（画像は出る）。
// standardFontData は base-14 を非埋め込みで使う PDF の fallback 用。
//
// 実体は vite-plugin-static-copy が node_modules/pdfjs-dist から dist 直下の
// pdfjs/ 配下にコピーする（vite.config.ts 参照）。BASE_URL を前置することで
// Web (/Graphium/) と Tauri (/) の双方で正しく解決される。
const PDFJS_ASSET_BASE = `${import.meta.env.BASE_URL}pdfjs/`;

/**
 * getDocument / react-pdf の <Document options> に渡す共通オプション。
 * CJK フォントの描画・テキスト抽出に必須。全ての pdfjs 利用箇所で共有する。
 */
export const PDFJS_DOC_OPTIONS = {
  cMapUrl: `${PDFJS_ASSET_BASE}cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${PDFJS_ASSET_BASE}standard_fonts/`,
} as const;
