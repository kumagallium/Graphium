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
      // createRequire を最初に作って、同期 require が使えるようにする。
      "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      // ESM bundle では `__dirname` / `__filename` が module スコープに存在しない。
      // CJS 由来の依存はトップレベルで `path.resolve(__dirname, '...')` を読むこと
      // があり、未定義だと bundle ロード時に ReferenceError → exit 99 で sidecar が
      // 起動できない（0.9.2 で jsdom 経由で踏んだ罠の再発防止のための一般化）。
      // bundle 自身の場所を __dirname として露出させる。
      "import { fileURLToPath as __fileURLToPath_polyfill } from 'node:url'; import { dirname as __dirname_polyfill } from 'node:path'; const __filename = __fileURLToPath_polyfill(import.meta.url); const __dirname = __dirname_polyfill(__filename);",
      // boot ログをファイルにも書き出す（stderr pipe を経由しない経路）。
      // Windows で stderr が Tauri Shell まで届かない症状を切り分けるため。
      // - ファイルにも stderr にも書かれない → bundle 自体が実行されていない
      // - ファイルだけ書かれる → stderr pipe が機能していない（Tauri Shell 側の問題）
      // - 両方書かれる → bundle は走っている。続く [server-boot] までの間で hang
      [
        "try {",
        "  const fs = require('node:fs');",
        "  const os = require('node:os');",
        "  const path = require('node:path');",
        "  const bootLogPath = path.join(os.homedir(), 'Documents', 'Graphium', 'sidecar-boot.log');",
        "  fs.mkdirSync(path.dirname(bootLogPath), { recursive: true });",
        "  const line = '[' + new Date().toISOString() + '] boot node=' + process.version + ' platform=' + process.platform + ' arch=' + process.arch + ' pid=' + process.pid + ' argv=' + JSON.stringify(process.argv) + ' execPath=' + process.execPath + ' cwd=' + process.cwd() + '\\n';",
        "  fs.appendFileSync(bootLogPath, line);",
        "  globalThis.__BOOT_LOG_PATH__ = bootLogPath;",
        "  globalThis.__BOOT_LOG_APPEND__ = function(msg) { try { fs.appendFileSync(bootLogPath, '[' + new Date().toISOString() + '] ' + msg + '\\n'); } catch(_) {} };",
        "} catch (e) {",
        "  try { process.stderr.write('[boot-file-error] ' + (e && e.message ? e.message : String(e)) + '\\n'); } catch(_) {}",
        "}",
      ].join("\n"),
      "process.stderr.write('[boot] sidecar process started node=' + process.version + ' platform=' + process.platform + ' pid=' + process.pid + '\\n');",
      "process.on('uncaughtException', (e) => { try { process.stderr.write('[fatal-uncaught] ' + (e && e.stack ? e.stack : String(e)) + '\\n'); } catch(_) {} try { globalThis.__BOOT_LOG_APPEND__ && globalThis.__BOOT_LOG_APPEND__('fatal-uncaught ' + (e && e.stack ? e.stack : String(e))); } catch(_) {} process.exit(99); });",
      "process.on('unhandledRejection', (e) => { try { process.stderr.write('[fatal-rejection] ' + (e && e.stack ? e.stack : String(e)) + '\\n'); } catch(_) {} try { globalThis.__BOOT_LOG_APPEND__ && globalThis.__BOOT_LOG_APPEND__('fatal-rejection ' + (e && e.stack ? e.stack : String(e))); } catch(_) {} });",
      "process.on('exit', (code) => { try { globalThis.__BOOT_LOG_APPEND__ && globalThis.__BOOT_LOG_APPEND__('process exit code=' + code); } catch(_) {} });",
    ].join("\n"),
  },
  minify: true,
  sourcemap: false,
});

console.log("Server bundled to src-tauri/sidecar/server.mjs");
