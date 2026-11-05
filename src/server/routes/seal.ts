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
import {
  BLOCK_EXPLORERS,
  DEFAULT_TSA_ID,
  findTsa,
  isKnownCalendar,
  OTS_CALENDARS,
} from "../../features/version-seal/tsa-registry.js";
import { bytesToHex, hexToBytes } from "../../features/version-seal/rfc3161.js";

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

/** OpenTimestamps のカレンダー応答の上限（ふつうは数百バイト） */
const MAX_OTS_RESPONSE_BYTES = 16 * 1024;
/** カレンダー・ブロックの取得先への間隔（局よりは緩くてよい） */
const OTS_MIN_INTERVAL_MS = 1_000;

/** 登録簿の URL へ GET / POST して、上限付きで読む（リダイレクトに従わない） */
async function fetchLimited(
  url: string,
  init: { method: "GET" | "POST"; body?: Uint8Array; accept?: string },
  limit: number,
): Promise<{ status: number; bytes: Uint8Array }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await deps.fetch(url, {
      method: init.method,
      headers: {
        ...(init.body ? { "Content-Type": "application/octet-stream" } : {}),
        ...(init.accept ? { Accept: init.accept } : {}),
      },
      ...(init.body ? { body: init.body as BodyInit } : {}),
      redirect: "error",
      signal: ac.signal,
    });
    if (!res.ok) return { status: res.status, bytes: new Uint8Array() };
    return { status: res.status, bytes: await readLimited(res, limit) };
  } finally {
    clearTimeout(timer);
  }
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

function enqueue<T>(tsaId: string, fn: () => Promise<T>, interval = MIN_INTERVAL_MS): Promise<T> {
  const prev = queues.get(tsaId) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(async () => {
    const wait = (lastSentAt.get(tsaId) ?? -Infinity) + interval - deps.now();
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

// ── OpenTimestamps ──

// POST /api/seal/ots/submit — { hash } を登録簿のカレンダーすべてに出し、届いた応答を返す
app.post("/ots/submit", async (c) => {
  let body: { hash?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_body" }, 400);
  }
  const hash = typeof body.hash === "string" ? body.hash : "";
  if (!/^[0-9a-f]{64}$/.test(hash)) return c.json({ error: "invalid_hash" }, 400);
  const digest = hexToBytes(hash);
  const results = await Promise.all(
    OTS_CALENDARS.map((cal) =>
      enqueue(
        cal,
        async () => {
          try {
            const r = await fetchLimited(
              `${cal}/digest`,
              { method: "POST", body: digest, accept: "application/vnd.opentimestamps.v1" },
              MAX_OTS_RESPONSE_BYTES,
            );
            return r.status === 200 && r.bytes.byteLength > 0
              ? { calendar: cal, body: bytesToBase64(r.bytes) }
              : null;
          } catch {
            return null;
          }
        },
        OTS_MIN_INTERVAL_MS,
      ),
    ),
  );
  const responses = results.filter((r): r is { calendar: string; body: string } => r !== null);
  if (responses.length === 0) return c.json({ error: "calendars_unreachable" }, 502);
  return c.json({ responses });
});

// POST /api/seal/ots/upgrade — { calendar, commitment } の確定を取りに行く。
// calendar は .ots に書かれた URI だが、登録簿にあるものだけを受け付ける
app.post("/ots/upgrade", async (c) => {
  let body: { calendar?: unknown; commitment?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_body" }, 400);
  }
  const calendar = typeof body.calendar === "string" ? body.calendar.replace(/\/+$/, "") : "";
  const commitment = typeof body.commitment === "string" ? body.commitment.toLowerCase() : "";
  if (!isKnownCalendar(calendar)) return c.json({ error: "unknown_calendar" }, 400);
  if (!/^[0-9a-f]{2,256}$/.test(commitment) || commitment.length % 2 !== 0) {
    return c.json({ error: "invalid_commitment" }, 400);
  }
  try {
    const r = await enqueue(
      calendar,
      () =>
        fetchLimited(
          `${calendar}/timestamp/${commitment}`,
          { method: "GET", accept: "application/vnd.opentimestamps.v1" },
          MAX_OTS_RESPONSE_BYTES,
        ),
      OTS_MIN_INTERVAL_MS,
    );
    // 404 はまだ確定していない（カレンダーが Bitcoin に載せる前）
    if (r.status === 404) return c.json({ status: "pending" });
    if (r.status !== 200 || r.bytes.byteLength === 0) {
      return c.json({ error: "calendar_failed", message: `HTTP ${r.status}` }, 502);
    }
    return c.json({ status: "upgraded", body: bytesToBase64(r.bytes) });
  } catch (e) {
    return c.json({ error: "calendar_failed", message: e instanceof Error ? e.message : String(e) }, 502);
  }
});

/** ヘッダ 80 バイトの二重 SHA-256 を、表示の並び（逆順）の hex にする = ブロックハッシュ */
async function blockHashOfHeader(header: Uint8Array): Promise<string> {
  const once = new Uint8Array(await crypto.subtle.digest("SHA-256", header as BufferSource));
  const twice = new Uint8Array(await crypto.subtle.digest("SHA-256", once as BufferSource));
  return bytesToHex(twice.reverse());
}

// GET /api/seal/btc-header/:height — Bitcoin のブロックヘッダ（80 バイトの hex）
app.get("/btc-header/:height", async (c) => {
  const height = Number(c.req.param("height"));
  if (!Number.isInteger(height) || height < 0 || height > 10_000_000) {
    return c.json({ error: "invalid_height" }, 400);
  }
  const errors: string[] = [];
  for (const base of BLOCK_EXPLORERS) {
    try {
      const h = await enqueue(
        base,
        () => fetchLimited(`${base}/block-height/${height}`, { method: "GET" }, 128),
        OTS_MIN_INTERVAL_MS,
      );
      const hash = new TextDecoder().decode(h.bytes).trim().toLowerCase();
      if (h.status !== 200 || !/^[0-9a-f]{64}$/.test(hash)) throw new Error(`block-height HTTP ${h.status}`);
      const hd = await enqueue(
        base,
        () => fetchLimited(`${base}/block/${hash}/header`, { method: "GET" }, 256),
        OTS_MIN_INTERVAL_MS,
      );
      const headerHex = new TextDecoder().decode(hd.bytes).trim().toLowerCase();
      if (hd.status !== 200 || !/^[0-9a-f]{160}$/.test(headerHex)) throw new Error(`header HTTP ${hd.status}`);
      // 取得先がヘッダとハッシュを取り違えていないかを確かめる
      if ((await blockHashOfHeader(hexToBytes(headerHex))) !== hash) throw new Error("ヘッダとブロックハッシュが合いません");
      return c.json({ height, hash, header: headerHex, source: base });
    } catch (e) {
      errors.push(`${base}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return c.json({ error: "explorers_failed", message: errors.join("; ") }, 502);
});

export default app;
