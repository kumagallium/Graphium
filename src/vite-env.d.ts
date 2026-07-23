/// <reference types="vite/client" />

declare module "cytoscape-fcose" {
  const fcose: cytoscape.Ext;
  export default fcose;
}

// rtf.js の EMF レンダラ (UMD バンドルを直接 import する。index.js は拡張子なし
// import を含み ESM 解決できないため、バンドル指定が必須)
declare module "rtf.js/dist/EMFJS.bundle.js" {
  interface EmfRendererSettings {
    width: string;
    height: string;
    wExt: number;
    hExt: number;
    xExt: number;
    yExt: number;
    mapMode: number;
  }
  class Renderer {
    constructor(blob: ArrayBuffer);
    render(info: EmfRendererSettings): SVGElement;
  }
  const EMFJS: {
    Renderer: typeof Renderer;
    /** rtf.js のコンソールログ。デフォルト有効なので必ず false にしてから使う */
    loggingEnabled(enabled: boolean): void;
  };
  export default EMFJS;
}

