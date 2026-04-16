// Tauri sidecar（バックエンドサーバー）のライフサイクル管理
// Tauri 環境でのみ使用される

import { isTauri } from "./platform";

const HEALTH_URL = "http://localhost:3001/api/health";
const MAX_RETRIES = 20;
const RETRY_INTERVAL_MS = 500;

type SidecarChild = {
  kill: () => Promise<void>;
};

let sidecarProcess: SidecarChild | null = null;

/** sidecar サーバーのヘルスチェック */
async function waitForHealth(): Promise<boolean> {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const res = await fetch(HEALTH_URL);
      if (res.ok) return true;
    } catch {
      // まだ起動していない
    }
    await new Promise((r) => setTimeout(r, RETRY_INTERVAL_MS));
  }
  return false;
}

/** sidecar サーバーを起動する */
export async function startSidecar(): Promise<boolean> {
  if (!isTauri()) return false;

  // 既にサーバーが動いている場合はスキップ（dev モードで別途起動済みなど）
  try {
    const res = await fetch(HEALTH_URL);
    if (res.ok) {
      console.log("[sidecar] Backend already running");
      return true;
    }
  } catch {
    // 起動されていない → sidecar を起動する
  }

  try {
    const { Command } = await import("@tauri-apps/plugin-shell");
    const { documentDir, join: pathJoin } = await import("@tauri-apps/api/path");
    // データディレクトリを明示的に指定（process.cwd() の不安定さを回避）
    const docsDir = await documentDir();
    const dataDir = await pathJoin(docsDir, "Graphium", "server-data");

    const command = Command.sidecar("binaries/graphium-server", [], {
      env: {
        PORT: "3001",
        CORS_ORIGINS: "http://localhost:5174,tauri://localhost,http://tauri.localhost,https://tauri.localhost",
        DATA_DIR: dataDir,
      },
    });

    command.stdout.on("data", (line: string) => {
      console.log(`[sidecar] ${line}`);
    });
    command.stderr.on("data", (line: string) => {
      console.error(`[sidecar] ${line}`);
    });

    const child = await command.spawn();
    sidecarProcess = child;

    console.log("[sidecar] Starting backend server...");
    const healthy = await waitForHealth();
    if (healthy) {
      console.log("[sidecar] Backend server is ready");
    } else {
      console.warn("[sidecar] Backend server failed to start");
    }
    return healthy;
  } catch (e) {
    console.error("[sidecar] Failed to spawn:", e);
    return false;
  }
}

/** sidecar サーバーを停止する */
export async function stopSidecar(): Promise<void> {
  if (sidecarProcess) {
    try {
      await sidecarProcess.kill();
      console.log("[sidecar] Backend server stopped");
    } catch (e) {
      console.error("[sidecar] Failed to stop:", e);
    }
    sidecarProcess = null;
  }
}
