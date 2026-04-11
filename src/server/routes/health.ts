// ヘルスチェック API
// GET /api/health — バックエンド + Registry の接続状態

import { Hono } from "hono";
import { getRegistryUrl } from "../services/env.js";

const app = new Hono();

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

  return c.json({
    status: registryStatus === "ok" ? "healthy" : "degraded",
    components: {
      backend: "ok",
      registry: registryStatus,
    },
    version: "1.0.0",
  });
});

export default app;
