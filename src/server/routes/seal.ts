// 版の封印: 時刻証明の局への送信ルート
// POST /api/seal/rfc3161 — { hash: SHA-256 hex, tsa?: 登録簿の ID } を受け取り、
//                          局へ RFC 3161 の要求を送って、応答（DER の base64）を返す。
//
// 公開の局はブラウザからの CORS を許していない（FreeTSA は preflight に 403）ので、
// sidecar から送る。守りは次のとおり（設計メモ §3.8）:
// - 受け取るのはハッシュだけ。送り先は登録簿（tsa-registry.ts）から選び、URL は受け取らない
// - HTTPS のみ・リダイレクトに従わない・タイムアウト・応答の大きさの上限
// - 応答は「送った要求への答えか」（状態・ハッシュ・nonce）を確かめてから返す。
//   署名の検証は画面側で封印ファイルの全文と同梱のルート証明書を使って行う
// - 局ごとに 15 秒の間隔を空ける（Sectigo が連続して送るときに求めている間隔に揃えた自主制限）

import { Hono } from "hono";
import {
  buildTimeStampRequest,
  bytesToBase64,
  checkResponseMatchesRequest,
  MAX_TSR_BYTES,
} from "../../features/version-seal/rfc3161.js";
import { DEFAULT_TSA_ID, findTsa } from "../../features/version-seal/tsa-registry.js";

const app = new Hono();

const TIMEOUT_MS = 20_000;
export const MIN_INTERVAL_MS = 15_000;

/** 局ごとの最後の送信時刻（間隔を空けるため） */
const lastSentAt = new Map<string, number>();
/** 局ごとに送信を 1 本の列に並べる */
const queues = new Map<string, Promise<unknown>>();

type Deps = {
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

const defaultDeps: Deps = {
  fetch: (...args) => fetch(...args),
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};
let deps: Deps = defaultDeps;

/** テスト用: 依存を差し替える（undefined で元に戻す） */
export function __setSealDepsForTest(d: Partial<Deps> | undefined): void {
  deps = d ? { ...defaultDeps, ...d } : defaultDeps;
  lastSentAt.clear();
  queues.clear();
}

async function readLimited(res: Response, limit: number): Promise<Uint8Array> {
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > limit) throw new Error("応答が大きすぎます");
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error("応答が大きすぎます");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

async function sendOnce(url: string, der: Uint8Array): Promise<Uint8Array> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await deps.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/timestamp-query" },
      body: der as BodyInit,
      redirect: "error",
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`局が HTTP ${res.status} を返しました`);
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.toLowerCase().startsWith("application/timestamp-reply")) {
      throw new Error("局の応答の種類が違います");
    }
    return await readLimited(res, MAX_TSR_BYTES);
  } finally {
    clearTimeout(timer);
  }
}

function enqueue<T>(tsaId: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(tsaId) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(async () => {
    const wait = (lastSentAt.get(tsaId) ?? -Infinity) + MIN_INTERVAL_MS - deps.now();
    if (wait > 0) await deps.sleep(wait);
    lastSentAt.set(tsaId, deps.now());
    return fn();
  });
  queues.set(tsaId, run.catch(() => undefined));
  return run;
}

app.post("/rfc3161", async (c) => {
  let body: { hash?: unknown; tsa?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_body" }, 400);
  }
  const hash = typeof body.hash === "string" ? body.hash : "";
  if (!/^[0-9a-f]{64}$/.test(hash)) return c.json({ error: "invalid_hash" }, 400);
  const tsa = findTsa(typeof body.tsa === "string" ? body.tsa : DEFAULT_TSA_ID);
  if (!tsa) return c.json({ error: "unknown_tsa" }, 400);
  if (!tsa.url.startsWith("https://")) return c.json({ error: "insecure_tsa" }, 500);

  try {
    const result = await enqueue(tsa.id, async () => {
      const { der, nonceHex } = buildTimeStampRequest(hash);
      const tsr = await sendOnce(tsa.url, der);
      const info = checkResponseMatchesRequest(tsr, { sha256Hex: hash, nonceHex });
      return { tsr, genTime: info.genTime };
    });
    return c.json({
      tsa: tsa.id,
      endpoint: tsa.url,
      tsr: bytesToBase64(result.tsr),
      genTime: result.genTime.toISOString(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // 局に届かない・拒否・不正な応答はまとめて 502（画面は「あとで付ける」に回す）
    return c.json({ error: "tsa_failed", message }, 502);
  }
});

export default app;
