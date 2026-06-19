// AI 使用量ダッシュボード（設定 → 使用量タブ）
//
// 中立的な数値表示のみ。節約推奨や恐怖訴求は出さない（参照: feedback "中立的な見せ方"）。
// データソース: GET /api/usage → { raw: AIUsageEvent[], summary: AIUsageMonthlySummary[] }
//   - raw: 直近 90 日分のイベント
//   - summary: 90 日より古い期間の月次集計（retention 後）

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, AlertCircle, ChevronRight, RefreshCw } from "lucide-react";
import { apiBase } from "../../lib/platform";
import { useLocale } from "../../i18n";
import { loadSettings, saveSettings, type LLMRateCurrency } from "./store";

type RateCurrency = LLMRateCurrency;

type AIUsageEvent = {
  ts: string;
  feature: string;
  provider: string;
  modelId: string;
  modelConfigId?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  totalTokens: number;
  durationMs?: number;
  /** 計算済みコスト（記録時の通貨）。サーバーで cost/costCurrency or costUsd のどちらかが入る */
  cost?: number;
  costCurrency?: RateCurrency;
  /** @deprecated 旧形式 (v0.11) */
  costUsd?: number;
};

type AIUsageMonthlySummary = {
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
  /** 通貨別の合計コスト */
  costByCurrency?: Partial<Record<RateCurrency, number>>;
  /** @deprecated 旧形式 */
  costUsd?: number;
};

/** USD ⇔ JPY 換算。同じ通貨ならそのまま返す。 */
function convertCost(amount: number, from: RateCurrency, to: RateCurrency, usdJpy: number): number {
  if (from === to) return amount;
  if (from === "usd" && to === "jpy") return amount * usdJpy;
  if (from === "jpy" && to === "usd") return amount / usdJpy;
  return amount;
}

/** イベントから表示通貨でのコストを取り出す。記録時の cost / costCurrency / 旧 costUsd を吸収する。 */
function eventCostInDisplayCurrency(
  ev: { cost?: number; costCurrency?: RateCurrency; costUsd?: number },
  displayCurrency: RateCurrency,
  usdJpy: number,
): number {
  let amount: number | undefined;
  let from: RateCurrency = "usd";
  if (ev.cost !== undefined) {
    amount = ev.cost;
    from = ev.costCurrency ?? "usd";
  } else if (ev.costUsd !== undefined) {
    amount = ev.costUsd;
    from = "usd";
  }
  if (amount === undefined) return 0;
  return convertCost(amount, from, displayCurrency, usdJpy);
}

/** 月次サマリから表示通貨でのコストを取り出す。通貨混在を吸収する。 */
function summaryCostInDisplayCurrency(
  s: { costByCurrency?: Partial<Record<RateCurrency, number>>; costUsd?: number },
  displayCurrency: RateCurrency,
  usdJpy: number,
): number {
  if (s.costByCurrency) {
    let sum = 0;
    for (const [c, v] of Object.entries(s.costByCurrency) as [RateCurrency, number][]) {
      sum += convertCost(v, c, displayCurrency, usdJpy);
    }
    return sum;
  }
  if (s.costUsd !== undefined) {
    return convertCost(s.costUsd, "usd", displayCurrency, usdJpy);
  }
  return 0;
}

type Granularity = "day" | "month" | "year";

type Bucket = {
  /** "2026-05-28" / "2026-05" / "2026" */
  key: string;
  /** UI 表示用の短い label */
  label: string;
  /** feature → tokens の breakdown */
  byFeature: Map<string, { tokens: number; cost: number }>;
  totalTokens: number;
  totalCost: number;
};

const FEATURE_ORDER: string[] = [
  "agent.chat",
  "wiki.ingest",
  "wiki.rewrite",
  "wiki.cross-update",
  "wiki.atomize",
  "wiki.lint",
  "prov.from-url",
  "prov.from-pdf",
  "world-grounding",
  "embedding",
];

