// エージェント実行 API
// POST /api/agent/run — メッセージを送信して AI 回答を取得

import { Hono } from "hono";
import type { ModelMessage } from "ai";
import { getProfile, listProfiles } from "../config/profiles.js";
import { createModel } from "../services/llm.js";
import { runAgentLoop } from "../services/agent-loop.js";
import { resolveModelConfig } from "../services/header-model.js";
import { fetchRegistryServers, filterMCPServers, filterSkills, buildSkillPromptSection, buildMCPUrl, detectTransport } from "../services/registry.js";
import { connectMCPServers, closeMCPClients } from "../services/mcp.js";
import { getRegistryUrl, getRegistryKey } from "../services/env.js";

const app = new Hono();

// Crucible Agent 互換のリクエスト/レスポンス形式
app.post("/run", async (c) => {
  const body = await c.req.json<{
    message: string;
    session_id?: string;
    profile?: string;
    custom_instructions?: string;
    messages?: ModelMessage[];
    server_names?: string[];
    disabled_tools?: string[];
    /** Wiki Retriever が検索したコンテキスト（フロントエンドで embedding 検索済み） */
    wiki_context?: string;
    options?: {
      max_turns?: number;
      model?: string;
    };
  }>();

  if (!body.message && (!body.messages || body.messages.length === 0)) {
    return c.json({ error: "message は必須です" }, 400);
  }

  // モデル解決: ヘッダー → options.model → デフォルト
  const modelConfig = resolveModelConfig(c, { modelName: body.options?.model });

  if (!modelConfig) {
    return c.json(
      { error: "モデルが登録されていません。Settings → AI Setup からモデルを追加してください。" },
      400,
    );
  }

  // プロファイル解決
  const profileName = body.profile || "science";
  const profile = getProfile(profileName) ?? listProfiles()[0];
  let systemPrompt = profile?.content ?? "You are a helpful assistant.";
  if (body.custom_instructions) {
    systemPrompt += `\n\n${body.custom_instructions}`;
  }

  // メッセージ構築
  // フロントエンドから messages 配列が渡された場合はそれを使う
  // 後方互換: message のみの場合は単一ユーザーメッセージとして扱う
  const messages: ModelMessage[] = body.messages ?? [
    { role: "user" as const, content: body.message },
  ];

  // Registry からツール・スキル取得
  const registryUrl = getRegistryUrl(c);
  const registryKey = getRegistryKey();
  const allServers = await fetchRegistryServers(registryUrl, registryKey);

  // Wiki コンテキストを注入（Retriever 結果）
  if (body.wiki_context) {
    systemPrompt += `\n\n${body.wiki_context}`;
  }

  // Skill をシステムプロンプトに注入
  const skills = filterSkills(allServers);
  const skillSection = buildSkillPromptSection(skills);
  if (skillSection) {
    systemPrompt += skillSection;
  }

  // MCP ツール取得
  let mcpServers = filterMCPServers(allServers);
  // server_names が指定されていたら、そのサーバーのみ接続
  if (body.server_names && body.server_names.length > 0) {
    const allowed = new Set(body.server_names);
    mcpServers = mcpServers.filter((s) => allowed.has(s.name));
  }
  // disabled_tools が指定されていたら、そのサーバーを除外
  if (body.disabled_tools && body.disabled_tools.length > 0) {
    const disabled = new Set(body.disabled_tools);
    mcpServers = mcpServers.filter((s) => !disabled.has(s.name));
  }
  const mcpEndpoints = mcpServers.map((s) => ({
    ...s,
    url: buildMCPUrl(s, registryUrl),
    transport: detectTransport(s),
  }));
  const { tools, clients } = await connectMCPServers(mcpEndpoints);

  try {
    const model = createModel(modelConfig);
    const result = await runAgentLoop({
      model,
      modelId: modelConfig.modelId,
      systemPrompt,
      messages,
      tools,
      maxSteps: body.options?.max_turns ?? 10,
    });

    return c.json({
      session_id: body.session_id ?? crypto.randomUUID(),
      message: result.message,
      tool_calls: result.toolCalls,
      provenance_id: null,
      token_usage: result.tokenUsage,
      model: result.model,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "不明なエラー";
    console.error("Agent run error:", err);
    return c.json({ error: message }, 500);
  } finally {
    await closeMCPClients(clients);
  }
});

// セッションタイトル生成
app.post("/sessions/title", async (c) => {
  const body = await c.req.json<{ first_message: string }>();
  if (!body.first_message) {
    return c.json({ error: "first_message は必須です" }, 400);
  }

  const modelConfig = resolveModelConfig(c);
  if (!modelConfig) {
    // フォールバック: 先頭25文字
    const title = body.first_message.slice(0, 25) +
      (body.first_message.length > 25 ? "…" : "");
    return c.json({ title });
  }

  try {
    const model = createModel(modelConfig);
    const { generateText } = await import("ai");
    const result = await generateText({
      model,
      system:
        "Generate a concise title (15-25 characters) that summarizes the user's message. " +
        "Return only the title, no quotes or formatting.",
      messages: [{ role: "user", content: body.first_message }],
    });

    return c.json({ title: result.text.trim() });
  } catch {
    const title = body.first_message.slice(0, 25) +
      (body.first_message.length > 25 ? "…" : "");
    return c.json({ title });
  }
});

export default app;
