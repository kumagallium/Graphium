// Node.js ランタイムを取得して src-tauri/sidecar/node に配置するスクリプト
// Tauri sidecar として同梱するために使用（GUI 起動時の PATH 問題回避）
//
// macOS の GUI 起動アプリは Finder/launchd 経由で立ち上がり、
// シェルの PATH を継承しないため、ユーザーが Homebrew/nvm で入れた node が
// 見えない。配布版アプリでは Node 自体を同梱する必要がある。

import { existsSync, mkdirSync, copyFileSync, chmodSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

// Node 22 LTS (Jod) — active LTS until 2027-04
const NODE_VERSION = "v22.12.0";
const TARGET_DIR = join(PROJECT_ROOT, "src-tauri", "sidecar");
const TARGET_FILE = join(TARGET_DIR, "node");

const force = process.argv.includes("--force");

if (existsSync(TARGET_FILE) && !force) {
  console.log(`[fetch-node] Already present: ${TARGET_FILE} (use --force to refresh)`);
  process.exit(0);
}

const arch = process.arch === "arm64" ? "arm64" : "x64";
const platform = process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : null;
if (!platform) {
  console.error(`[fetch-node] Unsupported platform: ${process.platform}`);
  process.exit(1);
}

const archiveName = `node-${NODE_VERSION}-${platform}-${arch}`;
const url = `https://nodejs.org/dist/${NODE_VERSION}/${archiveName}.tar.gz`;
const tmpDir = join(PROJECT_ROOT, ".tmp-node-fetch");
const archivePath = join(tmpDir, "node.tar.gz");

mkdirSync(tmpDir, { recursive: true });
mkdirSync(TARGET_DIR, { recursive: true });

console.log(`[fetch-node] Downloading ${url}`);
const dl = spawnSync("curl", ["-fsSL", "-o", archivePath, url], { stdio: "inherit" });
if (dl.status !== 0) {
  console.error("[fetch-node] Download failed");
  rmSync(tmpDir, { recursive: true, force: true });
  process.exit(1);
}

console.log("[fetch-node] Extracting");
const ex = spawnSync("tar", ["xzf", archivePath, "-C", tmpDir], { stdio: "inherit" });
if (ex.status !== 0) {
  console.error("[fetch-node] Extract failed");
  rmSync(tmpDir, { recursive: true, force: true });
  process.exit(1);
}

const sourceNode = join(tmpDir, archiveName, "bin", "node");
copyFileSync(sourceNode, TARGET_FILE);
chmodSync(TARGET_FILE, 0o755);

rmSync(tmpDir, { recursive: true, force: true });
console.log(`[fetch-node] Bundled to ${TARGET_FILE}`);
