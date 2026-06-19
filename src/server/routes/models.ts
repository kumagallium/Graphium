// モデル管理 API
// GET /api/models — 一覧
// POST /api/models — 追加
// PUT /api/models/:id — 更新
// DELETE /api/models/:id — 削除
// POST /api/models/available — プロバイダーのモデル一覧取得

import { Hono } from "hono";
import { listModels, addModel, updateModel, removeModel, getDefaultModel, getModel } from "../config/models.js";
import { fetchAvailableModels } from "../services/llm.js";

const app = new Hono();

// 登録済みモデル一覧
app.get("/", (c) => {
  const models = listModels();
  const defaultModel = getDefaultModel();
  return c.json({
    models: models.map((m) => ({
      name: m.name,
      provider: m.provider,
      model_id: m.modelId,
      api_base: m.apiBase ?? "",
      supports_function_calling: true,
      id: m.id,
      rate: m.rate
        ? {
            input: m.rate.input,
            output: m.rate.output,
            cache_read: m.rate.cacheRead,
            cache_write: m.rate.cacheWrite,
            currency: m.rate.currency ?? "usd",
          }
        : undefined,
    })),
    default: defaultModel?.name ?? "",
  });
});

// モデル追加
// source_model_id を指定すると、既存モデルの認証情報（apiKey / apiBase）を再利用する
app.post("/", async (c) => {
  const body = await c.req.json<{
    model_name: string;
    provider: string;
    model_id: string;
    api_key?: string;
    api_base?: string;
    source_model_id?: string;
  }>();

  // source_model_id が指定された場合、既存モデルから認証情報を取得
  let apiKey = body.api_key ?? "";
  let apiBase = body.api_base;
  if (body.source_model_id) {
    const source = getModel(body.source_model_id);
    if (!source) {
      return c.json({ error: "参照元モデルが見つかりません" }, 404);
    }
    apiKey = source.apiKey;
    if (apiBase === undefined) apiBase = source.apiBase ?? undefined;
  }

  // claude-subscription は API キー不要（Claude Code のサブスク認証を使う）。
  const requiresApiKey = body.provider !== "claude-subscription";
  if (
    !body.model_name ||
    !body.provider ||
    !body.model_id ||
    (requiresApiKey && !apiKey)
  ) {
    return c.json({ error: "必須フィールドが不足しています" }, 400);
  }

  const model = addModel({
    name: body.model_name,
    provider: body.provider,
    modelId: body.model_id,
    apiKey,
    apiBase: apiBase ?? null,
  });

  return c.json({ message: `Model '${model.name}' added`, id: model.id }, 201);
});

// モデル更新
app.put("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{
    model_name?: string;
    provider?: string;
    model_id?: string;
    api_key?: string;
    api_base?: string;
    rate?: {
      input?: number;
      output?: number;
      cache_read?: number;
      cache_write?: number;
      currency?: "usd" | "jpy";
    } | null;
  }>();

  // rate: null で明示的にクリア、未指定なら更新しない
  let rateUpdate: Parameters<typeof updateModel>[1]["rate"] | undefined = undefined;
  if (body.rate === null) {
    rateUpdate = undefined; // updateModel 側で「触らない」になる扱い
  } else if (body.rate && typeof body.rate.input === "number" && typeof body.rate.output === "number") {
    rateUpdate = {
      input: body.rate.input,
      output: body.rate.output,
      cacheRead: body.rate.cache_read,
      cacheWrite: body.rate.cache_write,
      currency: body.rate.currency === "jpy" ? "jpy" : "usd",
    };
  }

  const updated = updateModel(id, {
    ...(body.model_name ? { name: body.model_name } : {}),
    ...(body.provider ? { provider: body.provider } : {}),
    ...(body.model_id ? { modelId: body.model_id } : {}),
    ...(body.api_key ? { apiKey: body.api_key } : {}),
    ...(body.api_base !== undefined ? { apiBase: body.api_base || null } : {}),
    ...(rateUpdate ? { rate: rateUpdate } : {}),
  });

  if (!updated) {
    return c.json({ error: "モデルが見つかりません" }, 404);
  }
  return c.json({ message: `Model '${updated.name}' updated` });
});

// モデル削除
app.delete("/:id", (c) => {
  const id = c.req.param("id");
  const removed = removeModel(id);
  if (!removed) {
    return c.json({ error: "モデルが見つかりません" }, 404);
  }
  return c.json({ message: "Model deleted" });
});

// プロバイダーのモデル一覧を取得
// source_model_id を指定すると、既存モデルの認証情報を使って取得する
app.post("/available", async (c) => {
  const body = await c.req.json<{
    provider?: string;
    api_key?: string;
    api_base?: string;
    source_model_id?: string;
  }>();

  let provider = body.provider ?? "";
  let apiKey = body.api_key ?? "";
  let apiBaseUrl = body.api_base;

  // source_model_id が指定された場合、既存モデルから認証情報を取得
  if (body.source_model_id) {
    const source = getModel(body.source_model_id);
    if (!source) {
      return c.json({ error: "参照元モデルが見つかりません" }, 404);
    }
    provider = source.provider;
    apiKey = source.apiKey;
    if (apiBaseUrl === undefined) apiBaseUrl = source.apiBase ?? undefined;
  }

  if (!provider || !apiKey) {
    return c.json({ error: "provider と api_key は必須です" }, 400);
  }

  try {
    const models = await fetchAvailableModels(provider, apiKey, apiBaseUrl);
    return c.json({ models });
  } catch (err) {
    const message = err instanceof Error ? err.message : "不明なエラー";
    return c.json({ error: message }, 502);
  }
});

export default app;
