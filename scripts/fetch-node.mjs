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

import { existsSync, mkdirSync, copyFileSync, chmodSync, rmSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

// Node 22 LTS (Jod) — maintenance LTS until 2027-04。
// 同梱する node は配布物の一部なので、Node.js のセキュリティリリースが出たらここを上げる
// （2026-10-21 のリリース: Brotli の OOB write・TLS のホスト名検査・dns の NUL 切り詰めなど 10 件）
const NODE_VERSION = "v22.23.4";
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

const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * curl で取得する。失敗したら間を置いて試し直す（プロセス単位で 3 回・curl 自身の再試行も 3 回）。
 * 2026-10-28 のリリースビルドで nodejs.org からの取得が HTTP/2 の INTERNAL_ERROR で 2 回続けて落ち、
 * 手動の再実行でしか通らなかった。HTTP/1.1 に固定して stream のエラー自体を避ける
 */
function download(label, from, to) {
  const args = [
    "-fsSL", "--http1.1",
    "--connect-timeout", "30",
    "--retry", "3", "--retry-delay", "2", "--retry-all-errors",
    "-o", to, from,
  ];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = spawnSync("curl", args, { stdio: "inherit" });
    if (r.status === 0) return true;
    console.error(`[fetch-node] ${label}: download failed (attempt ${attempt}/3)`);
    if (attempt < 3) sleepMs(3000 * attempt);
  }
  return false;
}

function fail(message) {
  console.error(`[fetch-node] ${message}`);
  rmSync(tmpDir, { recursive: true, force: true });
  process.exit(1);
}

console.log(`[fetch-node] Downloading ${url}`);
if (!download("archive", url, archivePath)) fail("Download failed");

// 配布物に入る実行ファイルなので、nodejs.org の SHASUMS256.txt と突き合わせてから使う
// （差し替えられた・途中で切れたアーカイブをそのまま同梱しない）
const shasumsUrl = `https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt`;
const shasumsPath = join(tmpDir, "SHASUMS256.txt");
console.log(`[fetch-node] Downloading ${shasumsUrl}`);
if (!download("SHASUMS256.txt", shasumsUrl, shasumsPath)) fail("Download failed (SHASUMS256.txt)");
const archiveFile = `${archiveName}.${archiveExt}`;
const expected = readFileSync(shasumsPath, "utf8")
  .split("\n")
  .map((line) => line.trim().split(/\s+/))
  .find(([, name]) => name === archiveFile)?.[0];
if (!expected) fail(`SHASUMS256.txt has no entry for ${archiveFile}`);
const actual = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
if (actual !== expected) fail(`sha256 mismatch for ${archiveFile}\n  expected ${expected}\n  actual   ${actual}`);
console.log(`[fetch-node] sha256 OK (${expected.slice(0, 12)}…)`);

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
