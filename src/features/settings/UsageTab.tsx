// AI 使用量ダッシュボード（設定 → 使用量タブ）
//
// 中立的な数値表示のみ。節約推奨や恐怖訴求は出さない（参照: feedback "中立的な見せ方"）。
// データソース: GET /api/usage → { raw: AIUsageEvent[], summary: AIUsageMonthlySummary[] }
//   - raw: 直近 90 日分のイベント
//   - summary: 90 日より古い期間の月次集計（retention 後）

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { apiBase } from "../../lib/platform";
import { useLocale } from "../../i18n";

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
  costUsd: number;
};

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
    const prev = b.byFeature.get(ev.feature) ?? { tokens: 0, cost: 0 };
    prev.tokens += ev.totalTokens;
    prev.cost += ev.costUsd ?? 0;
    b.byFeature.set(ev.feature, prev);
    b.totalTokens += ev.totalTokens;
    b.totalCost += ev.costUsd ?? 0;
  }

  // 月次サマリ（90 日より古い分）も集計
  // day granularity では月次サマリは表示しない（粒度不一致）
  if (gran !== "day") {
    for (const s of summary) {
      const k = gran === "month" ? s.month : s.month.slice(0, 4);
      const b = buckets.get(k);
      if (!b) continue;
      const prev = b.byFeature.get(s.feature) ?? { tokens: 0, cost: 0 };
      prev.tokens += s.totalTokens;
      prev.cost += s.costUsd;
      b.byFeature.set(s.feature, prev);
      b.totalTokens += s.totalTokens;
      b.totalCost += s.costUsd;
    }
  }

  return keys.map((k) => buckets.get(k)!);
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(n: number): string {
  if (n === 0) return "—";
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

  const buckets = useMemo(() => buildBuckets(raw, summary, granularity), [raw, summary, granularity]);

  const features = useMemo(() => {
    const set = new Set<string>();
    for (const b of buckets) for (const f of b.byFeature.keys()) set.add(f);
    // 既知の順序で並べ、未知 feature は末尾
    return [
      ...FEATURE_ORDER.filter((f) => set.has(f)),
      ...Array.from(set).filter((f) => !FEATURE_ORDER.includes(f)).sort(),
    ];
  }, [buckets]);

  const grandTotalTokens = buckets.reduce((sum, b) => sum + b.totalTokens, 0);
  const grandTotalCost = buckets.reduce((sum, b) => sum + b.totalCost, 0);
  const maxBucketTokens = Math.max(1, ...buckets.map((b) => b.totalTokens));

  return (
    <div className="space-y-4">
      {/* ヘッダー */}
      <div>
        <h3 className="text-xs font-semibold text-foreground">{t("settings.usage.title")}</h3>
        <p className="text-[11px] text-muted-foreground mt-1">
          {t("settings.usage.description")}
        </p>
      </div>

      {/* Vercel モード（永続化不可）の警告 */}
      {mode === "vercel" && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-2.5">
          <AlertCircle size={14} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-900 dark:text-amber-200">
            {t("settings.usage.vercelUnsupported")}
          </p>
        </div>
      )}

      {/* 粒度切り替え */}
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
            {formatCost(grandTotalCost)}
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
                    title={`${b.key}: ${formatTokens(b.totalTokens)} tokens / ${formatCost(b.totalCost)}`}
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

          {/* feature 別内訳 */}
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
                return (
                  <div
                    key={f}
                    className="flex items-center gap-2 text-xs"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-sm shrink-0"
                      style={{ backgroundColor: featureColor(f) }}
                    />
                    <span className="text-foreground flex-1 truncate font-mono">{f}</span>
                    <span className="tabular-nums text-muted-foreground w-12 text-right">
                      {pct.toFixed(0)}%
                    </span>
                    <span className="tabular-nums text-foreground w-14 text-right">
                      {formatTokens(tokens)}
                    </span>
                    <span className="tabular-nums text-muted-foreground w-14 text-right">
                      {formatCost(cost)}
                    </span>
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
