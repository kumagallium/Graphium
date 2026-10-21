// 会議 API ルート
// POST /api/meeting/summarize — 文字起こし（発言の列）から決定事項 / TODO / 論点を要約し、
//                               各項目に根拠の発言 id を付けて返す。
// POST /api/meeting/cleanup   — 文字起こしを読みやすい段落に清書し、各段落に元の発言 id を付けて返す。

import { Hono } from "hono";
import { createModel } from "../services/llm.js";
import { resolveModelConfig } from "../services/header-model.js";
import { runAgentLoop } from "../services/agent-loop.js";
import {
  buildMeetingSummarySystemPrompt,
  buildMeetingSummaryUserMessage,
  parseMeetingSummaryOutput,
  isMeetingInputTooLarge,
  type MeetingUtterance,
} from "../services/meeting-summary.js";
import {
  buildMeetingCleanupSystemPrompt,
  parseMeetingCleanupOutput,
  parseMeetingCleanupFixes,
  isMeetingCleanupInputTooLarge,
  sanitizeVocabulary,
} from "../services/meeting-cleanup.js";
import { maskText, parseMaskTerms } from "../../lib/meeting-mask.js";
import { noModelRegisteredBody, errorBody } from "../../lib/ai-error-codes.js";

const app = new Hono();

function isUtterance(u: unknown): u is MeetingUtterance {
  if (!u || typeof u !== "object") return false;
  const r = u as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    r.id.length > 0 &&
    (r.track === "system" || r.track === "mic" || r.track === null) &&
    typeof r.startMs === "number" &&
    typeof r.text === "string"
  );
}

app.post("/summarize", async (c) => {
  const body = await c.req
    .json<{ model?: string; language?: string; utterances?: unknown; notes?: unknown; mask?: unknown; maskTerms?: unknown }>()
    .catch(() => null);
  if (!body) return c.json({ error: "Invalid JSON body." }, 400);

  if (body.language !== "ja" && body.language !== "en") {
    return c.json({ error: "language must be 'ja' or 'en'." }, 400);
  }
  const language = body.language;
  // 名前などを伏せる（音声ノートのブロックのチェック）と、利用者の「必ず伏せる語」
  const mask = body.mask === true;
  const maskTerms = mask ? parseMaskTerms(body.maskTerms) : [];
  if (!Array.isArray(body.utterances) || !body.utterances.every(isUtterance)) {
    return c.json({ error: "utterances is invalid." }, 400);
  }
  const utterances = (body.utterances as MeetingUtterance[]).filter((u) => u.text.trim().length > 0);
  if (utterances.length === 0) {
    return c.json({ error: "No utterances to summarize." }, 400);
  }
  if (isMeetingInputTooLarge(utterances, language)) {
    return c.json(
      { error: "The transcript is too large to summarize at once.", code: "INPUT_TOO_LARGE" },
      413,
    );
  }

  const modelConfig = resolveModelConfig(c, { modelName: body.model });
  if (!modelConfig) {
    return c.json(noModelRegisteredBody(), 400);
  }

  try {
    const model = await createModel(modelConfig);
    const result = await runAgentLoop({
      model,
      modelId: modelConfig.modelId,
      systemPrompt: buildMeetingSummarySystemPrompt(language, body.notes, mask),
      messages: [{ role: "user" as const, content: buildMeetingSummaryUserMessage(utterances, language) }],
      maxSteps: 1,
      feature: "meeting.summarize",
      modelConfig,
      abortSignal: c.req.raw.signal,
      temperature: 0,
    });

    const parsed = parseMeetingSummaryOutput(result.message ?? "", utterances.map((u) => u.id));
    if (!parsed) {
      return c.json({ error: "The AI's reply could not be read." }, 502);
    }
    // 伏せるときは、AI の見逃しに備えて返ってきた文を機械でも伏せる
    const m = (s: string) => maskText(s, maskTerms, language);
    const summary = mask
      ? {
          decisions: parsed.decisions.map((x) => ({ ...x, text: m(x.text) })),
          todos: parsed.todos.map((x) => ({
            ...x,
            text: m(x.text),
            ...(x.owner ? { owner: m(x.owner) } : {}),
            ...(x.due ? { due: m(x.due) } : {}),
          })),
          issues: parsed.issues.map((x) => ({ ...x, text: m(x.text) })),
        }
      : parsed;
    return c.json({ ...summary, masked: mask, model: result.model, tokenUsage: result.tokenUsage });
  } catch (err) {
    console.error("meeting summarize error:", err);
    return c.json(errorBody(err), 500);
  }
});

app.post("/cleanup", async (c) => {
  const body = await c.req
    .json<{
      model?: string;
      language?: string;
      utterances?: unknown;
      vocabulary?: unknown;
      notes?: unknown;
      mask?: unknown;
      maskTerms?: unknown;
    }>()
    .catch(() => null);
  if (!body) return c.json({ error: "Invalid JSON body." }, 400);

  if (body.language !== "ja" && body.language !== "en") {
    return c.json({ error: "language must be 'ja' or 'en'." }, 400);
  }
  const language = body.language;
  // 名前などを伏せる（音声ノートのブロックのチェック）と、利用者の「必ず伏せる語」
  const mask = body.mask === true;
  const maskTerms = mask ? parseMaskTerms(body.maskTerms) : [];
  if (!Array.isArray(body.utterances) || !body.utterances.every(isUtterance)) {
    return c.json({ error: "utterances is invalid." }, 400);
  }
  const utterances = (body.utterances as MeetingUtterance[]).filter((u) => u.text.trim().length > 0);
  if (utterances.length === 0) {
    return c.json({ error: "No utterances to clean up." }, 400);
  }
  if (isMeetingCleanupInputTooLarge(utterances, language)) {
    return c.json(
      { error: "The transcript is too large to clean up at once.", code: "INPUT_TOO_LARGE" },
      413,
    );
  }

  const modelConfig = resolveModelConfig(c, { modelName: body.model });
  if (!modelConfig) {
    return c.json(noModelRegisteredBody(), 400);
  }

  try {
    const model = await createModel(modelConfig);
    const result = await runAgentLoop({
      model,
      modelId: modelConfig.modelId,
      systemPrompt: buildMeetingCleanupSystemPrompt(
        language,
        sanitizeVocabulary(body.vocabulary),
        typeof body.notes === "string" ? body.notes : undefined,
        mask,
      ),
      messages: [{ role: "user" as const, content: buildMeetingSummaryUserMessage(utterances, language) }],
      maxSteps: 1,
      feature: "meeting.cleanup",
      modelConfig,
      abortSignal: c.req.raw.signal,
      temperature: 0,
    });

    const paragraphs = parseMeetingCleanupOutput(result.message ?? "", utterances.map((u) => u.id));
    if (!paragraphs) {
      return c.json({ error: "The AI's reply could not be read." }, 502);
    }
    const fixes = parseMeetingCleanupFixes(result.message ?? "");
    return c.json({
      paragraphs: mask ? paragraphs.map((p) => ({ ...p, text: maskText(p.text, maskTerms, language) })) : paragraphs,
      // 伏せるときは直した語を返さない（「たなか → 田中」のように生の名前が入りうる）
      fixes: mask ? [] : fixes,
      masked: mask,
      model: result.model,
      tokenUsage: result.tokenUsage,
    });
  } catch (err) {
    console.error("meeting cleanup error:", err);
    return c.json(errorBody(err), 500);
  }
});

export default app;
