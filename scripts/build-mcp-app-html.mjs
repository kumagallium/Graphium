// MCP Apps の画面（src/mcp/apps/*-view.ts）を、外部読み込みの無い 1 枚の HTML に組み立てる。
//
// 呼び出し元:
//   - scripts/bundle-mcp.mjs … bundle 時に組み立て、--define で MCP サーバーに埋め込む
//   - src/mcp/apps/note-preview-html.ts … dev 実行（tsx）で埋め込みが無いときにその場で組み立てる
//
// スクリプトも CSS も HTML の中に入れる。ホストの CSP を空のまま通すため（外から何も読まない）。

import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// 見た目はアプリのノートに寄せる。値の出どころ:
//   - 色: src/app.css の scene tokens（--paper / --ink / --rule / --forest）。oklch のまま写す
//   - 文字: Inter と JetBrains Mono（public/fonts/ を data URL で埋め込む。日本語はシステムのフォント）
//   - 本文 16px / 行間 1.7、見出しは幅 767px 以下のときのアプリの大きさ（24 / 20 / 18px）。
//     会話の中の画面はそれより狭いので、アプリを狭い窓で開いたときと同じ見え方になる
// アプリに暗い表示は無いので、ホストが暗い表示でも紙の色のまま描く。
function notePreviewCss() {
  const font = (file) => readFileSync(join(repoRoot, "public", "fonts", file)).toString("base64");
  return `
@font-face { font-family: 'Inter'; font-style: normal; font-weight: 400 700; src: url(data:font/woff2;base64,${font("inter.woff2")}) format('woff2'); }
@font-face { font-family: 'JetBrains Mono'; font-style: normal; font-weight: 400 500; src: url(data:font/woff2;base64,${font("jetbrains-mono.woff2")}) format('woff2'); }
:root {
  color-scheme: light;
  --paper: oklch(0.99 0.0085 128.6);
  --paper-2: oklch(0.976 0.0051 145.5);
  --paper-3: oklch(0.958 0.0102 145.5);
  --ink: oklch(0.278 0.0406 148.1);
  --ink-3: oklch(0.474 0.0427 151.9);
  --ink-4: oklch(0.695 0.0312 153.1);
  --rule: oklch(0.896 0.0169 151.1);
  --rule-2: oklch(0.913 0.0144 148.8);
  --forest: oklch(0.48 0.09 150);
  --ui: 'Inter', system-ui, -apple-system, 'Hiragino Sans', 'Yu Gothic UI', sans-serif;
  --mono: 'JetBrains Mono', ui-monospace, 'SF Mono', monospace;
}
* { box-sizing: border-box; }
html, body { margin: 0; background: transparent; }
body { font-family: var(--ui); color: var(--ink); font-size: 16px; line-height: 1.7; letter-spacing: 0.01em; }
.card { border: 1px solid var(--rule); border-radius: 10px; background: var(--paper); overflow: hidden; }
header { padding: 18px 24px 12px; border-bottom: 1px solid var(--rule-2); }
.title { font-size: 26px; font-weight: 700; margin: 0; line-height: 1.3; }
.meta { color: var(--ink-3); font-size: 12px; margin-top: 6px; letter-spacing: 0; }
.body { padding: 12px 24px 16px; }
.body > * { margin: 0 0 4px; }
h2, h3, h4 { margin: 20px 0 6px; }
h2 { font-size: 24px; font-weight: 700; line-height: 1.3; }
h3 { font-size: 20px; font-weight: 600; line-height: 1.3; }
h4 { font-size: 18px; font-weight: 600; line-height: 1.4; }
.line { display: flex; gap: 8px; align-items: baseline; }
.marker { color: var(--ink-3); flex: none; min-width: 12px; text-align: center; }
.checkbox { flex: none; width: 16px; height: 16px; border: 1.5px solid var(--ink-4); border-radius: 4px; align-self: center;
  font-size: 11px; line-height: 13px; text-align: center; color: #fff; }
.checkbox.checked { background: var(--forest); border-color: var(--forest); }
.done .line-body { color: var(--ink-3); text-decoration: line-through; }
.line-body { min-width: 0; overflow-wrap: anywhere; }
.step { border: 1px solid var(--rule-2); border-left: 3px solid var(--forest); border-radius: 8px;
  padding: 4px 8px 10px 12px; margin: 8px 0 !important; }
.step-head { display: flex; gap: 8px; align-items: flex-start; background: var(--paper-2); border-radius: 6px;
  padding: 2px 8px; margin-bottom: 4px; font-weight: 600; line-height: 1.6; }
.step-icon { flex: none; color: var(--forest); margin-top: 4px; }
.step-body > * { margin: 0 0 4px; }
.step-body { line-height: 1.6; }
.labeled { border-left: 3px solid var(--label-color); padding-left: 10px; }
.label { font-size: 11px; font-weight: 500; color: var(--label-color); border: 1px solid var(--label-color);
  border-radius: 4px; padding: 0 5px; margin-right: 8px; line-height: 17px; vertical-align: 3px; letter-spacing: 0; }
.inline-label { padding: 0 0.1em; border-radius: 2px; border-bottom: 1px solid transparent; }
code { font-family: var(--mono); font-size: 0.85em; background: var(--paper-3); border-radius: 4px; padding: 1px 4px; }
pre { background: var(--paper-2); border: 1px solid var(--rule-2); border-radius: 8px; padding: 12px 14px; overflow-x: auto; font-size: 13px; line-height: 1.6; }
pre code { background: none; padding: 0; }
.math math { font-size: 1.05em; }
.math-block { margin: 8px 0 !important; overflow-x: auto; text-align: center; }
.math-block math { font-size: 1.15em; }
.math-src { font-family: var(--mono); }
.link { color: var(--forest); text-decoration: underline; text-underline-offset: 2px; }
.table-wrap { overflow-x: auto; margin: 8px 0 !important; }
table { border-collapse: collapse; font-size: 14px; line-height: 1.5; }
th, td { border: 1px solid var(--rule); padding: 6px 10px; text-align: left; vertical-align: top; }
th { background: var(--paper-2); font-weight: 600; }
figure.image { margin: 10px 0 !important; }
figure.image img { display: block; max-width: 100%; max-height: 420px; border-radius: 6px; border: 1px solid var(--rule-2); }
figcaption { color: var(--ink-3); font-size: 13px; margin-top: 4px; }
.media { display: flex; flex-direction: column; gap: 2px; border: 1px dashed var(--rule); border-radius: 8px; padding: 8px 12px; margin: 6px 0 !important; }
.media-name { font-size: 14px; }
.media-note, .other { color: var(--ink-3); font-size: 12px; }
hr { border: none; border-top: 1px solid var(--rule); margin: 16px 0; }
footer { padding: 10px 24px 14px; border-top: 1px solid var(--rule-2); font-size: 12px; letter-spacing: 0; }
footer p { margin: 0 0 4px; }
.muted { color: var(--ink-3); }
`;
}

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
    `<style>${notePreviewCss()}</style>`,
    "</head>",
    "<body>",
    '<div id="root"></div>',
    `<script>${escapeInlineScript(js)}</script>`,
    "</body>",
    "</html>",
  ].join("\n");
}
