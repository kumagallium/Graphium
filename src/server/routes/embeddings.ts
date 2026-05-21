// 埋め込みモデルの接続テスト用エンドポイント
//
// 設定モーダルから「テスト」ボタンが叩く。リクエストに含まれる
// X-LLM-API-Key ヘッダー（あるいはサーバー側に登録済みのモデル）を使って
// 単発の embedding 呼び出しを行い、成功 / 失敗を返す。
//
// 成功すれば「このモデルは埋め込みに対応している」と確定できる。
// 失敗時はプロバイダーが返したエラーメッセージをそのまま伝えるので、
// 「This model is not available.」のような原因がそのまま UI に出る。

import { Hono } from "hono";
import { resolveModelConfig } from "../services/header-model.js";
import { generateEmbeddings } from "../services/embedding.js";

const app = new Hono();

// 埋め込みモデルの 1 件テスト
app.post("/test", async (c) => {
  // ヘッダー or サーバー登録済みからモデル設定を解決
  const modelConfig = resolveModelConfig(c);
  if (!modelConfig) {
    return c.json(
      { ok: false, error: "モデル設定が見つかりませんでした。" },
      400,
    );
  }

  try {
    const result = await generateEmbeddings(["test"], modelConfig);
    const dimensions = result.vectors[0]?.length ?? 0;
    return c.json({
      ok: true,
      modelVersion: result.modelVersion,
      dimensions,
    });
  } catch (err) {
    // プロバイダーが返したエラー文をそのまま伝える。
    // 「This model is not available.」など、ユーザーが原因を判別しやすい文面を保つ。
    const message = err instanceof Error ? err.message : String(err);
    console.error("[embeddings/test] failed:", err);
    return c.json({ ok: false, error: message }, 400);
  }
});

export default app;
