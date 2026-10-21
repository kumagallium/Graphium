// モデル管理 API
// GET /api/models — 一覧
// POST /api/models — 追加
// PUT /api/models/:id — 更新
// DELETE /api/models/:id — 削除
// POST /api/models/available — プロバイダーのモデル一覧取得

import { Hono, type Context, type MiddlewareHandler } from "hono";
import { listModels, addModel, updateModel, removeModel, getDefaultModel, getModel } from "../config/models.js";
import { fetchAvailableModels, isCopilotCliAvailable } from "../services/llm.js";
import { aiErrorCodeOf, errorBody } from "../../lib/ai-error-codes.js";
import { isSubscriptionProvider } from "../../lib/subscription-providers.js";
import { resolveCopilotBinaryAsync } from "../services/cli-binary-resolver.js";
import { copilotCliManager, CopilotCliError } from "../services/copilot-cli-manager.js";
import { listCopilotModels } from "../services/copilot-subscription.js";
import { isDuplicateModelName } from "../../lib/model-name-rules.js";

const app = new Hono();

// 表示名の重複を断るときの本文。クライアントは同じ文言をローカルで先に出すが、
// クライアントを通らない呼び出し（curl 等）でも同じ規則で断る。
const DUPLICATE_MODEL_NAME_ERROR =
  "Another model already has this name. Give this one a different name.";

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

// GitHub Copilot CLI が検出できるか（copilot-subscription の 1-click 登録を出すか判定）。
// claude と違いアカウント情報は返さない — Copilot CLI のログイン情報は公開された
// 設定ファイルに無く、確認には CLI の spawn が必要で設定画面を開くたびに払うには重い。
app.get("/copilot-cli-status", (c) => {
  return c.json({ available: isCopilotCliAvailable() });
});

// ---- Copilot CLI の取得とログイン（設定 → AI の「Copilot に接続」） ----

// 状態を変える POST は application/json だけ受ける。他サイトのフォーム等（simple request）から
// CLI の取得・ログインが起動されないようにする（JSON は CORS のプリフライトを要する）
const requireJson: MiddlewareHandler = async (c, next) => {
  const type = c.req.header("content-type") ?? "";
  if (!/^application\/json\b/i.test(type)) {
    return c.json(
      { error: "Content-Type must be application/json", code: "UNSUPPORTED_MEDIA_TYPE" },
      415,
    );
  }
  await next();
};
app.use("/copilot/install", requireJson);
app.use("/copilot/install/cancel", requireJson);
app.use("/copilot/login", requireJson);
app.use("/copilot/login/cancel", requireJson);

// 状態（軽い。CLI は起動しない）
app.get("/copilot/status", async (c) => c.json(await copilotCliManager.getStatus()));

// 公式配布物の取得を始める（進捗は status で読む）
app.post("/copilot/install", (c) => {
  try {
    copilotCliManager.startInstall();
    return c.json({}, 202);
  } catch (err) {
    return copilotErrorResponse(c, err);
  }
});

app.post("/copilot/install/cancel", (c) => {
  copilotCliManager.cancelInstall();
  return c.json({});
});

// ログインを始める（mode: web=ブラウザ承認 / device=8 桁コード）
app.post("/copilot/login", async (c) => {
  const body = await c.req.json<{ mode?: string }>().catch(() => ({}) as { mode?: string });
  const mode = body.mode === "device" ? "device" : "web";
  try {
    await copilotCliManager.startLogin(mode);
    return c.json({}, 202);
  } catch (err) {
    return copilotErrorResponse(c, err);
  }
});

app.post("/copilot/login/cancel", (c) => {
  copilotCliManager.cancelLogin();
  return c.json({});
});

// ログインと利用資格の確認（CLI を起動してモデル一覧を取る。重いのでボタン操作時だけ）
app.get("/copilot/auth", async (c) => {
  const cli = await resolveCopilotBinaryAsync();
  if (!cli) {
    return c.json({
      ok: false,
      code: "COPILOT_CLI_MISSING",
      message: "Copilot CLI is not installed",
    });
  }
  try {
    const models = await listCopilotModels(cli.path);
    return c.json({ ok: true, models });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code =
      aiErrorCodeOf(err) === "COPILOT_SUBSCRIPTION_AUTH_EXPIRED"
        ? "COPILOT_NOT_SIGNED_IN"
        : classifyCopilotAuthError(message);
    return c.json({ ok: false, code, message });
  }
});

