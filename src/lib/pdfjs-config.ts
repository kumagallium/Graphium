// pdfjs worker のロケーション設定
// 全ての pdfjs 利用箇所が import するだけで side-effect として workerSrc が設定される。
//
// 以前は unpkg.com の CDN を直叩きしていたが、Tauri デスクトップ配布の CSP と
// オフライン環境で動かないため、Vite の `?url` import で worker をローカル
// バンドルに同梱する方式に切り替えた。worker は別チャンクとして配信されるので
// main bundle は太らない。
import { pdfjs } from "react-pdf";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

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
