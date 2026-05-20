// Hono サーバーを単一ファイルにバンドルするスクリプト
// Tauri sidecar として同梱するために使用
import { build } from "esbuild";

await build({
  entryPoints: ["src/server/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "src-tauri/sidecar/server.mjs",
  // Node.js 組み込みモジュールは外部化
  external: ["node:*"],
  // バナーで import.meta.url 対応
  //
  // 追加で:
  // 1. 起動直後に stderr へ probe を 1 行書く。Tauri Shell sidecar の
  //    stdout/stderr は行単位なので、改行付きの probe が届けば pipe が機能
  //    していると分かる。Windows で「spawn 成功・ログ 0 行・close も出ない」
  //    という症状の切り分けに必須。
  // 2. uncaughtException / unhandledRejection を捕まえて stderr に吐く。
  //    server/index.ts の top-level import が同期的に throw した場合の
  //    無音終了を防ぐ。
  banner: {
    js: [
      "process.stderr.write('[boot] sidecar process started node=' + process.version + ' platform=' + process.platform + ' pid=' + process.pid + '\\n');",
      "process.on('uncaughtException', (e) => { try { process.stderr.write('[fatal-uncaught] ' + (e && e.stack ? e.stack : String(e)) + '\\n'); } catch(_) {} process.exit(99); });",
      "process.on('unhandledRejection', (e) => { try { process.stderr.write('[fatal-rejection] ' + (e && e.stack ? e.stack : String(e)) + '\\n'); } catch(_) {} });",
      "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    ].join("\n"),
  },
  minify: true,
  sourcemap: false,
});

console.log("Server bundled to src-tauri/sidecar/server.mjs");