/**
 * auth の失敗文を分類する。未ログイン・認証切れ（401 含む）は NOT_SIGNED_IN、
 * 認証は通るが使えない（契約・ポリシー）は NO_ACCESS、どれにも当たらなければ CHECK_FAILED
 * （UI は勝手にログインを始めず「確認できなかった」＋再試行にする）。
 */
export function classifyCopilotAuthError(
  message: string,
): "COPILOT_NOT_SIGNED_IN" | "COPILOT_NO_ACCESS" | "COPILOT_CHECK_FAILED" {
  if (
    /not authenticated|authentication (is )?(missing|required|expired)|not (signed|logged) in|sign in|log ?in required|unauthorized|\b401\b/i.test(
      message,
    )
  ) {
    return "COPILOT_NOT_SIGNED_IN";
  }
  if (/no access|not entitled|no copilot|subscription|policy|forbidden|\b403\b|not enabled/i.test(message)) {
    return "COPILOT_NO_ACCESS";
  }
  return "COPILOT_CHECK_FAILED";
}

function copilotErrorResponse(c: Context, err: unknown) {
  if (err instanceof CopilotCliError) {
    const status =
      err.code === "ALREADY_INSTALLING" || err.code === "ALREADY_SIGNING_IN" ? 409 : 400;
    return c.json({ error: err.message, code: err.code }, status);
  }
  return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
}

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
      return c.json({ error: "Source model not found" }, 404);
    }
    apiKey = source.apiKey;
    if (apiBase === undefined) apiBase = source.apiBase ?? undefined;
  }

  // サブスク型プロバイダは API キー不要（各 CLI のサブスク認証を使う）。
  const requiresApiKey = !isSubscriptionProvider(body.provider);
  if (
    !body.model_name ||
    !body.provider ||
    !body.model_id ||
    (requiresApiKey && !apiKey)
  ) {
    return c.json({ error: "Required fields are missing" }, 400);
  }

  // 表示名は一意という前提で名前引き（resolveModelConfig 等）が動くため、追加時点で断る。
  // code を付けるのは、クライアントが多言語化した文言に置き換えられるようにするため
  // （error は curl 等クライアントを通らない呼び出し向けの英語メッセージとして残す）
  if (isDuplicateModelName(body.model_name, "", listModels())) {
    return c.json({ error: DUPLICATE_MODEL_NAME_ERROR, code: "DUPLICATE_MODEL_NAME" }, 400);
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

  // 名前を変えるときだけ重複を確認する。変えない PUT（API キーだけ更新する等）は、既に
  // 重複した名前を持っている利用者の操作を止めないため、必ず通す。
  if (body.model_name !== undefined) {
    const current = getModel(id);
    if (
      current &&
      body.model_name.trim() !== current.name.trim() &&
      isDuplicateModelName(body.model_name, id, listModels())
    ) {
      return c.json({ error: DUPLICATE_MODEL_NAME_ERROR, code: "DUPLICATE_MODEL_NAME" }, 400);
    }
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
    return c.json({ error: "Model not found" }, 404);
  }
  return c.json({ message: `Model '${updated.name}' updated` });
});

// モデル削除
app.delete("/:id", (c) => {
  const id = c.req.param("id");
  const removed = removeModel(id);
  if (!removed) {
    return c.json({ error: "Model not found" }, 404);
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
      return c.json({ error: "Source model not found" }, 404);
    }
    provider = source.provider;
    apiKey = source.apiKey;
    if (apiBaseUrl === undefined) apiBaseUrl = source.apiBase ?? undefined;
  }

  // copilot-subscription は API キーを持たない（CLI の listModels で取得する）
  if (!provider || (!apiKey && !isSubscriptionProvider(provider))) {
    return c.json({ error: "provider and api_key are required" }, 400);
  }

  try {
    const models = await fetchAvailableModels(provider, apiKey, apiBaseUrl);
    return c.json({ models });
  } catch (err) {
    // fetchAvailableModels 由来の CodedError（INVALID_API_KEY 等）は code を JSON に通す
    return c.json(errorBody(err), 502);
  }
});

export default app;
