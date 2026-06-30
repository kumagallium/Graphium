// 蒸留 KB（distilled grounding KB）の retriever。
//
// LLM を呼ばず、KB エントリの keywords が claim 本文に複数語ヒットするかで verdict を返す。
// kickoff §1.3「WikiMeta.grounding に自己記述で持つ」「サブシステムを増やさない」方針。
//
// 設計:
//   - KB JSON は public/grounding-kb/seed.v1.json 固定で配信
//   - 読み込みは module キャッシュで lazy（最初の checkValidityFromKB 呼び出しで fetch）
//   - 正規化は NFKC + lowercase（既存 bench/material-science/evaluator.ts の方針と同じ流儀）
//   - マッチなしは null（degrade。verdict 未付与で WikiMeta.grounding.validity は undefined のまま）
//
// PR 2C で domain 分割を撤廃した。entry は単一の seed.v1.json + 単一の appdata cache に
// 集約される。分野ラベル（tags / domain）は持たない — LLM に分類を強いると語彙が乱立し、
// retriever / 沈殿 / フィルタのいずれにも実質的な利益が無いため。

import type {
  GroundingSource,
  GroundingValidityVerdict,
} from "../../lib/document-types";

export type KbEntry = {
  id: string;
  verdict: GroundingValidityVerdict;
  claim: string;
  rationale: string;
  keywords: string[];
  sources?: GroundingSource[];
  /**
   * このエントリのスキーマバージョン（省略時は 1）。
   * 後段で entry 単位に再蒸留が走るとき互換チェックに使う。
   */
  version?: number;
  /**
   * このエントリを生成した出所。
   * - "manual-curated@v1" : 人手キュレーション（seed の既定）
   * - "<model-id>"        : モデル判定の沈殿（PR 2B 以降）
   */
  generatedByModel?: string;
  /**
   * web 検索の証拠に基づいて判定されたか（Phase 5）。
   * - true       : Wikipedia / OpenAlex / 検索 MCP の証拠に基づく判定（sources の URL は実在保証）
   * - undefined  : 旧来の parametric 判定（モデルの記憶のみ）。web 証拠が取れる今は
   *                ヒット時に一度だけ再照合して web-grounded で上書きする（auto-upgrade）。
   */
  grounded?: boolean;
};

export type KbFile = {
  version: 1;
  checkedBy: string;
  /**
   * KB ファイル全体の出所種別。
   * - "manual-curated@v1": 手キュレーションの seed
   * - "model-cache@<v>":   モデル判定が沈殿したキャッシュ（PR 2B 以降）
   * 既定は "manual-curated@v1"（読み込み時に補完）。
   */
  seedSource?: string;
  entries: KbEntry[];
};

export type GroundingMatch = {
  entryId: string;
  verdict: GroundingValidityVerdict;
  claim: string;
  rationale: string;
  sources?: GroundingSource[];
  matchedKeywords: string[];
  /** マッチした keyword 数 / entry の keywords 数。0..1 */
  score: number;
  /** この entry が web 証拠に基づくか（undefined = 旧 parametric → auto-upgrade 対象） */
  grounded?: boolean;
  /** entry の出所（"manual-curated@v1" = 人手 seed は upgrade 対象外） */
  generatedByModel?: string;
};

const MIN_MATCHED_KEYWORDS = 2;
const SEED_FILENAME = "seed.v1.json";

// 同一 KB を複数回ロードしないようにモジュールキャッシュを持つ。
// テストでは clearKbCacheForTest() でリセットする。
const kbCache = new Map<string, Promise<KbFile | null>>();

/** 正規化: NFKC 正規化 + lowercase + 連続空白を 1 つに */
function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/** keyword が text に部分一致するか（正規化後の素朴な includes） */
function matchKeyword(normalizedText: string, keyword: string): boolean {
  const n = normalize(keyword);
  if (!n) return false;
  return normalizedText.includes(n);
}

/**
 * seed KB JSON（public/grounding-kb/seed.v1.json）を fetch して返す。
 * 失敗時は null（fail-open: 照合スキップ）。モジュール cache あり。
 */
export async function loadSeedKb(baseUrl: string): Promise<KbFile | null> {
  const cacheKey = baseUrl;
  const cached = kbCache.get(cacheKey);
  if (cached) return cached;

  const promise = (async () => {
    const url = `${baseUrl}grounding-kb/${SEED_FILENAME}`;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = (await res.json()) as KbFile;
      if (!data || data.version !== 1 || !Array.isArray(data.entries)) return null;
      return data;
    } catch {
      // ネットワーク断・PWA 配信不在は fail-open（照合スキップ）
      return null;
    }
  })();

  kbCache.set(cacheKey, promise);
  return promise;
}

/**
 * KB を返す。seed (public/) + appdata cache を merge した結果。
 * cache 側は dynamic import で読む（モジュール循環回避）。
 */
export async function loadKb(baseUrl: string): Promise<KbFile | null> {
  const [seed, cacheLayer] = await Promise.all([
    loadSeedKb(baseUrl),
    // dynamic import: tree-shake 可、テストでモック容易
    import("./kb-cache").then((m) => m.loadKbCache()).catch(() => null),
  ]);
  if (!seed && !cacheLayer) return null;
  const merged = await import("./kb-cache").then((m) =>
    m.mergeKb(seed, cacheLayer),
  );
  return merged;
}

/** テスト用のキャッシュ初期化。本番コードからは呼ばない。 */
export function clearKbCacheForTest(): void {
  kbCache.clear();
}

/**
 * KB から claim を retrieve する。
 *
 * - keywords が `MIN_MATCHED_KEYWORDS` 件以上一致する entry を candidate に絞り、
 *   matchedKeywords が最も多い entry をベストとして返す
 * - タイ時は KB 順を保つ（contested を上に置きたい運用ならキュレーション側で順序付け）
 * - マッチなしは null（verdict 未付与）
 *
 * @param claimText 照合対象の自然文（WikiMeta のタイトル + 本文等を結合したもの）
 * @param options.kb 既にロード済みの KbFile（テスト・カスタムビルド用）
 * @param options.baseUrl public/ 配下を fetch する base URL
 */
export async function checkValidityFromKB(
  claimText: string,
  options: { baseUrl: string } | { kb: KbFile },
): Promise<GroundingMatch | null> {
  const kb = "kb" in options ? options.kb : await loadKb(options.baseUrl);
  if (!kb || kb.entries.length === 0) return null;

  const normText = normalize(claimText);
  if (!normText) return null;

  let best: GroundingMatch | null = null;
  for (const entry of kb.entries) {
    if (!Array.isArray(entry.keywords) || entry.keywords.length === 0) continue;
    const matched = entry.keywords.filter((k) => matchKeyword(normText, k));
    if (matched.length < MIN_MATCHED_KEYWORDS) continue;
    const score = matched.length / entry.keywords.length;
    if (!best || matched.length > best.matchedKeywords.length) {
      best = {
        entryId: entry.id,
        verdict: entry.verdict,
        claim: entry.claim,
        rationale: entry.rationale,
        sources: entry.sources,
        matchedKeywords: matched,
        score,
        grounded: entry.grounded,
        generatedByModel: entry.generatedByModel,
      };
    }
  }
  return best;
}
