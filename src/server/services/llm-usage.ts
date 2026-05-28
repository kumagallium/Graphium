// AI 使用量の計測・永続化ラッパ
//
// 全 LLM 呼び出しの token usage を 1 箇所で記録する。
// raw events は data/ai-usage-log.json に追記し、retention で
// 90 日より古いものは月次サマリに圧縮して ai-usage-summary.json に集約する。
//
// Vercel モード（serverMode === "vercel"）ではファイル書き込みを行わない。
// その場合は将来 fallback としてリクエスト header 経由で client storage に転送する想定。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getServerMode, type TokenRate, type RateCurrency } from "../config/models.js";

export type { TokenRate, RateCurrency };

/** 1 回の LLM 呼び出しの記録。 */
export type AIUsageEvent = {
  /** ISO 8601 タイムスタンプ */
  ts: string;
  /** 機能識別子（"wiki.ingest", "agent.chat", "prov.from-url" 等）。
   * UI 上のロボットアイコンと 1:1 で対応させる。 */
  feature: string;
  /** プロバイダー識別子（"anthropic", "openai", ...） */
  provider: string;
  /** プロバイダーのモデル ID（"claude-sonnet-4-20250514" 等） */
  modelId: string;
  /** 登録モデルの ID（モデル単価特定用）。匿名呼び出しでは undefined。 */
  modelConfigId?: string;
  inputTokens: number;
  outputTokens: number;
  /** Anthropic prompt caching 等での読み出しトークン */
  cacheReadTokens?: number;
  /** prompt caching の書き込み */
  cacheWriteTokens?: number;
  /** Extended thinking 等の reasoning token */
  reasoningTokens?: number;
  totalTokens: number;
  durationMs?: number;
  /** 記録時点のモデル単価（履歴を一貫させるため焼き込む） */
  rateSnapshot?: TokenRate;
  /** 単価から計算したコスト（rateSnapshot.currency 通貨）。rateSnapshot 未設定なら undefined。 */
  cost?: number;
  /** cost の通貨。"usd" | "jpy"。後方互換のため省略可（省略 = "usd"）。 */
  costCurrency?: RateCurrency;
  /** @deprecated 旧形式（v0.11 series）。新規ログには書かない。読み出し時に cost / costCurrency にマッピングする。 */
  costUsd?: number;
};

/** 月次サマリ（retention 後の集約形）。
 *  通貨が混在しうるので costByCurrency で保持し、合計値は表示通貨に換算して出す。 */
export type AIUsageMonthlySummary = {
  /** "2026-05" 形式 */
  month: string;
  feature: string;
  provider: string;
  modelId: string;
  callCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  /** 通貨別の合計コスト。例: { usd: 1.23, jpy: 184.5 } */
  costByCurrency: Partial<Record<RateCurrency, number>>;
  /** @deprecated 旧形式の合計コスト（USD）。後方互換のため読み出し時に costByCurrency.usd へマッピング。 */
  costUsd?: number;
};

const RAW_RETENTION_DAYS = 90;
const LOG_FILENAME = "ai-usage-log.json";
const SUMMARY_FILENAME = "ai-usage-summary.json";

let dataDir = join(process.cwd(), "data");
let inMemoryLog: AIUsageEvent[] | null = null;
let inMemorySummary: AIUsageMonthlySummary[] | null = null;

/** データディレクトリを設定する（テスト・Docker 用） */
export function setUsageDataDir(dir: string): void {
  dataDir = dir;
  inMemoryLog = null;
  inMemorySummary = null;
}

function logPath(): string {
  return join(dataDir, LOG_FILENAME);
}

function summaryPath(): string {
  return join(dataDir, SUMMARY_FILENAME);
}

function ensureDataDir(): void {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
}

function readLog(): AIUsageEvent[] {
  if (inMemoryLog) return inMemoryLog;
  try {
    const raw = readFileSync(logPath(), "utf-8");
    const parsed = JSON.parse(raw) as AIUsageEvent[];
    inMemoryLog = Array.isArray(parsed) ? parsed : [];
  } catch {
    inMemoryLog = [];
  }
  return inMemoryLog;
}

function writeLog(events: AIUsageEvent[]): void {
  ensureDataDir();
  writeFileSync(logPath(), JSON.stringify(events, null, 2), "utf-8");
  inMemoryLog = events;
}

