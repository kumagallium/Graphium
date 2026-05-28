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
import { getServerMode, type TokenRate } from "../config/models.js";

export type { TokenRate };

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
  /** 単価から計算したコスト（USD）。rateSnapshot 未設定なら undefined。 */
  costUsd?: number;
};

/** 月次サマリ（retention 後の集約形）。 */
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
  costUsd: number;
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

/** 1 token あたりの単価（USD）に直してコストを計算する */
function calcCost(event: Omit<AIUsageEvent, "costUsd">): number | undefined {
  const rate = event.rateSnapshot;
  if (!rate) return undefined;
  const perMTok = (count: number, perM: number) => (count / 1_000_000) * perM;
  // cacheRead/Write はトークン数を inputTokens に含めるプロバイダーもあるため、
  // ここでは「個別レート指定があれば差分単価で再計算」のシンプルな扱いにする。
  // 標準: input + output レートのみ。cacheRead/Write レートがあれば cacheReadTokens を
  // input から差し引いて別レート適用。
  const cacheRead = event.cacheReadTokens ?? 0;
  const cacheWrite = event.cacheWriteTokens ?? 0;
  let inputBase = event.inputTokens - cacheRead - cacheWrite;
  if (inputBase < 0) inputBase = 0;

  let cost = perMTok(inputBase, rate.input) + perMTok(event.outputTokens, rate.output);
  if (rate.cacheRead !== undefined) cost += perMTok(cacheRead, rate.cacheRead);
  else cost += perMTok(cacheRead, rate.input);
  if (rate.cacheWrite !== undefined) cost += perMTok(cacheWrite, rate.cacheWrite);
  else cost += perMTok(cacheWrite, rate.input);

  return cost;
}

/** 使用量イベントを 1 件記録する。失敗してもアプリは落とさない。 */
export function recordUsage(event: Omit<AIUsageEvent, "costUsd">): void {
  if (getServerMode() === "vercel") {
    // Vercel モードはファイル書き込み不可。将来 client への転送を実装する。
    return;
  }
  try {
    const costUsd = calcCost(event);
    const enriched: AIUsageEvent = { ...event, costUsd };
    const log = readLog();
    log.push(enriched);
    writeLog(log);
  } catch (e) {
    console.warn(
      `[llm-usage] failed to record event: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/** raw イベント一覧。古い順。 */
export function loadUsageLog(): AIUsageEvent[] {
  if (getServerMode() === "vercel") return [];
  return [...readLog()];
}

/** 月次サマリ一覧。 */
export function loadUsageSummary(): AIUsageMonthlySummary[] {
  if (getServerMode() === "vercel") return [];
  return [...readSummary()];
}

function monthKey(iso: string): string {
  return iso.slice(0, 7); // "YYYY-MM"
}

function summaryRowKey(row: { month: string; feature: string; provider: string; modelId: string }): string {
  return `${row.month}|${row.feature}|${row.provider}|${row.modelId}`;
}

/** raw events を月次サマリに集約する */
function aggregate(events: AIUsageEvent[]): AIUsageMonthlySummary[] {
  const byKey = new Map<string, AIUsageMonthlySummary>();
  for (const ev of events) {
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
      costUsd: 0,
    };
    row.callCount += 1;
    row.inputTokens += ev.inputTokens;
    row.outputTokens += ev.outputTokens;
    row.cacheReadTokens += ev.cacheReadTokens ?? 0;
    row.cacheWriteTokens += ev.cacheWriteTokens ?? 0;
    row.reasoningTokens += ev.reasoningTokens ?? 0;
    row.totalTokens += ev.totalTokens;
    row.costUsd += ev.costUsd ?? 0;
    byKey.set(key, row);
  }
  return Array.from(byKey.values());
}

function mergeSummaries(
  existing: AIUsageMonthlySummary[],
  newRows: AIUsageMonthlySummary[],
): AIUsageMonthlySummary[] {
  const byKey = new Map<string, AIUsageMonthlySummary>();
  for (const r of existing) byKey.set(summaryRowKey(r), r);
  for (const r of newRows) {
    const key = summaryRowKey(r);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...r });
    } else {
      byKey.set(key, {
        ...prev,
        callCount: prev.callCount + r.callCount,
        inputTokens: prev.inputTokens + r.inputTokens,
        outputTokens: prev.outputTokens + r.outputTokens,
        cacheReadTokens: prev.cacheReadTokens + r.cacheReadTokens,
        cacheWriteTokens: prev.cacheWriteTokens + r.cacheWriteTokens,
        reasoningTokens: prev.reasoningTokens + r.reasoningTokens,
        totalTokens: prev.totalTokens + r.totalTokens,
        costUsd: prev.costUsd + r.costUsd,
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
