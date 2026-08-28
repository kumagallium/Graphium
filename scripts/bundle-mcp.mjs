// Graphium MCP サーバーを単一の .mjs にバンドルする。
// scripts/bundle-server.mjs（sidecar 用）と同じ流儀。
//
// 成果物: dist-mcp/graphium-mcp.mjs
// Claude Desktop の設定からは `node <このパス>` で起動する。

import { build } from "esbuild";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const outfile = join(repoRoot, "dist-mcp", "graphium-mcp.mjs");

mkdirSync(dirname(outfile), { recursive: true });

await build({
  entryPoints: [join(repoRoot, "src/mcp/index.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile,
  // node 標準モジュールは外部化（bundle-server.mjs と同じ扱い）
  external: ["node:*"],
  define: {
    __GRAPHIUM_VERSION__: JSON.stringify(pkg.version),
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

process.stdout.write(`bundled: ${outfile}\n`);