function readSummary(): AIUsageMonthlySummary[] {
  if (inMemorySummary) return inMemorySummary;
  try {
    const raw = readFileSync(summaryPath(), "utf-8");
    const parsed = JSON.parse(raw) as AIUsageMonthlySummary[];
    inMemorySummary = Array.isArray(parsed) ? parsed : [];
  } catch {
    inMemorySummary = [];
  }
  return inMemorySummary;
}

function writeSummary(rows: AIUsageMonthlySummary[]): void {
  ensureDataDir();
  writeFileSync(summaryPath(), JSON.stringify(rows, null, 2), "utf-8");
  inMemorySummary = rows;
}

/** 1M token あたり単価とトークン数から、rate の通貨でコストを計算する */
function calcCost(event: Omit<AIUsageEvent, "cost" | "costCurrency" | "costUsd">): {
  cost: number;
  currency: RateCurrency;
} | undefined {
  const rate = event.rateSnapshot;
  if (!rate) return undefined;
  const perMTok = (count: number, perM: number) => (count / 1_000_000) * perM;
  // cacheRead/Write はトークン数を inputTokens に含めるプロバイダーもあるため、
  // ここでは「個別レート指定があれば差分単価で再計算」のシンプルな扱いにする。
  const cacheRead = event.cacheReadTokens ?? 0;
  const cacheWrite = event.cacheWriteTokens ?? 0;
  let inputBase = event.inputTokens - cacheRead - cacheWrite;
  if (inputBase < 0) inputBase = 0;

  let cost = perMTok(inputBase, rate.input) + perMTok(event.outputTokens, rate.output);
  if (rate.cacheRead !== undefined) cost += perMTok(cacheRead, rate.cacheRead);
  else cost += perMTok(cacheRead, rate.input);
  if (rate.cacheWrite !== undefined) cost += perMTok(cacheWrite, rate.cacheWrite);
  else cost += perMTok(cacheWrite, rate.input);

  return { cost, currency: rate.currency ?? "usd" };
}

