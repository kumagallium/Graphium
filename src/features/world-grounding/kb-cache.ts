// World-model grounding KB cache (Phase 2 / PR 2B).
//
// KB は「seed (public/grounding-kb/) + cache (appdata)」の 2 層構造。
// このファイルは appdata 側の沈殿キャッシュを担当する。
//
// 沈殿の鉄則（コードで強制、kickoff §6 / PR 2B plan §F）:
//   1. verdict が 4 値のどれでもない（null など）entry は沈殿しない（not_found 非沈殿）
//   2. generatedByModel が無い / manual-curated@v1 印の entry は沈殿しない（seed 専用）
//   3. claim / keywords が空の entry は沈殿しない（壊れた entry を避ける）
//   4. 形 1 非共有: ローカル個人 cache のみで、共有 export はこの PR では作らない
//
// データ寿命:
// - 同じ正規化 claim に対する重複沈殿は append-only（古い entry は残す）。
//   retriever 側で複数 entry がマッチしたとき matchedKeywords が多い方を採用する
//   既存ロジックがあるので、結果として「最も詳細な entry」が勝つ。

import { getActiveProvider } from "../../lib/storage/registry";
import type { KbEntry, KbFile } from "./distilled-kb-retriever";

const CACHE_KEY_PREFIX = "grounding-kb-cache";

function cacheKey(domain: string): string {
  // domain は alphanumeric + `-` を想定。万一危険な文字が入っても StorageProvider 側で
  // safeId() でサニタイズされるが、念のため空文字を弾く。
  if (!domain || !/^[a-z0-9-]+$/i.test(domain)) {
    throw new Error(`invalid grounding-kb domain: ${domain}`);
  }
  return `${CACHE_KEY_PREFIX}-${domain}`;
}

/**
 * appdata から該当ドメインの cache KB を読む。
 * 未保存 / プロバイダ未対応 / 失敗時は null（fail-open）。
 */
export async function loadKbCache(domain: string): Promise<KbFile | null> {
  const provider = getActiveProvider();
  if (!provider.readAppData) return null;
  try {
    const raw = (await provider.readAppData(cacheKey(domain))) as KbFile | null;
    if (!raw || typeof raw !== "object" || raw.version !== 1) return null;
    if (!Array.isArray(raw.entries)) return null;
    return raw;
  } catch (err) {
    console.warn("[world-grounding] kb-cache load failed:", err);
    return null;
  }
}

/**
 * 沈殿の鉄則を assert する。違反した entry は cache に書かない。
 *
 * 鉄則 1: verdict は 4 値（established / supported / weak / contested）のみ
 * 鉄則 2: generatedByModel 必須、`manual-curated@v1` は不可（seed 専用印）
 * 鉄則 3: claim / keywords は非空
 */
export function isValidForCaching(entry: KbEntry): boolean {
  const VERDICTS = ["established", "supported", "weak", "contested"];
  if (!VERDICTS.includes(entry.verdict as string)) return false;
  if (!entry.generatedByModel || entry.generatedByModel === "manual-curated@v1") return false;
  if (!entry.claim || typeof entry.claim !== "string" || !entry.claim.trim()) return false;
  if (!Array.isArray(entry.keywords) || entry.keywords.length === 0) return false;
  return true;
}

/**
 * cache に entry を append する。鉄則を満たさない entry は静かに無視する（false 返却）。
 */
export async function appendToKbCache(
  entry: KbEntry,
  domain: string,
): Promise<boolean> {
  if (!isValidForCaching(entry)) return false;
  const provider = getActiveProvider();
  if (!provider.writeAppData || !provider.readAppData) return false;
  const current = (await loadKbCache(domain)) ?? {
    version: 1 as const,
    domain,
    checkedBy: "distilled-kb@v1",
    seedSource: "model-cache@v1",
    entries: [],
  };
  const next: KbFile = {
    ...current,
    seedSource: current.seedSource ?? "model-cache@v1",
    entries: [...current.entries, entry],
  };
  try {
    await provider.writeAppData(cacheKey(domain), next);
    return true;
  } catch (err) {
    console.warn("[world-grounding] kb-cache write failed:", err);
    return false;
  }
}

/**
 * seed KB と cache KB を merge する。
 * entry id の重複は cache 優先（cache 側が更新版を持つ可能性）。
 * 単純な配列連結だが、id 重複は後勝ちで dedup する。
 */
export function mergeKb(seed: KbFile | null, cache: KbFile | null): KbFile | null {
  if (!seed && !cache) return null;
  const base = seed ?? cache!;
  const seedEntries = seed?.entries ?? [];
  const cacheEntries = cache?.entries ?? [];
  // id 重複は cache 優先（後勝ち）
  const cacheIds = new Set(cacheEntries.map((e) => e.id));
  const merged: KbEntry[] = [
    ...seedEntries.filter((e) => !cacheIds.has(e.id)),
    ...cacheEntries,
  ];
  return {
    version: 1,
    domain: base.domain,
    checkedBy: base.checkedBy,
    seedSource: base.seedSource,
    entries: merged,
  };
}

/** テスト用: cache をクリアする（本番コードからは呼ばない）。 */
export async function clearKbCacheForTest(domain: string): Promise<void> {
  const provider = getActiveProvider();
  if (!provider.writeAppData) return;
  await provider.writeAppData(cacheKey(domain), null);
}
