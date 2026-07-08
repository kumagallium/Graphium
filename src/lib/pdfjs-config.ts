// pdfjs worker と CJK アセットのロケーション設定。
// 全ての pdfjs 利用箇所が import するだけで side-effect として workerSrc が設定される。
//
// worker は「ドキュメントごとに専用」で動かす（workerSrc = URL 方式）。単一の
// workerPort を共有すると、最大化などで一方の <Document> がアンマウントされ
// loadingTask.destroy() が走った時に共有 worker を破棄し、次の getDocument が
// 「PDFWorker.create - the worker is being destroyed」で失敗する。workerSrc 方式は
// pdf.js が <Document> ごとに worker を生成・破棄するためこの問題が起きない。
//
// worker の実体は vite.config.ts の pdfjsAssetsPlugin が public/pdfjs/ に
// pdf.worker.min.js（.mjs を .js にリネーム）としてコピーする。pdf.js は worker を
// `new Worker(workerSrc, { type: "module" })` で生成する。Tauri の asset protocol は
// .mjs を module worker 用の MIME で配信できないが、.js はアプリ本体スクリプトと
// 同様に配信されるため module worker を起動できる（Web/Tauri 双方で BASE_URL 経由）。
import { pdfjs } from "react-pdf";

// public/pdfjs/ 配下。BASE_URL を前置することで Web (/Graphium/) と Tauri (/) の
// 双方で正しく解決される。
const PDFJS_ASSET_BASE = `${import.meta.env.BASE_URL}pdfjs/`;

pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_ASSET_BASE}pdf.worker.min.js`;

/**
 * getDocument / react-pdf の <Document options> に渡す共通オプション。
 * CJK フォントの描画・テキスト抽出に必須。全ての pdfjs 利用箇所で共有する。
 */
export const PDFJS_DOC_OPTIONS = {
  cMapUrl: `${PDFJS_ASSET_BASE}cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${PDFJS_ASSET_BASE}standard_fonts/`,
} as const;
