// MCP Apps の画面（src/mcp/apps/*-view.ts）を、外部読み込みの無い 1 枚の HTML に組み立てる。
//
// 呼び出し元:
//   - scripts/bundle-mcp.mjs … bundle 時に組み立て、--define で MCP サーバーに埋め込む
//   - src/mcp/apps/note-preview-html.ts … dev 実行（tsx）で埋め込みが無いときにその場で組み立てる
//
// スクリプトも CSS も HTML の中に入れる。ホストの CSP を空のまま通すため（外から何も読まない）。

import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// 色はホスト（Claude など）の変数を優先し、無いときの値だけここで持つ。
// ホストが変数を渡さない場合も読めるよう、明暗の両方に既定値を置く。
const NOTE_PREVIEW_CSS = `
:root {
  color-scheme: light dark;
  --gp-bg: var(--color-background-primary, #ffffff);
  --gp-bg-2: var(--color-background-secondary, #f6f5f2);
  --gp-text: var(--color-text-primary, #1f1f1d);
  --gp-muted: var(--color-text-secondary, #6b6a66);
  --gp-border: var(--color-border-primary, #e3e1db);
  --gp-font: var(--font-sans, -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Segoe UI", sans-serif);
  --gp-mono: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
}
[data-theme="dark"] {
  --gp-bg: var(--color-background-primary, #1f1f1d);
  --gp-bg-2: var(--color-background-secondary, #2a2a27);
  --gp-text: var(--color-text-primary, #ecebe6);
  --gp-muted: var(--color-text-secondary, #a3a29c);
  --gp-border: var(--color-border-primary, #3a3a36);
}
* { box-sizing: border-box; }
html, body { margin: 0; background: transparent; }
body { font-family: var(--gp-font); color: var(--gp-text); font-size: 14px; line-height: 1.65; }
.card { border: 1px solid var(--gp-border); border-radius: 12px; background: var(--gp-bg); overflow: hidden; }
header { padding: 14px 18px 10px; border-bottom: 1px solid var(--gp-border); }
.title { font-size: 17px; font-weight: 600; margin: 0; line-height: 1.4; }
.meta { color: var(--gp-muted); font-size: 12px; margin-top: 4px; }
.body { padding: 12px 18px; max-height: 560px; overflow-y: auto; }
.body > * { margin: 0 0 6px; }
h2, h3, h4, h5 { margin: 14px 0 6px; line-height: 1.4; font-weight: 600; }
h2 { font-size: 16px; } h3 { font-size: 15px; } h4, h5 { font-size: 14px; }
.line { display: flex; gap: 6px; align-items: baseline; }
.marker { color: var(--gp-muted); flex: none; }
.line-body { min-width: 0; overflow-wrap: anywhere; }
.step { display: flex; gap: 8px; align-items: baseline; margin-top: 14px; font-weight: 600; }
.step-no { flex: none; min-width: 20px; height: 20px; border-radius: 10px; font-size: 12px; text-align: center;
  line-height: 20px; color: #fff; background: var(--label-color, #5b8fb9); }
.labeled { border-left: 3px solid var(--label-color); padding-left: 8px; }
.label { flex: none; font-size: 11px; font-weight: 500; color: var(--label-color); border: 1px solid var(--label-color);
  border-radius: 4px; padding: 0 5px; margin-right: 6px; line-height: 17px; }
h2 .label, h3 .label, h4 .label, h5 .label { vertical-align: 2px; }
code { font-family: var(--gp-mono); font-size: 12.5px; background: var(--gp-bg-2); border-radius: 4px; padding: 1px 4px; }
pre { background: var(--gp-bg-2); border-radius: 8px; padding: 10px 12px; overflow-x: auto; font-size: 12.5px; }
pre code { background: none; padding: 0; }
.math, .math-block { font-family: var(--gp-mono); }
.link { text-decoration: underline; text-decoration-color: var(--gp-muted); text-underline-offset: 2px; }
.table-wrap { overflow-x: auto; }
table { border-collapse: collapse; font-size: 13px; }
th, td { border: 1px solid var(--gp-border); padding: 4px 8px; text-align: left; vertical-align: top; }
th { background: var(--gp-bg-2); font-weight: 600; }
.media, .other { color: var(--gp-muted); font-size: 13px; }
hr { border: none; border-top: 1px solid var(--gp-border); margin: 12px 0; }
footer { padding: 8px 18px 12px; border-top: 1px solid var(--gp-border); font-size: 12px; }
footer p { margin: 0 0 4px; }
.muted { color: var(--gp-muted); }
`;

/** スクリプトの中の `</script` を崩して、HTML の中で閉じタグと読まれないようにする */
function escapeInlineScript(js) {
  return js.replace(/<\/(script)/gi, "<\\/$1");
}

/** ノートプレビューの HTML を組み立てる */
export async function buildNotePreviewHtml() {
  const result = await build({
    entryPoints: [join(repoRoot, "src", "mcp", "apps", "note-preview-view.ts")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2020",
    minify: true,
    legalComments: "none",
    logLevel: "silent",
  });
  const js = result.outputFiles[0].text;
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Graphium note preview</title>",
    `<style>${NOTE_PREVIEW_CSS}</style>`,
    "</head>",
    "<body>",
    '<div id="root"></div>',
    `<script>${escapeInlineScript(js)}</script>`,
    "</body>",
    "</html>",
  ].join("\n");
}
