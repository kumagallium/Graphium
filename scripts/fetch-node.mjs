// Node.js ランタイムを取得して src-tauri/sidecar/ と src-tauri/binaries/ に配置するスクリプト
// Tauri sidecar として同梱するために使用（GUI 起動時の PATH 問題回避）
//
// 配布版アプリでは Node 自体を同梱する必要がある:
//   - macOS: Finder/launchd 経由起動で PATH を継承しない（Homebrew/nvm の node が見えない）
//   - Windows: 同様にシステム標準で node が無い環境を想定
//
// このスクリプトは以下の 2 箇所に node を配置する:
//   1. src-tauri/sidecar/node[.exe]                  ... 互換用（Resources 配下に同梱）
//   2. src-tauri/binaries/graphium-server-<triple>[.exe] ... Tauri sidecar 規約のリネームコピー
//      Tauri は実行時に <name>-<host_target_triple>[.exe] を解決して spawn する。
//      node 自体を sidecar として登録し、JS 側から server.mjs を引数で渡す方式。

import { existsSync, mkdirSync, copyFileSync, chmodSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

// Node 22 LTS (Jod) — active LTS until 2027-04
const NODE_VERSION = "v22.12.0";
const SIDECAR_DIR = join(PROJECT_ROOT, "src-tauri", "sidecar");
const BINARIES_DIR = join(PROJECT_ROOT, "src-tauri", "binaries");

const force = process.argv.includes("--force");

// プラットフォーム判定
const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
if (!isWindows && !isMac) {
  console.error(`[fetch-node] Unsupported platform: ${process.platform} (supported: darwin, win32)`);
  process.exit(1);
}

const arch = process.arch === "arm64" ? "arm64" : "x64";

// host target triple（Tauri sidecar の命名規則に合わせる）
function hostTargetTriple() {
  if (isMac) {
    return arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }
  // Windows は MSVC ABI 固定（Tauri 既定）
  return arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
}

const exeSuffix = isWindows ? ".exe" : "";
const sidecarNodeName = `node${exeSuffix}`;
const sidecarNodePath = join(SIDECAR_DIR, sidecarNodeName);
const binaryName = `graphium-server-${hostTargetTriple()}${exeSuffix}`;
const binaryPath = join(BINARIES_DIR, binaryName);

if (existsSync(sidecarNodePath) && existsSync(binaryPath) && !force) {
  console.log(`[fetch-node] Already present (use --force to refresh):`);
  console.log(`  - ${sidecarNodePath}`);
  console.log(`  - ${binaryPath}`);
  process.exit(0);
}

const platform = isMac ? "darwin" : "win";
const archiveExt = isWindows ? "zip" : "tar.gz";
const archiveName = `node-${NODE_VERSION}-${platform}-${arch}`;
const url = `https://nodejs.org/dist/${NODE_VERSION}/${archiveName}.${archiveExt}`;
const tmpDir = join(PROJECT_ROOT, ".tmp-node-fetch");
const archivePath = join(tmpDir, `node.${archiveExt}`);

mkdirSync(tmpDir, { recursive: true });
mkdirSync(SIDECAR_DIR, { recursive: true });
mkdirSync(BINARIES_DIR, { recursive: true });

console.log(`[fetch-node] Downloading ${url}`);
const dl = spawnSync("curl", ["-fsSL", "-o", archivePath, url], { stdio: "inherit" });
if (dl.status !== 0) {
  console.error("[fetch-node] Download failed");
  rmSync(tmpDir, { recursive: true, force: true });
  process.exit(1);
}

console.log("[fetch-node] Extracting");
let extractStatus;
if (isWindows) {
  // Windows: PowerShell の Expand-Archive を使う（unzip コマンドは標準で無い）
  const ps = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Expand-Archive -Path '${archivePath}' -DestinationPath '${tmpDir}' -Force`,
    ],
    { stdio: "inherit" },
  );
  extractStatus = ps.status;
} else {
  const ex = spawnSync("tar", ["xzf", archivePath, "-C", tmpDir], { stdio: "inherit" });
  extractStatus = ex.status;
}
if (extractStatus !== 0) {
  console.error("[fetch-node] Extract failed");
  rmSync(tmpDir, { recursive: true, force: true });
  process.exit(1);
}

// 展開後の node バイナリの位置（プラットフォーム別）
//   macOS:   <archiveName>/bin/node
//   Windows: <archiveName>/node.exe
const sourceNode = isWindows
  ? join(tmpDir, archiveName, "node.exe")
  : join(tmpDir, archiveName, "bin", "node");

// 1. sidecar/node[.exe] に配置
copyFileSync(sourceNode, sidecarNodePath);
if (!isWindows) chmodSync(sidecarNodePath, 0o755);

// 2. binaries/graphium-server-<triple>[.exe] に配置（Tauri sidecar 規約）
copyFileSync(sourceNode, binaryPath);
if (!isWindows) chmodSync(binaryPath, 0o755);

rmSync(tmpDir, { recursive: true, force: true });
console.log(`[fetch-node] Bundled:`);
console.log(`  - ${sidecarNodePath}`);
console.log(`  - ${binaryPath}`);
