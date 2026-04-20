// Graphium バックエンドサーバー（Node.js 常駐プロセス用）
// デスクトップ（Tauri sidecar）・Docker で使用
// Vercel Serverless Functions では api/[[...route]].ts を使用

import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { setDataDir as setModelsDataDir } from "./config/models.js";
import { setDataDir as setProfilesDataDir } from "./config/profiles.js";
import { createApp } from "./app.js";

// データディレクトリ設定（環境変数 or デフォルト）
// デスクトップアプリ（sidecar）では ~/Documents/Graphium/server-data を使用
import { homedir } from "node:os";
import { accessSync, constants as fsConstants } from "node:fs";

function resolveDataDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  const cwdData = join(process.cwd(), "data");
  // cwd が書き込み可能ならそのまま使う（dev モード / Docker）
  try {
    accessSync(process.cwd(), fsConstants.W_OK);
    return cwdData;
  } catch {
    // 書き込み不可（ビルド版アプリ）→ ユーザーのドキュメントフォルダ
    return join(homedir(), "Documents", "Graphium", "server-data");
  }
}
const dataDir = resolveDataDir();
console.log(`[server] Data directory: ${dataDir}`);
setModelsDataDir(dataDir);
setProfilesDataDir(dataDir);

const app = createApp({ mode: "node" });

// 本番環境: 静的ファイル配信（SERVE_STATIC 環境変数で有効化）
const staticDir = process.env.SERVE_STATIC;
if (staticDir && existsSync(staticDir)) {
  // /Graphium/ パスで静的ファイルを配信
  app.use("/Graphium/*", serveStatic({ root: staticDir, rewriteRequestPath: (path) => path.replace(/^\/Graphium/, "") }));
  // SPA フォールバック: /Graphium 配下の未マッチルートに index.html を返す
  app.get("/Graphium/*", serveStatic({ root: staticDir, path: "index.html" }));
  // ルートを /Graphium/ にリダイレクト
  app.get("/", (c) => c.redirect("/Graphium/"));
}

// サーバー起動
const port = Number(process.env.PORT ?? 3001);

serve({ fetch: app.fetch, port }, () => {
  console.log(`Graphium backend running on http://localhost:${port}`);
  if (staticDir) {
    console.log(`Serving static files from ${staticDir}`);
  }
});

export default app;
