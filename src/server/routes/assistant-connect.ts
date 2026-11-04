// 外の AI アシスタントへの登録 API（設定 > AI「外の AI からノートを使う」）
// GET  /api/assistant-connect          — 同梱の有無・クライアントごとの登録状態・貼り付け用の文字列
// POST /api/assistant-connect/register — { client } を登録する。登録後の行の状態を返す

import { Hono, type MiddlewareHandler } from "hono";
import {
  ASSISTANT_CLIENTS,
  AssistantConnectError,
  getAssistantConnectStatus,
  registerAssistant,
  type AssistantClientId,
} from "../services/assistant-connect.js";

const app = new Hono();

// 状態を変える POST は application/json だけ受ける。他サイトのフォーム等（simple request）から
// 手元の AI アシスタントの設定ファイルを書き換えられないようにする（JSON は CORS のプリフライトを要する）
const requireJson: MiddlewareHandler = async (c, next) => {
  const type = c.req.header("content-type") ?? "";
  if (!/^application\/json\b/i.test(type)) {
    return c.json({ error: "Content-Type must be application/json", code: "UNSUPPORTED_MEDIA_TYPE" }, 415);
  }
  await next();
};

app.get("/", async (c) => c.json(await getAssistantConnectStatus()));

app.use("/register", requireJson);
app.post("/register", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { client?: unknown };
  const client = body.client;
  if (typeof client !== "string" || !(ASSISTANT_CLIENTS as readonly string[]).includes(client)) {
    return c.json({ error: "unknown client", code: "BAD_CLIENT" }, 400);
  }
  try {
    const status = await registerAssistant(client as AssistantClientId);
    return c.json({ status });
  } catch (err) {
    if (err instanceof AssistantConnectError) {
      return c.json({ error: err.message, code: err.code }, err.code === "NOT_AVAILABLE" ? 409 : 500);
    }
    return c.json({ error: err instanceof Error ? err.message : String(err), code: "UNKNOWN" }, 500);
  }
});

export default app;
