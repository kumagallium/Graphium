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
