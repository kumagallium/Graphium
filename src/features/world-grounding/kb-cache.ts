// World-model grounding KB cache (Phase 2 / PR 2B + 2C).
//
// KB は「seed (public/grounding-kb/seed.v1.json) + cache (appdata)」の 2 層構造。
// このファイルは appdata 側の沈殿キャッシュを担当する。
//
// PR 2C: domain 分割を撤廃。cache は単一キー `grounding-kb-cache` に集約する。
// 旧 `grounding-kb-cache-materials` がある環境では、初回 load 時に新キーへマイグレートする。
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

const CACHE_KEY = "grounding-kb-cache";
/** PR 2C migration: 旧 domain 別キーから新キーへ吸い上げる。 */
const LEGACY_DOMAIN_KEYS = ["grounding-kb-cache-materials"];

/** マイグレーション済みかをセッション単位で記憶する（appdata 読みを毎回走らせない） */
let migrationDone = false;

/**
 * 旧 domain 別 cache キー（PR 2B 時代）を新統合キーへ移行する。
 * - 旧キーに entries があれば新キーへ append
 * - 旧キーは null で上書き（削除）
 * - 失敗しても fail-open（次回起動で再試行）
 */
async function migrateLegacyKbCache(): Promise<void> {
  if (migrationDone) return;
  migrationDone = true;
  const provider = getActiveProvider();
  if (!provider.readAppData || !provider.writeAppData) return;
  try {
    const current = (await provider.readAppData(CACHE_KEY)) as KbFile | null;
    const baseEntries: KbEntry[] = current?.entries ?? [];
    const existingIds = new Set(baseEntries.map((e) => e.id));
    const migratedEntries: KbEntry[] = [...baseEntries];
    let anyMigrated = false;
    for (const legacyKey of LEGACY_DOMAIN_KEYS) {
      const legacy = (await provider.readAppData(legacyKey)) as KbFile | null;
      if (!legacy || !Array.isArray(legacy.entries) || legacy.entries.length === 0) {
        continue;
      }
      for (const entry of legacy.entries) {
        if (existingIds.has(entry.id)) continue;
        migratedEntries.push(entry);
        existingIds.add(entry.id);
      }
      anyMigrated = true;
      await provider.writeAppData(legacyKey, null);
    }
    if (anyMigrated) {
      const next: KbFile = {
        version: 1,
        checkedBy: current?.checkedBy ?? "distilled-kb@v1",
        seedSource: current?.seedSource ?? "model-cache@v1",
        entries: migratedEntries,
      };
      await provider.writeAppData(CACHE_KEY, next);
      console.info("[world-grounding] migrated legacy domain caches into", CACHE_KEY);
    }
  } catch (err) {
    console.warn("[world-grounding] kb-cache migration failed:", err);
  }
}

/**
 * appdata から cache KB を読む。
 * 未保存 / プロバイダ未対応 / 失敗時は null（fail-open）。
 * 旧 domain 別キーがあれば初回読み込み時に統合キーへマイグレートする。
 */
export async function loadKbCache(): Promise<KbFile | null> {
  await migrateLegacyKbCache();
  const provider = getActiveProvider();
  if (!provider.readAppData) return null;
  try {
    const raw = (await provider.readAppData(CACHE_KEY)) as KbFile | null;
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
export async function appendToKbCache(entry: KbEntry): Promise<boolean> {
  if (!isValidForCaching(entry)) return false;
  const provider = getActiveProvider();
  if (!provider.writeAppData || !provider.readAppData) return false;
  const current = (await loadKbCache()) ?? {
    version: 1 as const,
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
    await provider.writeAppData(CACHE_KEY, next);
    return true;
  } catch (err) {
    console.warn("[world-grounding] kb-cache write failed:", err);
    return false;
  }
}

/**
 * cache から指定 id の entry を削除する。
 * seed entry（generatedByModel undefined or "manual-curated@v1"）は appdata cache には
 * 居ないはずだが、ユーザー操作上は seed の削除は別経路（README 編集）に委ねる。
 *
 * 返り値:
 * - `true`:  該当 entry が cache 上に存在し、書き戻しが成功した
 * - `false`: 該当 entry が cache に無い / プロバイダ未対応 / 書き込み失敗
 */
export async function removeFromKbCache(entryId: string): Promise<boolean> {
  if (!entryId || typeof entryId !== "string") return false;
  const provider = getActiveProvider();
  if (!provider.writeAppData || !provider.readAppData) return false;
  const current = await loadKbCache();
  if (!current || !Array.isArray(current.entries)) return false;
  const remaining = current.entries.filter((e) => e.id !== entryId);
  if (remaining.length === current.entries.length) return false; // not found
  const next: KbFile = {
    ...current,
    entries: remaining,
  };
  try {
    await provider.writeAppData(CACHE_KEY, next);
    return true;
  } catch (err) {
    console.warn("[world-grounding] kb-cache remove failed:", err);
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
    checkedBy: base.checkedBy,
    seedSource: base.seedSource,
    entries: merged,
  };
}

/** テスト用: cache をクリアする（本番コードからは呼ばない）。 */
export async function clearKbCacheForTest(): Promise<void> {
  const provider = getActiveProvider();
  if (!provider.writeAppData) return;
  migrationDone = false;
  await provider.writeAppData(CACHE_KEY, null);
  for (const legacyKey of LEGACY_DOMAIN_KEYS) {
    await provider.writeAppData(legacyKey, null);
  }
}
