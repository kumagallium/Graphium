// ノートプレビューの HTML を返す。
//
// bundle（dist-mcp / アプリ同梱）では scripts/bundle-mcp.mjs が組み立てた HTML を
// --define で埋め込むので、それをそのまま返す。dev 実行（tsx で src/mcp を直接動かす）では
// 埋め込みが無いので、scripts/build-mcp-app-html.mjs でその場で組み立てる（初回だけ）。

declare const __GRAPHIUM_NOTE_PREVIEW_HTML__: string | undefined;

let cached: Promise<string> | null = null;

export function getNotePreviewHtml(): Promise<string> {
  if (typeof __GRAPHIUM_NOTE_PREVIEW_HTML__ === "string") {
    return Promise.resolve(__GRAPHIUM_NOTE_PREVIEW_HTML__);
  }
  if (!cached) {
    // パスを変数にして esbuild に辿らせない（bundle に esbuild 本体が入るのを防ぐ。bundle ではこの枝に来ない）
    const builder = new URL("../../../scripts/build-mcp-app-html.mjs", import.meta.url).href;
    cached = import(/* @vite-ignore */ builder).then(
      (m: { buildNotePreviewHtml: () => Promise<string> }) => m.buildNotePreviewHtml(),
    );
    // 失敗したら次の呼び出しでやり直せるようにする
    cached.catch(() => {
      cached = null;
    });
  }
  return cached;
}