/** 使用量イベントを 1 件記録する。失敗してもアプリは落とさない。 */
export function recordUsage(
  event: Omit<AIUsageEvent, "cost" | "costCurrency" | "costUsd">,
): void {
  if (getServerMode() === "vercel") {
    // Vercel モードはファイル書き込み不可。将来 client への転送を実装する。
    return;
  }
  try {
    const calc = calcCost(event);
    const enriched: AIUsageEvent = {
      ...event,
      cost: calc?.cost,
      costCurrency: calc?.currency,
    };
    const log = readLog();
    log.push(enriched);
    writeLog(log);
  } catch (e) {
    console.warn(
      `[llm-usage] failed to record event: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/** 旧形式 (costUsd のみ持つ) を新形式 (cost + costCurrency) に正規化する */
function normalizeEvent(ev: AIUsageEvent): AIUsageEvent {
  if (ev.cost !== undefined || ev.costUsd === undefined) return ev;
  return { ...ev, cost: ev.costUsd, costCurrency: "usd" };
}

function normalizeSummary(row: AIUsageMonthlySummary): AIUsageMonthlySummary {
  if (row.costByCurrency) return row;
  const cost = row.costUsd ?? 0;
  return { ...row, costByCurrency: cost > 0 ? { usd: cost } : {} };
}

/** raw イベント一覧。古い順。旧形式は読み出し時に新形式へ正規化する。 */
export function loadUsageLog(): AIUsageEvent[] {
  if (getServerMode() === "vercel") return [];
  return readLog().map(normalizeEvent);
}

/** 月次サマリ一覧。旧形式は読み出し時に新形式へ正規化する。 */
export function loadUsageSummary(): AIUsageMonthlySummary[] {
  if (getServerMode() === "vercel") return [];
  return readSummary().map(normalizeSummary);
}

function monthKey(iso: string): string {
  return iso.slice(0, 7); // "YYYY-MM"
}

function summaryRowKey(row: { month: string; feature: string; provider: string; modelId: string }): string {
  return `${row.month}|${row.feature}|${row.provider}|${row.modelId}`;
}

function addCost(
  bucket: Partial<Record<RateCurrency, number>>,
  amount: number | undefined,
  currency: RateCurrency | undefined,
): void {
  if (!amount) return;
  const c: RateCurrency = currency ?? "usd";
  bucket[c] = (bucket[c] ?? 0) + amount;
}

/** raw events を月次サマリに集約する */
function aggregate(events: AIUsageEvent[]): AIUsageMonthlySummary[] {
  const byKey = new Map<string, AIUsageMonthlySummary>();
  for (const rawEv of events) {
    const ev = normalizeEvent(rawEv);
    const key = summaryRowKey({
      month: monthKey(ev.ts),
      feature: ev.feature,
      provider: ev.provider,
      modelId: ev.modelId,
    });
    const row = byKey.get(key) ?? {
      month: monthKey(ev.ts),
      feature: ev.feature,
      provider: ev.provider,
      modelId: ev.modelId,
      callCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      costByCurrency: {},
    };
    row.callCount += 1;
    row.inputTokens += ev.inputTokens;
    row.outputTokens += ev.outputTokens;
    row.cacheReadTokens += ev.cacheReadTokens ?? 0;
    row.cacheWriteTokens += ev.cacheWriteTokens ?? 0;
    row.reasoningTokens += ev.reasoningTokens ?? 0;
    row.totalTokens += ev.totalTokens;
    addCost(row.costByCurrency, ev.cost, ev.costCurrency);
    byKey.set(key, row);
  }
  return Array.from(byKey.values());
}

function mergeSummaries(
  existing: AIUsageMonthlySummary[],
  newRows: AIUsageMonthlySummary[],
): AIUsageMonthlySummary[] {
  const byKey = new Map<string, AIUsageMonthlySummary>();
  for (const r of existing) byKey.set(summaryRowKey(r), normalizeSummary(r));
  for (const r of newRows) {
    const key = summaryRowKey(r);
    const cur = normalizeSummary(r);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...cur });
    } else {
      const mergedCost: Partial<Record<RateCurrency, number>> = { ...prev.costByCurrency };
      for (const [c, v] of Object.entries(cur.costByCurrency) as [RateCurrency, number][]) {
        mergedCost[c] = (mergedCost[c] ?? 0) + v;
      }
      byKey.set(key, {
        ...prev,
        callCount: prev.callCount + cur.callCount,
        inputTokens: prev.inputTokens + cur.inputTokens,
        outputTokens: prev.outputTokens + cur.outputTokens,
        cacheReadTokens: prev.cacheReadTokens + cur.cacheReadTokens,
        cacheWriteTokens: prev.cacheWriteTokens + cur.cacheWriteTokens,
        reasoningTokens: prev.reasoningTokens + cur.reasoningTokens,
        totalTokens: prev.totalTokens + cur.totalTokens,
        costByCurrency: mergedCost,
      });
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * 90 日以上前の raw event を月次サマリに集約してから raw から削除する。
 * サーバー起動時に呼ぶ想定。 */
export function retentionSweep(now: Date = new Date()): void {
  if (getServerMode() === "vercel") return;
  try {
    const cutoff = new Date(now.getTime() - RAW_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const log = readLog();
    if (log.length === 0) return;
    const stale: AIUsageEvent[] = [];
    const fresh: AIUsageEvent[] = [];
    for (const ev of log) {
      if (new Date(ev.ts).getTime() < cutoff.getTime()) stale.push(ev);
      else fresh.push(ev);
    }
    if (stale.length === 0) return;
    const newSummary = aggregate(stale);
    const merged = mergeSummaries(readSummary(), newSummary);
    writeSummary(merged);
    writeLog(fresh);
  } catch (e) {
    console.warn(
      `[llm-usage] retention sweep failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/**
 * Vercel AI SDK の LanguageModelUsage / EmbeddingModelUsage から
 * AIUsageEvent の token フィールドを抽出する。
 */
export function extractTokenFields(usage: unknown): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  totalTokens: number;
} {
  const u = (usage ?? {}) as {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    inputTokenDetails?: {
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
    };
    outputTokenDetails?: {
      reasoningTokens?: number;
    };
    // embedding 用
    tokens?: number;
  };
  const inputTokens = u.inputTokens ?? u.tokens ?? 0;
  const outputTokens = u.outputTokens ?? 0;
  const cacheReadTokens = u.inputTokenDetails?.cacheReadTokens;
  const cacheWriteTokens = u.inputTokenDetails?.cacheWriteTokens;
  const reasoningTokens = u.outputTokenDetails?.reasoningTokens;
  const totalTokens = u.totalTokens ?? inputTokens + outputTokens;
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    totalTokens,
  };
}
