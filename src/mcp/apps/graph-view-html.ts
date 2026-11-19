// グラフの画面の HTML を返す（note-preview-html.ts と同じ作り）。
//
// bundle（dist-mcp / アプリ同梱）では scripts/bundle-mcp.mjs が組み立てた HTML を
// --define で埋め込むので、それをそのまま返す。dev 実行（tsx で src/mcp を直接動かす）では
// 埋め込みが無いので、scripts/build-mcp-app-html.mjs でその場で組み立てる（初回だけ）。

declare const __GRAPHIUM_GRAPH_VIEW_HTML__: string | undefined;

let cached: Promise<string> | null = null;

export function getGraphViewHtml(): Promise<string> {
  if (typeof __GRAPHIUM_GRAPH_VIEW_HTML__ === "string") {
    return Promise.resolve(__GRAPHIUM_GRAPH_VIEW_HTML__);
  }
  if (!cached) {
    // パスを変数にして esbuild に辿らせない（bundle に esbuild 本体が入るのを防ぐ。bundle ではこの枝に来ない）
    const builder = new URL("../../../scripts/build-mcp-app-html.mjs", import.meta.url).href;
    cached = import(/* @vite-ignore */ builder).then(
      (m: { buildGraphViewHtml: () => Promise<string> }) => m.buildGraphViewHtml(),
    );
    cached.catch(() => {
      cached = null;
    });
  }
  return cached;
}

declare const __GRAPHIUM_KNOWLEDGE_GRAPH_HTML__: string | undefined;

let cachedKnowledge: Promise<string> | null = null;

/** 全体グラフの画面（apps/graph-app/main.tsx を Vite で組んだもの）。作りは getGraphViewHtml と同じ */
export function getKnowledgeGraphHtml(): Promise<string> {
  if (typeof __GRAPHIUM_KNOWLEDGE_GRAPH_HTML__ === "string") {
    return Promise.resolve(__GRAPHIUM_KNOWLEDGE_GRAPH_HTML__);
  }
  if (!cachedKnowledge) {
    const builder = new URL("../../../scripts/build-mcp-app-html.mjs", import.meta.url).href;
    cachedKnowledge = import(/* @vite-ignore */ builder).then(
      (m: { buildKnowledgeGraphHtml: () => Promise<string> }) => m.buildKnowledgeGraphHtml(),
    );
    cachedKnowledge.catch(() => {
      cachedKnowledge = null;
    });
  }
  return cachedKnowledge;
}
