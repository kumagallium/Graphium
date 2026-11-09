// AI に使われた記録（usage-log.ts）から、ページごとの「最近どれだけ使われたか」を出す。
//
// 全体グラフで、最近 AI に使われたページを緑に灯し、そこから線に沿って火花を走らせる
// ために使う。重みは時間で薄れる（7 日で半分）。新しく使われるほど強く、使われなく
// なったところは自然に消えていく。
//
// 読み込み（appData の一覧と読み出し）とは分けてある。ここは純粋な計算だけ。

import type { StorageProvider } from "../../lib/storage/types";
import { AI_USAGE_KEY_PREFIX, isAiUsageFile, type AiUsageFile } from "./usage-log";

/** 見る範囲（日数）。これより古い記録は読まない */
export const USAGE_WINDOW_DAYS = 30;
/** 重みが半分になる日数 */
export const USAGE_HALF_LIFE_DAYS = 7;
/** 一度に読むファイル数の上限（1 日に何十セッションもあっても読み込みが膨らまないように） */
export const USAGE_MAX_FILES = 400;

/** 使われ方ごとの重み。回答に引用された方を、外の AI が開いただけより重く見る */
const EVENT_WEIGHT = { cite: 1, read: 0.6 } as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 記録の参照（`wiki:<id>` / `note:<id>` / `asset:<fileId>` / `shared:<id>`）を
 * 全体グラフのノード ID に直す。ノートと知見は ID そのまま、素材は `media:<fileId>`。
 * 共有ライブラリのページは全体グラフに出ないので null。
 */
export function usageRefToGraphId(ref: string): string | null {
  const i = ref.indexOf(":");
  if (i <= 0) return null;
  const kind = ref.slice(0, i);
  const id = ref.slice(i + 1);
  if (!id) return null;
  if (kind === "wiki" || kind === "note") return id;
  if (kind === "asset") return `media:${id}`;
  return null;
}

/** キー `ai-usage-YYYYMMDD-...` の日付部分（取れなければ null） */
function keyDateStamp(key: string): string | null {
  const m = key.slice(AI_USAGE_KEY_PREFIX.length).match(/^(\d{8})-/);
  return m ? m[1] : null;
}

/** now から days 日前（UTC）の YYYYMMDD */
function stampDaysAgo(now: Date, days: number): string {
  const d = new Date(now.getTime() - days * DAY_MS);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * 読む対象のキーを選ぶ。範囲内の日付のものだけ、新しい日付から max 件まで。
 * 日付の読めないキーは読まない。
 */
export function pickUsageKeys(
  keys: readonly string[],
  now: Date,
  windowDays: number = USAGE_WINDOW_DAYS,
  max: number = USAGE_MAX_FILES,
): string[] {
  const since = stampDaysAgo(now, windowDays);
  return keys
    .filter((k) => k.startsWith(AI_USAGE_KEY_PREFIX))
    .map((k) => ({ k, d: keyDateStamp(k) }))
    .filter((x): x is { k: string; d: string } => x.d !== null && x.d >= since)
    .sort((a, b) => (a.d === b.d ? a.k.localeCompare(b.k) : b.d.localeCompare(a.d)))
    .slice(0, max)
    .map((x) => x.k);
}

/**
 * ページごとの重み（0〜1）。各 event が「7 日で半分になる」値を足し、一番強い
 * ページが 1 になるように割る。範囲外・未来の event と、グラフに出ない参照は数えない。
 */
export function computeUsageActivity(
  files: readonly AiUsageFile[],
  now: Date,
  opts: { windowDays?: number; halfLifeDays?: number } = {},
): Map<string, number> {
  const windowMs = (opts.windowDays ?? USAGE_WINDOW_DAYS) * DAY_MS;
  const halfLifeMs = (opts.halfLifeDays ?? USAGE_HALF_LIFE_DAYS) * DAY_MS;
  const raw = new Map<string, number>();
  const nowMs = now.getTime();
  for (const f of files) {
    for (const e of f.events) {
      const t = Date.parse(e.t);
      if (!Number.isFinite(t)) continue;
      const age = nowMs - t;
      // 端末の時計のずれで少し未来になったものは今として数える
      if (age > windowMs || age < -DAY_MS) continue;
      const id = usageRefToGraphId(e.ref);
      if (!id) continue;
      const w = (EVENT_WEIGHT[e.ev] ?? 0) * Math.pow(0.5, Math.max(0, age) / halfLifeMs);
      if (w > 0) raw.set(id, (raw.get(id) ?? 0) + w);
    }
  }
  let max = 0;
  for (const v of raw.values()) if (v > max) max = v;
  const out = new Map<string, number>();
  if (max <= 0) return out;
  for (const [id, v] of raw) out.set(id, v / max);
  return out;
}

/**
 * 保存先から記録を読み、ページごとの重みを返す。appData を持たない保存先
 * （Google Drive）や、読めなかったときは空。失敗はグラフの表示を止めない。
 */
export async function loadUsageActivity(
  provider: Pick<StorageProvider, "listAppDataKeys" | "readAppData"> | null | undefined,
  now: Date = new Date(),
): Promise<Map<string, number>> {
  if (!provider?.listAppDataKeys || !provider.readAppData) return new Map();
  try {
    const keys = pickUsageKeys(await provider.listAppDataKeys(AI_USAGE_KEY_PREFIX), now);
    const read = provider.readAppData.bind(provider);
    const files = (
      await Promise.all(
        keys.map(async (k) => {
          try {
            return await read(k);
          } catch {
            return null;
          }
        }),
      )
    ).filter(isAiUsageFile);
    return computeUsageActivity(files, now);
  } catch (e) {
    console.warn("[ai-usage] 記録を読めなかった（グラフは灯さずに出す）", e);
    return new Map();
  }
}
