// エージェント実行 API
// POST /api/agent/run — メッセージを送信して AI 回答を取得

import { Hono } from "hono";
import type { ModelMessage } from "ai";
import { getProfile, listProfiles } from "../config/profiles.js";
import { createModel } from "../services/llm.js";
import { runAgentLoop } from "../services/agent-loop.js";
import { resolveModelConfig } from "../services/header-model.js";
import { fetchRegistryServers, filterSkills, buildSkillPromptSection, buildMCPUrl, detectTransport } from "../services/registry.js";
import { getMCPTools, type MCPServerInfo } from "../services/mcp.js";
import { extractWebSources } from "../services/web-sources.js";
import { getRegistryUrl, getRegistryKey, getManualMcpServers } from "../services/env.js";
import { buildLabeledOutputInstruction } from "../../features/ai-assistant/label-markers.js";
import { forcesWebSearch, type GroundingScope } from "../../lib/grounding-scope.js";
import { noModelRegisteredBody, errorBody } from "../../lib/ai-error-codes.js";

const app = new Hono();

/**
 * ノート本文の取得先に関するガードレール。
 *
 * Graphium のノート本文は、ホスト（フロントエンド）が会話メッセージ内に直接
 * 埋め込んで渡す（`---` 区切りで同梱）。一方でチャットには接続済みの MCP ツール
 * （Notion / Drive 等）が丸ごと供給され、かつ「現在のノートを読む」専用ツールは
 * 存在しない。そのため LLM が「ノートを取得しろ」と言われると、最も近い外部検索
 * ツール（例: Notion 検索）に取り違えて飛びつき、本来不要な認可フローを始める。
 * それを止めるための明示指示。常時 system prompt に付与する。
 */
export const NOTE_CONTEXT_GUARDRAIL = [
  "The user's notes live inside Graphium itself.",
  "When the user refers to \"this note\", \"my note\", \"the document\", or \"the note I just edited\",",
  "its content is provided to you directly in this conversation (delimited by `---` markers in the user's message).",
  "It is NOT stored in Notion, Google Drive, or any other external service.",
  "Never call external MCP tools (such as Notion or Drive search/fetch) to look up the user's own note — you already have it inline.",
  "If you cannot find the note content in the conversation, ask the user to resend or attach it; do not search external services for it.",
].join("\n");

