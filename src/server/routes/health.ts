// ヘルスチェック API
// GET /api/health — バックエンド + Registry の接続状態 + 認証状態

import { Hono } from "hono";
import { getRegistryUrl } from "../services/env.js";
import { findModelsWithMissingApiKey } from "../config/models.js";

const app = new Hono();

// sidecar 自身を識別するための情報。index.ts から起動時に注入される。
// バンドル版アプリが port 3001 で他人 sidecar（消えた worktree の幽霊など）を
// 検知できるよう、/api/health に pid と dataDir を返す。
let sidecarIdentity: { pid: number; dataDir: string } = {
  pid: typeof process !== "undefined" ? process.pid : 0,
  dataDir: "",
};

export function setSidecarIdentity(info: { pid: number; dataDir: string }): void {
  sidecarIdentity = info;
}

app.get("/", async (c) => {
  const registryUrl = getRegistryUrl(c);
  let registryStatus: "ok" | "unavailable" = "unavailable";

  if (registryUrl) {
    try {
      const res = await fetch(`${registryUrl.replace(/\/$/, "")}/api/servers`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) registryStatus = "ok";
    } catch {
      // 接続失敗
    }
  }

  // 認証状態: 保存済みの API キーが読めないモデルが居ないか確認する。
  // Keychain ダウングレード罠（旧バイナリ + Keychain 移行済み環境）の早期発見用。
  const missingKeyModels = findModelsWithMissingApiKey();
  const authStatus: "ok" | "keys-missing" =
    missingKeyModels.length === 0 ? "ok" : "keys-missing";

  // status は registry が unavailable でも auth が ok なら degraded で十分。
  // auth が壊れていると AI 機能が完全に不能になるので、その時は warning を最優先にする。
  // ここでは status を細分化せず、components.auth を見て UI 側で判断させる。
  return c.json({
    status:
      authStatus === "keys-missing" || registryStatus !== "ok"
        ? "degraded"
        : "healthy",
    components: {
      backend: "ok",
      registry: registryStatus,
      auth: authStatus,
    },
    /**
     * キーが読めないモデルのメタ情報。UI で「どのモデル / どのプロバイダーの
     * キーを貼り直せばいいか」を提示するために返す。apiKey 本体は含まない。
     */
    missingKeyModels,
    version: "1.0.0",
    pid: sidecarIdentity.pid,
    dataDir: sidecarIdentity.dataDir,
  });
});

export default app;