const FEATURE_COLORS: Record<string, string> = {
  "agent.chat": "#6366f1",
  "wiki.ingest": "#0ea5e9",
  "wiki.rewrite": "#14b8a6",
  "wiki.cross-update": "#22c55e",
  "wiki.atomize": "#eab308",
  "wiki.lint": "#f97316",
  "prov.from-url": "#ec4899",
  "prov.from-pdf": "#a855f7",
  "world-grounding": "#06b6d4",
  embedding: "#94a3b8",
  unknown: "#64748b",
};

function featureColor(feature: string): string {
  return FEATURE_COLORS[feature] ?? FEATURE_COLORS.unknown;
}

function bucketKey(iso: string, gran: Granularity): string {
  // iso: "2026-05-28T10:30:00Z" or "2026-05" (summary month)
  if (gran === "day") return iso.slice(0, 10);
  if (gran === "month") return iso.slice(0, 7);
  return iso.slice(0, 4);
}

function shiftDate(d: Date, gran: Granularity, delta: number): Date {
  const x = new Date(d);
  if (gran === "day") x.setUTCDate(x.getUTCDate() + delta);
  else if (gran === "month") x.setUTCMonth(x.getUTCMonth() + delta);
  else x.setUTCFullYear(x.getUTCFullYear() + delta);
  return x;
}

function formatBucketKey(d: Date, gran: Granularity): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  if (gran === "day") return `${y}-${m}-${dd}`;
  if (gran === "month") return `${y}-${m}`;
  return `${y}`;
}

function shortLabel(key: string, gran: Granularity): string {
  if (gran === "day") return key.slice(5); // "05-28"
  if (gran === "month") return key.slice(2); // "26-05"
  return key;
}

const RANGE_SIZE: Record<Granularity, number> = {
  day: 14,
  month: 12,
  year: 5,
};

/** 横軸ラベルの間引き間隔。day は 14 件並ぶと "05-28" が潰れるので 2 件おきに表示する。 */
const LABEL_STRIDE: Record<Granularity, number> = {
  day: 2,
  month: 1,
  year: 1,
};

function buildBuckets(
  raw: AIUsageEvent[],
  summary: AIUsageMonthlySummary[],
  gran: Granularity,
  displayCurrency: RateCurrency,
  usdJpy: number,
  now: Date = new Date(),
): Bucket[] {
  const size = RANGE_SIZE[gran];
  const keys: string[] = [];
  for (let i = size - 1; i >= 0; i--) {
    keys.push(formatBucketKey(shiftDate(now, gran, -i), gran));
  }

  const buckets = new Map<string, Bucket>();
  for (const k of keys) {
    buckets.set(k, {
      key: k,
      label: shortLabel(k, gran),
      byFeature: new Map(),
      totalTokens: 0,
      totalCost: 0,
    });
  }

  // raw event を集計
  for (const ev of raw) {
    const k = bucketKey(ev.ts, gran);
    const b = buckets.get(k);
    if (!b) continue;
    const c = eventCostInDisplayCurrency(ev, displayCurrency, usdJpy);
    const prev = b.byFeature.get(ev.feature) ?? { tokens: 0, cost: 0 };
    prev.tokens += ev.totalTokens;
    prev.cost += c;
    b.byFeature.set(ev.feature, prev);
    b.totalTokens += ev.totalTokens;
    b.totalCost += c;
  }

  // 月次サマリ（90 日より古い分）も集計
  // day granularity では月次サマリは表示しない（粒度不一致）
  if (gran !== "day") {
    for (const s of summary) {
      const k = gran === "month" ? s.month : s.month.slice(0, 4);
      const b = buckets.get(k);
      if (!b) continue;
      const c = summaryCostInDisplayCurrency(s, displayCurrency, usdJpy);
      const prev = b.byFeature.get(s.feature) ?? { tokens: 0, cost: 0 };
      prev.tokens += s.totalTokens;
      prev.cost += c;
      b.byFeature.set(s.feature, prev);
      b.totalTokens += s.totalTokens;
      b.totalCost += c;
    }
  }

  return keys.map((k) => buckets.get(k)!);
}

type ModelLine = {
  modelId: string;
  /** プロバイダ識別子。claude-subscription はコスト欄を「従量課金なし」と表示するために使う。 */
  provider: string;
  tokens: number;
  cost: number;
};