// 外部参照（external grounding scope）のときに注入する Web 検索の強制指示。
// ユーザーがチップで明示的に選んだ場合のみ入る（既定の internal / notes では入らない）。
export const EXTERNAL_GROUNDING_INSTRUCTION = [
  "## External grounding mode",
  "The user has explicitly chosen EXTERNAL grounding for this question.",
  "- You MUST search the web (using WebSearch or a connected search tool) before answering, and ground your answer in what the search returns.",
  "- Prefer fresh external sources over your own memory for facts, and cite the sources you used.",
  "- Only cite URLs that actually appeared in search or fetch results. NEVER produce a URL, DOI, or citation from memory.",
  "- Cite web sources as inline markdown links or in a final \"Sources:\" list of markdown links. Do NOT cite web sources with bare numeric footnotes like [1] or with [Source: \"...\"] markers — those formats are reserved for the user's internal knowledge context.",
  "- If no web search tool is available in this environment, say so explicitly, then answer from the provided context while clearly noting it was not externally verified.",
].join("\n");

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
    /** grounding スコープ。"external"（外部参照）のとき Web 検索の強制指示を注入する */
    grounding_scope?: GroundingScope;
    /** 構造化出力（コンテキストラベル）の指示に使う言語 */
    language?: string;
    options?: {
      max_turns?: number;
      model?: string;
    };
  }>();

  if (!body.message && (!body.messages || body.messages.length === 0)) {
    return c.json({ error: "message is required" }, 400);
  }

  // モデル解決: ヘッダー → options.model → デフォルト
  const modelConfig = resolveModelConfig(c, { modelName: body.options?.model });

  if (!modelConfig) {
    return c.json(noModelRegisteredBody(), 400);
  }

  // プロファイル解決（明示指定がなければ汎用アシスタントを既定とする）
  const profileName = body.profile || "general";
  const profile = getProfile(profileName) ?? listProfiles()[0];
  let systemPrompt = profile?.content ?? "You are a helpful assistant.";
  // ノート本文は会話内に同梱される。外部 MCP ツールでの誤検索を防ぐガードレール。
  systemPrompt += `\n\n${NOTE_CONTEXT_GUARDRAIL}`;
  if (body.custom_instructions) {
    systemPrompt += `\n\n${body.custom_instructions}`;
  }

  // メッセージ構築
  // フロントエンドから messages 配列が渡された場合はそれを使う
  // 後方互換: message のみの場合は単一ユーザーメッセージとして扱う
  const messages: ModelMessage[] = body.messages ?? [
    { role: "user" as const, content: body.message },
  ];

  // MCP 供給源を集める: 手動登録（stdio / remote）+ 環境変数の Registry 既定（Docker のゼロ設定）。
  // ユーザーがレジストリから選んだサーバーは具体 URL の remote として manualServers に含まれる。
  // env の CRUCIBLE_API_URL（X-Registry-URL ヘッダー or 環境変数）だけは従来どおり自動展開する。
  const manualServers = getManualMcpServers(c);
  const envRegistryUrl = getRegistryUrl(c).replace(/\/$/, "");
  const envRegistryServers = envRegistryUrl
    ? await fetchRegistryServers(envRegistryUrl, getRegistryKey())
    : [];
  const allRegistryServers = envRegistryServers.map((s) => ({ s, registryUrl: envRegistryUrl }));

  // Wiki コンテキストを注入（Retriever 結果）
  if (body.wiki_context) {
    systemPrompt += `\n\n${body.wiki_context}`;
  }

  // 外部参照（external grounding）: ユーザーが明示的に「世界の known を取り込む」を選んだ。
  // Web 検索を必ず実行して外部ソースで裏づけるよう強制する。検索経路は既存の 2 本
  // （claude-subscription 内蔵 WebSearch = A / 検索 MCP = B）で、ここでは指示のみ足す。
  // 記憶由来 URL の禁止は world-grounding と同じ原則（モデルは DOI/URL を捏造する）。
  if (body.grounding_scope && forcesWebSearch(body.grounding_scope)) {
    systemPrompt += `\n\n${EXTERNAL_GROUNDING_INSTRUCTION}`;
  }

  // 構造化出力（コンテキストラベル）指示
  // OpenAI 互換系（gpt-oss-120b 等）はネイティブ tool calling 非対応で system prompt に
  // tool 定義を埋め込む fallback ループを使うため、長大な PROV ラベル指示と競合してツール
  // 呼び出しが弱まる。Ask モードでは PROV ラベルを生成する必然性も薄いので抑制する。
  const skipLabeledOutput =
    modelConfig.provider === "openai-compatible" ||
    modelConfig.provider === "claude-subscription";
  if (!skipLabeledOutput) {
    systemPrompt += buildLabeledOutputInstruction(body.language || "en");
  }

  // Skill をシステムプロンプトに注入（全レジストリ横断）
  const skills = filterSkills(allRegistryServers.map((x) => x.s));
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

  // (1) Crucible Registry 由来のサーバー（各レジストリを展開）。すべて remote 接続。
  const registryEndpoints: MCPServerInfo[] = allRegistryServers
    .filter(({ s }) => s.tool_type === "mcp_server" && s.status === "running")
    .filter(({ s }) => passesFilter(s.name))
    .map(({ s, registryUrl }) => ({
      id: `registry:${registryUrl}:${s.name}`,
      type: "remote",
      name: s.name,
      url: buildMCPUrl(s, registryUrl),
      transport: detectTransport(s),
    }));

  // (2) ユーザーが直接登録した MCP サーバー（stdio / remote）。
  const manualEndpoints: MCPServerInfo[] = manualServers
    .filter((s) => passesFilter(s.name))
    .map((s): MCPServerInfo =>
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
    // チャットだけは claude-subscription で内蔵 WebSearch / WebFetch を解禁する
    // （翻訳・Wiki 等の非チャット経路には波及させない。詳細は createModel の allowWebSearch）。
    const model = await createModel(modelConfig, { allowWebSearch: true });
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

    // 検索 MCP（Tavily 等）のツール結果から web 出典を決定論的に抽出する。
    // A 経路（内蔵 WebSearch）はツール呼び出しが見えないため空になり、その場合は
    // モデル出力の "Sources:" 見出しを note-app 側でラベル置換する（既存の別経路）。
    const webSources = extractWebSources(result.toolCalls);
    // 診断ログ: どのツールが使われたか / web 出典を何件拾えたか（どの検索経路かの切り分け用）。
    console.log(
      "[agent.chat] " +
        JSON.stringify({
          provider: modelConfig.provider,
          toolsUsed: result.toolCalls.map((t) => t.tool_name),
          webSourceCount: webSources.length,
        }),
    );

    return c.json({
      session_id: body.session_id ?? crypto.randomUUID(),
      message: result.message,
      tool_calls: result.toolCalls,
      web_sources: webSources,
      provenance_id: null,
      token_usage: result.tokenUsage,
      model: result.model,
    });
  } catch (err) {
    console.error("Agent run error:", err);
    // runAgentLoop 由来の CodedError（認証エラー等）は code を JSON に通す
    return c.json(errorBody(err), 500);
  }
});

// セッションタイトル生成
app.post("/sessions/title", async (c) => {
  const body = await c.req.json<{ first_message: string; model?: string }>();
  if (!body.first_message) {
    return c.json({ error: "first_message is required" }, 400);
  }

  const modelConfig = resolveModelConfig(c, { modelName: body.model });
  if (!modelConfig) {
    // フォールバック: 先頭25文字
    const title = body.first_message.slice(0, 25) +
      (body.first_message.length > 25 ? "…" : "");
    return c.json({ title });
  }

  try {
    const model = await createModel(modelConfig);
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
