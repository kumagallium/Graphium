// Graphium MCP サーバーを単一の .mjs にバンドルする。
// scripts/bundle-server.mjs（sidecar 用）と同じ流儀。
//
// 成果物: dist-mcp/graphium-mcp.mjs（`--outfile <path>` で出力先を変えられる。テストが一時ファイルに出す用）
// Claude Desktop の設定からは `node <このパス>` で起動する。
//
// pdfjs-dist と mammoth は bundle に入れない（get_source_text が使うときに動的 import で読む）。
// bundle は clone の node_modules から解決するので、別の場所へ写すと PDF / Word の文字起こしだけ使えない。
//
// `--app`: デスクトップ版に同梱する形で src-tauri/mcp/ に出す（bundle-server.mjs から呼ばれる）。
// 配布先には clone の node_modules が無いので、mammoth は bundle に入れ、pdfjs-dist は
// Node 用の抽出（src/mcp/pdf-text-node.ts）が使うファイルだけを src-tauri/mcp/node_modules/ に写す。
// pdfjs は自分の package.json の場所から cMap・標準フォントを引くので、パッケージの形のまま置く。

import { build } from "esbuild";
import { cpSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));

// --outfile <path> / --outfile=<path>
function parseOutfile(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--outfile") {
      const value = argv[i + 1];
      if (!value) throw new Error("--outfile には出力先のパスが要ります");
      return resolve(value);
    }
    if (argv[i].startsWith("--outfile=")) return resolve(argv[i].slice("--outfile=".length));
  }
  return join(repoRoot, "dist-mcp", "graphium-mcp.mjs");
}
const appMode = process.argv.includes("--app");
const appDir = join(repoRoot, "src-tauri", "mcp");
const outfile = appMode ? join(appDir, "graphium-mcp.mjs") : parseOutfile(process.argv.slice(2));

if (appMode) rmSync(appDir, { recursive: true, force: true });
mkdirSync(dirname(outfile), { recursive: true });

// ブラウザ専用の PDF 抽出（react-pdf 同梱の pdfjs）は MCP では使わない。wiki-service などが動的 import で
// 参照するため、そのままだと react-pdf と pdfjs が bundle に混ざり、起動時に pdfjs-dist を読みに行ってしまう。
// Node 用の抽出は src/mcp/pdf-text-node.ts が担う（get_source_text が deps で渡す）ので、空の部品に差し替える。
const stubBrowserPdf = {
  name: "stub-browser-pdf",
  setup(b) {
    b.onResolve({ filter: /pdf-text-extractor$/ }, (args) => ({ path: args.path, namespace: "mcp-stub" }));
    b.onLoad({ filter: /.*/, namespace: "mcp-stub" }, () => ({
      contents: [
        "const unsupported = () => { throw new Error(\"ブラウザ専用の PDF 抽出は MCP では使えません\"); };",
        "export const extractPdfText = unsupported;",
        "export const extractPdfPages = unsupported;",
        "export const capForSingleCall = (text) => text;",
        "export const SINGLE_CALL_MAX_CHARS = 80000;",
        "export const PDF_TRUNCATION_MARKER = \"\";",
      ].join("\n"),
      loader: "js",
    }));
  },
};

await build({
  entryPoints: [join(repoRoot, "src/mcp/index.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile,
  // node 標準モジュールは外部化（bundle-server.mjs と同じ扱い）。
  // pdfjs-dist / mammoth は動的 import で読むので bundle 時に解決しない（--app では mammoth だけ入れる）
  external: appMode ? ["node:*", "pdfjs-dist", "pdfjs-dist/*"] : ["node:*", "pdfjs-dist", "pdfjs-dist/*", "mammoth"],
  plugins: [stubBrowserPdf],
  define: {
    __GRAPHIUM_VERSION__: JSON.stringify(pkg.version),
    // Vite の import.meta.env を参照するコード（prov-generator のデバッグ出力など）を Node で動かす
    "import.meta.env.DEV": "false",
    "import.meta.env.BASE_URL": '"/"',
  },
  banner: {
    // ESM バンドルで __dirname 等を参照する依存が混ざったときの保険
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "const require = __createRequire(import.meta.url);",
    ].join("\n"),
  },
  logLevel: "info",
});

if (appMode) {
  // pdf-text-node.ts が使うもの: legacy ビルドの本体と worker、cMap、標準フォント（と解決の起点の package.json）
  const from = join(repoRoot, "node_modules", "pdfjs-dist");
  const to = join(appDir, "node_modules", "pdfjs-dist");
  for (const rel of [
    "package.json",
    "LICENSE",
    "legacy/build/pdf.mjs",
    "legacy/build/pdf.worker.mjs",
    "cmaps",
    "standard_fonts",
  ]) {
    cpSync(join(from, rel), join(to, rel), { recursive: true, dereference: true });
  }
}

process.stdout.write(`bundled: ${outfile}\n`);
