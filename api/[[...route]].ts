// Vercel Serverless Functions エントリポイント
// Hono アプリを Vercel の Node.js runtime で実行する

import { handle } from "hono/vercel";
import { createApp } from "../src/server/app.js";

const app = createApp({ mode: "vercel" });

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
export const OPTIONS = handle(app);
