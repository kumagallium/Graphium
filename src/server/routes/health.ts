// ヘルスチェック API
// GET /api/health — バックエンドの応答 + 認証状態
// Crucible Registry への疎通確認は外した（設定の registryUrl は savedRegistries へ
// 移して常に空なので、ほぼ全員の画面で常に「未接続」と出ていた）。

import { Hono } from "hono";
import { findModelsWithMissingApiKey } from "../config/models.js";

const app = new Hono();

// sidecar 自身を識別するための情報。index.ts から起動時に注入される。
// バンドル版アプリが port 3001 で他人 sidecar（消えた worktree の幽霊など）や
// 自動更新前の古い自分を検知できるよう、/api/health に pid / dataDir / version を
// 返す。version はアプリ本体が GRAPHIUM_APP_VERSION で渡したビルドバージョン。
let sidecarIdentity: { pid: number; dataDir: string; version: string } = {
  pid: typeof process !== "undefined" ? process.pid : 0,
  dataDir: "",
  version: "dev",
};

/** アプリの版（GRAPHIUM_APP_VERSION。dev 起動では "dev"） */
export function getSidecarVersion(): string {
  return sidecarIdentity.version;
}

export function setSidecarIdentity(info: {
  pid: number;
  dataDir: string;
  version?: string;
}): void {
  sidecarIdentity = { ...info, version: info.version ?? "dev" };
}

app.get("/", async (c) => {
  // 認証状態: 保存済みの API キーが読めないモデルが居ないか確認する。
  // Keychain ダウングレード罠（旧バイナリ + Keychain 移行済み環境）の早期発見用。
  const missingKeyModels = findModelsWithMissingApiKey();
  const authStatus: "ok" | "keys-missing" =
    missingKeyModels.length === 0 ? "ok" : "keys-missing";

  // auth が壊れていると AI 機能が使えなくなるので、その時だけ degraded にする。
  // 細かい判断は components.auth を見て UI 側で行う。
  return c.json({
    status: authStatus === "keys-missing" ? "degraded" : "healthy",
    components: {
      backend: "ok",
      auth: authStatus,
    },
    /**
     * キーが読めないモデルのメタ情報。UI で「どのモデル / どのプロバイダーの
     * キーを貼り直せばいいか」を提示するために返す。apiKey 本体は含まない。
     */
    missingKeyModels,
    // アプリ本体のビルドバージョン。フロントが起動時に getVersion() と照合し、
    // 食い違えば「古い sidecar」として置き換える。dev / Docker では "dev"。
    version: sidecarIdentity.version,
    pid: sidecarIdentity.pid,
    dataDir: sidecarIdentity.dataDir,
  });
});

export default app;
