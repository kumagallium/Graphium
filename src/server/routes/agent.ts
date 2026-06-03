// エージェント実行 API
// POST /api/agent/run — メッセージを送信して AI 回答を取得

import { Hono } from "hono";
import type { ModelMessage } from "ai";
import { getProfile, listProfiles } from "../config/profiles.js";
import { createModel } from "../services/llm.js";
import { runAgentLoop } from "../services/agent-loop.js";
import { resolveModelConfig } from "../services/header-model.js";
import { fetchRegistryServers, filterMCPServers, filterSkills, buildSkillPromptSection, buildMCPUrl, detectTransport } from "../services/registry.js";
import { getMCPTools, type MCPServerInfo } from "../services/mcp.js";
import { getRegistryUrl, getRegistryKey, getManualMcpServers } from "../services/env.js";
import { buildLabeledOutputInstruction } from "../../features/ai-assistant/label-markers.js";

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
    /** 構造化出力（コンテキストラベル）の指示に使う言語 */
    language?: string;
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

  // プロファイル解決（明示指定がなければ汎用アシスタントを既定とする）
  const profileName = body.profile || "general";
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

  // 構造化出力（コンテキストラベル）指示
  // OpenAI 互換系（gpt-oss-120b 等）はネイティブ tool calling 非対応で system prompt に
  // tool 定義を埋め込む fallback ループを使うため、長大な PROV ラベル指示と競合してツール
  // 呼び出しが弱まる。Ask モードでは PROV ラベルを生成する必然性も薄いので抑制する。
  const skipLabeledOutput = modelConfig.provider === "openai-compatible";
  if (!skipLabeledOutput) {
    systemPrompt += buildLabeledOutputInstruction(body.language || "en");
  }

  // Skill をシステムプロンプトに注入
  const skills = filterSkills(allServers);
  const skillSection = buildSkillPromptSection(skills);
  if (skillSection) {
    systemPrompt += skillSection;
  }

  // MCP ツール取得
  // server_names（許可リスト）/ disabled_tools（除外リスト）は Registry 由来・手動登録の
  // 両方に同じ規約で適用する。
  const allowedNames = body.server_names && body.server_names.length > 0
    ? new Set(body.server_names)
    : null;
  const disabledNames = new Set(body.disabled_tools ?? []);
  const passesFilter = (name: string): boolean =>
    (!allowedNames || allowedNames.has(name)) && !disabledNames.has(name);

  // (1) Crucible Registry 由来のサーバー（registryUrl が空なら空配列）。すべて remote。
  const registryEndpoints: MCPServerInfo[] = filterMCPServers(allServers)
    .filter((s) => passesFilter(s.name))
    .map((s) => ({
      id: `registry:${s.name}`,
      type: "remote",
      name: s.name,
      url: buildMCPUrl(s, registryUrl),
      transport: detectTransport(s),
    }));

  // (2) ユーザーが直接登録した MCP サーバー（Crucible 非依存）。stdio / remote 混在。
  const manualEndpoints: MCPServerInfo[] = getManualMcpServers(c)
    .filter((s) => passesFilter(s.name))
    .map((s) =>
      s.type === "stdio"
        ? { id: s.id, type: "stdio", name: s.name, command: s.command, args: s.args, env: s.env }
        : { id: s.id, type: "remote", name: s.name, url: s.url, transport: s.transport, apiKey: s.apiKey },
    );

  // (1) ∪ (2) を接続する。同名は手動登録を優先（ユーザーの明示指定を尊重）。
  const byName = new Map<string, MCPServerInfo>();
  for (const e of registryEndpoints) byName.set(e.name, e);
  for (const e of manualEndpoints) byName.set(e.name, e);
  // 接続は永続プールで使い回す（close はプールが管理するのでここでは閉じない）。
  const { tools } = await getMCPTools([...byName.values()]);

  try {
    const model = createModel(modelConfig);
    const result = await runAgentLoop({
      model,
      modelId: modelConfig.modelId,
      systemPrompt,
      messages,
      tools,
      maxSteps: body.options?.max_turns ?? 10,
      feature: "agent.chat",
      modelConfig,
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
  }
});

// セッションタイトル生成
app.post("/sessions/title", async (c) => {
  const body = await c.req.json<{ first_message: string; model?: string }>();
  if (!body.first_message) {
    return c.json({ error: "first_message は必須です" }, 400);
  }

  const modelConfig = resolveModelConfig(c, { modelName: body.model });
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