/**
 * 期間内 raw event + summary を feature × model の 2 階層に集計する。
 * グラフ用の Bucket とは別系統だが、表示範囲（buckets の key set）は揃える。
 */
function buildFeatureModelBreakdown(
  raw: AIUsageEvent[],
  summary: AIUsageMonthlySummary[],
  buckets: Bucket[],
  gran: Granularity,
  displayCurrency: RateCurrency,
  usdJpy: number,
): Map<string, ModelLine[]> {
  const inRange = new Set(buckets.map((b) => b.key));
  // feature -> modelId -> { tokens, cost }
  const map = new Map<string, Map<string, ModelLine>>();

  const add = (
    feature: string,
    modelId: string,
    provider: string,
    tokens: number,
    cost: number,
  ) => {
    let byModel = map.get(feature);
    if (!byModel) {
      byModel = new Map();
      map.set(feature, byModel);
    }
    const prev = byModel.get(modelId) ?? { modelId, provider, tokens: 0, cost: 0 };
    prev.provider = provider;
    prev.tokens += tokens;
    prev.cost += cost;
    byModel.set(modelId, prev);
  };

  for (const ev of raw) {
    if (!inRange.has(bucketKey(ev.ts, gran))) continue;
    add(
      ev.feature,
      ev.modelId || "(unknown)",
      ev.provider,
      ev.totalTokens,
      eventCostInDisplayCurrency(ev, displayCurrency, usdJpy),
    );
  }
  if (gran !== "day") {
    for (const s of summary) {
      const k = gran === "month" ? s.month : s.month.slice(0, 4);
      if (!inRange.has(k)) continue;
      add(
        s.feature,
        s.modelId || "(unknown)",
        s.provider,
        s.totalTokens,
        summaryCostInDisplayCurrency(s, displayCurrency, usdJpy),
      );
    }
  }

  const result = new Map<string, ModelLine[]>();
  for (const [feature, byModel] of map) {
    const list = Array.from(byModel.values()).sort((a, b) => b.tokens - a.tokens);
    result.set(feature, list);
  }
  return result;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(n: number, currency: RateCurrency = "usd"): string {
  if (n === 0) return "—";
  if (currency === "jpy") {
    if (n < 1) return "<¥1";
    return `¥${Math.round(n).toLocaleString()}`;
  }
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

export function UsageTab() {
  const { t } = useLocale();
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [raw, setRaw] = useState<AIUsageEvent[]>([]);
  const [summary, setSummary] = useState<AIUsageMonthlySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"node" | "vercel">("node");

  // 単価を直した後のコスト再計算（確認 → 実行 → 結果表示）
  const [recalcState, setRecalcState] = useState<"idle" | "confirm" | "running">("idle");
  const [recalcResult, setRecalcResult] = useState<{ recalculated: number; skipped: number } | null>(null);

  // 表示通貨と換算レート（settings 永続化、初回ロードで読み込み）
  const [displayCurrency, setDisplayCurrencyState] = useState<RateCurrency>("usd");
  const [usdJpyRate, setUsdJpyRateState] = useState<number>(150);
  const [usdJpyInput, setUsdJpyInput] = useState<string>("150");

  useEffect(() => {
    const s = loadSettings();
    setDisplayCurrencyState(s.displayCurrency);
    setUsdJpyRateState(s.usdJpyRate);
    setUsdJpyInput(String(s.usdJpyRate));
  }, []);

  const persistDisplayCurrency = useCallback((c: RateCurrency) => {
    setDisplayCurrencyState(c);
    saveSettings({ ...loadSettings(), displayCurrency: c });
  }, []);

  const commitUsdJpyRate = useCallback(() => {
    const n = Number(usdJpyInput);
    if (Number.isFinite(n) && n > 0) {
      setUsdJpyRateState(n);
      saveSettings({ ...loadSettings(), usdJpyRate: n });
    } else {
      // 不正値は元に戻す
      setUsdJpyInput(String(usdJpyRate));
    }
  }, [usdJpyInput, usdJpyRate]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase()}/usage`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        raw: AIUsageEvent[];
        summary: AIUsageMonthlySummary[];
        mode: "node" | "vercel";
      };
      setRaw(data.raw);
      setSummary(data.summary);
      setMode(data.mode);
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleRecalculate = useCallback(async () => {
    setRecalcState("running");
    setRecalcResult(null);
    try {
      const res = await fetch(`${apiBase()}/usage/recalculate`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { total: number; recalculated: number; skipped: number };
      setRecalcResult({ recalculated: data.recalculated, skipped: data.skipped });
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "recalculation failed");
    } finally {
      setRecalcState("idle");
    }
  }, [loadData]);

  const buckets = useMemo(
    () => buildBuckets(raw, summary, granularity, displayCurrency, usdJpyRate),
    [raw, summary, granularity, displayCurrency, usdJpyRate],
  );

  const features = useMemo(() => {
    const set = new Set<string>();
    for (const b of buckets) for (const f of b.byFeature.keys()) set.add(f);
    // 既知の順序で並べ、未知 feature は末尾
    return [
      ...FEATURE_ORDER.filter((f) => set.has(f)),
      ...Array.from(set).filter((f) => !FEATURE_ORDER.includes(f)).sort(),
    ];
  }, [buckets]);

  // feature -> modelId 別 breakdown。アコーディオン展開時のサブ行で使う。
  const featureModelBreakdown = useMemo(
    () => buildFeatureModelBreakdown(raw, summary, buckets, granularity, displayCurrency, usdJpyRate),
    [raw, summary, buckets, granularity, displayCurrency, usdJpyRate],
  );
  const [expandedFeatures, setExpandedFeatures] = useState<Set<string>>(new Set());
  const toggleFeature = useCallback((f: string) => {
    setExpandedFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  }, []);

  const grandTotalTokens = buckets.reduce((sum, b) => sum + b.totalTokens, 0);
  const grandTotalCost = buckets.reduce((sum, b) => sum + b.totalCost, 0);
  const maxBucketTokens = Math.max(1, ...buckets.map((b) => b.totalTokens));

  return (
    <div className="space-y-4">
      {/* ヘッダー */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold text-foreground">{t("settings.usage.title")}</h3>
          <p className="text-[11px] text-muted-foreground mt-1">
            {t("settings.usage.description")}
          </p>
        </div>
        {/* 単価を直した後のコスト再計算。記録があるサーバーモードでのみ表示。 */}
        {mode === "node" && raw.length > 0 && (
          <div className="shrink-0">
            {recalcState === "confirm" ? (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleRecalculate}
                  className="text-xs text-primary hover:text-primary/80 font-medium px-2 py-1"
                >
                  {t("settings.usage.recalculate.run")}
                </button>
                <button
                  onClick={() => setRecalcState("idle")}
                  className="text-xs text-muted-foreground hover:text-foreground px-2 py-1"
                >
                  {t("common.cancel")}
                </button>
              </div>
            ) : recalcState === "running" ? (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-2 py-1">
                <Loader2 size={12} className="animate-spin" />
                {t("settings.usage.recalculate.running")}
              </div>
            ) : (
              <button
                onClick={() => {
                  setRecalcResult(null);
                  setRecalcState("confirm");
                }}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-border rounded-md px-2.5 py-1"
              >
                <RefreshCw size={12} />
                {t("settings.usage.recalculate.button")}
              </button>
            )}
          </div>
        )}
      </div>

      {/* 再計算の確認説明 */}
      {recalcState === "confirm" && (
        <p className="text-[11px] text-muted-foreground -mt-1">
          {t("settings.usage.recalculate.hint")}
        </p>
      )}

      {/* 再計算の結果 */}
      {recalcResult && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 p-2 text-[11px] text-emerald-800 dark:text-emerald-200">
          {t("settings.usage.recalculate.done", {
            recalculated: String(recalcResult.recalculated),
            skipped: String(recalcResult.skipped),
          })}
        </div>
      )}

      {/* Vercel モード（永続化不可）の警告 */}
      {mode === "vercel" && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-2.5">
          <AlertCircle size={14} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-900 dark:text-amber-200">
            {t("settings.usage.vercelUnsupported")}
          </p>
        </div>
      )}

      {/* 粒度切り替え + 表示通貨 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 p-1 bg-muted/50 rounded-md w-fit">
          {(["day", "month", "year"] as Granularity[]).map((g) => (
            <button
              key={g}
              onClick={() => setGranularity(g)}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                granularity === g
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(`settings.usage.granularity.${g}`)}
            </button>
          ))}
        </div>

        <div className="flex gap-1 p-1 bg-muted/50 rounded-md w-fit">
          {(["usd", "jpy"] as RateCurrency[]).map((c) => (
            <button
              key={c}
              onClick={() => persistDisplayCurrency(c)}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                displayCurrency === c
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {c === "usd" ? "USD" : "JPY"}
            </button>
          ))}
        </div>

        {/* 換算レート inline 編集。USD↔JPY 換算が発生する時だけ意味がある。 */}
        <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {t("settings.usage.usdJpyRateLabel")}
          <input
            type="number"
            min="0"
            step="0.01"
            value={usdJpyInput}
            onChange={(e) => setUsdJpyInput(e.target.value)}
            onBlur={commitUsdJpyRate}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitUsdJpyRate();
              }
            }}
            className="w-16 px-1.5 py-0.5 text-xs rounded border border-border bg-background tabular-nums text-right"
          />
        </label>
      </div>

      {/* 合計 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-md border border-border p-3">
          <div className="text-[11px] text-muted-foreground">{t("settings.usage.totalTokens")}</div>
          <div className="text-lg font-semibold text-foreground tabular-nums mt-0.5">
            {formatTokens(grandTotalTokens)}
          </div>
        </div>
        <div className="rounded-md border border-border p-3">
          <div className="text-[11px] text-muted-foreground">{t("settings.usage.totalCost")}</div>
          <div className="text-lg font-semibold text-foreground tabular-nums mt-0.5">
            {formatCost(grandTotalCost, displayCurrency)}
          </div>
        </div>
      </div>

      {/* グラフ */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 size={16} className="animate-spin mr-2" />
          <span className="text-xs">{t("settings.usage.loading")}</span>
        </div>
      ) : error ? (
        <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-700 dark:text-red-300">
          {t("settings.usage.error", { message: error })}
        </div>
      ) : grandTotalTokens === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center">
          <p className="text-xs text-muted-foreground">{t("settings.usage.empty")}</p>
        </div>
      ) : (
        <>
          <div>
            <div className="text-[11px] text-muted-foreground mb-2">
              {t("settings.usage.chartTitle")}
            </div>
            <div className="flex items-stretch gap-1 h-32 border-b border-border">
              {buckets.map((b) => {
                // 親の h-32 に対する全体の高さ比率。これを 0..100% の中で各 feature に分配する。
                const heightPct = b.totalTokens === 0 ? 0 : (b.totalTokens / maxBucketTokens) * 100;
                return (
                  <div
                    key={b.key}
                    className="flex-1 flex flex-col justify-end min-w-0"
                    title={`${b.key}: ${formatTokens(b.totalTokens)} tokens / ${formatCost(b.totalCost, displayCurrency)}`}
                  >
                    {/* 内側ラッパで「このバケットの相対高さ」を確定させる。
                     *  外側 flex-1 は h-full（h-32 と同じ）に伸び、内側がその中で
                     *  height: heightPct% を持つ。さらに内側の feature 要素は
                     *  byFeature の比率で積み上がる。 */}
                    <div
                      className="w-full flex flex-col"
                      style={{ height: `${heightPct}%` }}
                    >
                      {features.map((f) => {
                        const part = b.byFeature.get(f);
                        if (!part || part.tokens === 0) return null;
                        const partPct = (part.tokens / Math.max(1, b.totalTokens)) * 100;
                        return (
                          <div
                            key={f}
                            style={{
                              height: `${partPct}%`,
                              backgroundColor: featureColor(f),
                            }}
                            className="w-full first:rounded-t-sm"
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-1 mt-1">
              {buckets.map((b, i) => {
                // 間引き: 末尾を必ず表示しつつ、stride で揃える
                const stride = LABEL_STRIDE[granularity];
                const show = (buckets.length - 1 - i) % stride === 0;
                return (
                  <div
                    key={b.key}
                    className="flex-1 text-center text-[10px] text-muted-foreground tabular-nums whitespace-nowrap"
                  >
                    {show ? b.label : ""}
                  </div>
                );
              })}
            </div>
          </div>

          {/* feature 別内訳（クリックでモデル別の内訳を展開） */}
          <div>
            <div className="text-[11px] text-muted-foreground mb-2">
              {t("settings.usage.breakdown")}
            </div>
            <div className="space-y-1">
              {features.map((f) => {
                const tokens = buckets.reduce(
                  (sum, b) => sum + (b.byFeature.get(f)?.tokens ?? 0),
                  0,
                );
                const cost = buckets.reduce(
                  (sum, b) => sum + (b.byFeature.get(f)?.cost ?? 0),
                  0,
                );
                if (tokens === 0) return null;
                const pct = grandTotalTokens > 0 ? (tokens / grandTotalTokens) * 100 : 0;
                const models = featureModelBreakdown.get(f) ?? [];
                // モデルが 2 種類以上なら折りたたみ可能。1 種類でもモデル名は
                // feature 行のサブテキストとして常に見せる（「これは何で動いてる？」が一目で分かるように）。
                const hasMultipleModels = models.length > 1;
                const singleModel = models.length === 1 ? models[0] : null;
                const isExpanded = expandedFeatures.has(f);
                return (
                  <div key={f}>
                    <button
                      type="button"
                      onClick={() => hasMultipleModels && toggleFeature(f)}
                      disabled={!hasMultipleModels}
                      className={`w-full flex items-center gap-2 text-xs py-0.5 rounded ${
                        hasMultipleModels
                          ? "hover:bg-muted/50 cursor-pointer"
                          : "cursor-default"
                      }`}
                    >
                      <ChevronRight
                        size={11}
                        className={`shrink-0 text-muted-foreground transition-transform ${
                          !hasMultipleModels ? "invisible" : isExpanded ? "rotate-90" : ""
                        }`}
                      />
                      <span
                        className="w-2.5 h-2.5 rounded-sm shrink-0"
                        style={{ backgroundColor: featureColor(f) }}
                      />
                      <span className="flex-1 min-w-0 text-left">
                        <span className="text-foreground font-mono">{f}</span>
                        {singleModel && (
                          <span className="ml-2 text-[10px] text-muted-foreground font-mono truncate">
                            {singleModel.modelId}
                          </span>
                        )}
                        {hasMultipleModels && (
                          <span className="ml-2 text-[10px] text-muted-foreground">
                            {t("settings.usage.modelsCount", { count: String(models.length) })}
                          </span>
                        )}
                      </span>
                      <span className="tabular-nums text-muted-foreground w-12 text-right">
                        {pct.toFixed(0)}%
                      </span>
                      <span className="tabular-nums text-foreground w-14 text-right">
                        {formatTokens(tokens)}
                      </span>
                      <span className="tabular-nums text-muted-foreground w-14 text-right">
                        {formatCost(cost, displayCurrency)}
                      </span>
                    </button>
                    {isExpanded && hasMultipleModels && (
                      <div className="ml-[26px] mt-0.5 mb-1 space-y-0.5">
                        {models.map((m) => {
                          const modelPct = tokens > 0 ? (m.tokens / tokens) * 100 : 0;
                          return (
                            <div
                              key={m.modelId}
                              className="flex items-center gap-2 text-[11px] text-muted-foreground py-0.5"
                            >
                              <span className="flex-1 truncate font-mono text-left">
                                {m.modelId}
                              </span>
                              <span className="tabular-nums w-12 text-right">
                                {modelPct.toFixed(0)}%
                              </span>
                              <span className="tabular-nums w-14 text-right text-foreground/80">
                                {formatTokens(m.tokens)}
                              </span>
                              <span className="tabular-nums w-14 text-right">
                                {m.provider === "claude-subscription" ? (
                                  <span
                                    title={t("settings.usage.subscriptionNoCost")}
                                    className="text-foreground/45"
                                  >
                                    {t("settings.usage.subscriptionShort")}
                                  </span>
                                ) : (
                                  formatCost(m.cost, displayCurrency)
                                )}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
