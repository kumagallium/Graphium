// jsdom 環境用の最小ポリフィル（保存経路テスト専用）
// use-file-manager の import チェーンは asset-browser 経由で pdfjs-dist を含み、
// pdfjs は import 時に DOMMatrix 等の Canvas 系グローバルを参照する。
// テストでは PDF を描画しないため、存在チェックを通すだけのスタブで十分。
/* eslint-disable @typescript-eslint/no-explicit-any */

if (typeof (globalThis as any).DOMMatrix === "undefined") {
  (globalThis as any).DOMMatrix = class DOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
  };
}

if (typeof (globalThis as any).Path2D === "undefined") {
  (globalThis as any).Path2D = class Path2D {};
}

if (typeof (globalThis as any).ImageData === "undefined") {
  (globalThis as any).ImageData = class ImageData {
    constructor(public width: number, public height: number) {}
  };
}

export {};
