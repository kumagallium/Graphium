// MatPROV 形式 ↔ MatPROV 形式の構造比較メトリクス（Phase 5a）。
//
// docs/internal/external-source-extraction-prompt.md §10 の 4 指標を計算する:
//   (a) Activity の node 数と label の一致率
//   (b) Entity（material / tool）の node 数と label の一致率
//   (c) Usage / Generation edge の一致率
//   (d) parameter key/value の一致率
//
// 比較ロジック:
//   - 主指標: 正規化（lowercase + trim + NFKC + 句読点除去）後の exact match
//   - 副指標: 空白区切り token 集合の F1（precision/recall/F1）
//
// edge の比較は順序を無視。proc 単位で集合 {(activityLabel, entityLabel)} を作って比較する。
// node や parameter の比較も集合ベース（順序非依存）。
//
// LLM が複数 procedure を返すケースに対応するため、比較は「proc を 1 対 1 で最良マッチング」
// した上で各 proc の指標を集計する（Hungarian は重い割に意味が薄いので、greedy で十分）。

import type {
  MatProvActivity,
  MatProvEntity,
  MatProvOutput,
  MatProvProcedure,
} from "../../../src/server/services/prov-ingester-profiles/matprov-types";
import {
  readEntityType,
  readLabel,
  readParameters,
} from "../../../src/server/services/prov-ingester-profiles/matprov-types";

export type MetricCounts = {
  /** 一致数（gold ∩ pred、正規化後） */
  matched: number;
  /** 予測の出力数 */
  predicted: number;
  /** gold の参照数 */
  gold: number;
};

export type TokenF1 = {
  precision: number;
  recall: number;
  f1: number;
};

export type ProcedureMetric = {
  activities: MetricCounts;
  materials: MetricCounts;
  tools: MetricCounts;
  edges: MetricCounts;
  parameters: MetricCounts;
  /** 副指標: token-based F1（label を空白 split） */
  tokenF1: {
    activities: TokenF1;
    materials: TokenF1;
    tools: TokenF1;
    parameters: TokenF1;
  };
};

export type SampleMetric = {
  /** sample 識別子（DOI 由来 slug 等） */
  id: string;
  /** procedure 数 (gold / predicted) */
  goldProcedureCount: number;
  predictedProcedureCount: number;
  /** マッチした procedure ごとの集計（gold index 順） */
  perProcedure: ProcedureMetric[];
  /** sample 全体での集計（4 指標を合算） */
  total: ProcedureMetric;
};

export function evaluateSample(
  id: string,
  predicted: MatProvOutput,
  gold: MatProvOutput,
): SampleMetric {
  // gold procedures と predicted を greedy にマッチさせる（label の正規化一致 → 残りは順序）
  const matches = greedyMatchProcedures(gold, predicted);

  const perProcedure: ProcedureMetric[] = [];
  for (const m of matches) {
    perProcedure.push(evaluateProcedure(m.pred, m.gold));
  }

  // 余った gold procedure 分は predicted が空のメトリクスとして計上
  // （これにより recall が正しく下がる）
  for (let i = matches.length; i < gold.length; i++) {
    perProcedure.push(evaluateProcedure(emptyProcedure(), gold[i]));
  }

  // 余った predicted procedure は gold 側を空として計上（precision を下げる）
  // matches 配列は最大 min(g,p) 個。p > g のときは余剰 pred を追加。
  const matchedPredIndices = new Set(matches.map((m) => m.predIndex));
  for (let i = 0; i < predicted.length; i++) {
    if (matchedPredIndices.has(i)) continue;
    perProcedure.push(evaluateProcedure(predicted[i], emptyProcedure()));
  }

  return {
    id,
    goldProcedureCount: gold.length,
    predictedProcedureCount: predicted.length,
    perProcedure,
    total: sumProcedureMetrics(perProcedure),
  };
}

function emptyProcedure(): MatProvProcedure {
  return { label: "", "@graph": [] };
}

// ── 集合構築 ──────────────────────────────────────────────

function collectActivityLabels(p: MatProvProcedure): string[] {
  const out: string[] = [];
  for (const item of p["@graph"]) {
    if (item["@type"] === "Activity") out.push(readLabel(item.label));
  }
  return out;
}

function collectEntityLabels(p: MatProvProcedure, kind: "material" | "tool"): string[] {
  const out: string[] = [];
  for (const item of p["@graph"]) {
    if (item["@type"] !== "Entity") continue;
    if (readEntityType(item) !== kind) continue;
    out.push(readLabel(item.label));
  }
  return out;
}

/**
 * Edge の比較キーは (Usage|Generation, activityLabel, entityLabel) の triple とする。
 * @id 単体は LLM ごとに振り直されるため意味を持たない。Activity / Entity の label に置換する。
 */
function collectEdgeKeys(p: MatProvProcedure): string[] {
  const entityLabelById = new Map<string, string>();
  const activityLabelById = new Map<string, string>();
  for (const item of p["@graph"]) {
    if (item["@type"] === "Entity") entityLabelById.set(item["@id"], readLabel(item.label));
    else if (item["@type"] === "Activity")
      activityLabelById.set(item["@id"], readLabel(item.label));
  }
  const out: string[] = [];
  for (const item of p["@graph"]) {
    if (item["@type"] !== "Usage" && item["@type"] !== "Generation") continue;
    const a = activityLabelById.get(item.activity) ?? item.activity;
    const e = entityLabelById.get(item.entity) ?? item.entity;
    out.push(`${item["@type"]}::${normalize(a)}::${normalize(e)}`);
  }
  return out;
}

/** parameter は (ownerLabel, paramKey, value) の triple で比較 */
function collectParameterKeys(p: MatProvProcedure): string[] {
  const out: string[] = [];
  for (const item of p["@graph"]) {
    if (item["@type"] !== "Activity" && item["@type"] !== "Entity") continue;
    const ownerLabel = readLabel(item.label);
    for (const param of readParameters(item as MatProvActivity | MatProvEntity)) {
      out.push(`${normalize(ownerLabel)}::${normalize(param.key)}::${normalize(param.value)}`);
    }
  }
  return out;
}

// ── procedure 単位の指標 ──────────────────────────────────────────────

function evaluateProcedure(pred: MatProvProcedure, gold: MatProvProcedure): ProcedureMetric {
  const acts = compareSets(collectActivityLabels(pred), collectActivityLabels(gold));
  const mats = compareSets(
    collectEntityLabels(pred, "material"),
    collectEntityLabels(gold, "material"),
  );
  const tools = compareSets(
    collectEntityLabels(pred, "tool"),
    collectEntityLabels(gold, "tool"),
  );
  const edges = compareSets(collectEdgeKeys(pred), collectEdgeKeys(gold));
  const params = compareSets(collectParameterKeys(pred), collectParameterKeys(gold));

  return {
    activities: acts,
    materials: mats,
    tools,
    edges,
    parameters: params,
    tokenF1: {
      activities: tokenF1(collectActivityLabels(pred), collectActivityLabels(gold)),
      materials: tokenF1(
        collectEntityLabels(pred, "material"),
        collectEntityLabels(gold, "material"),
      ),
      tools: tokenF1(collectEntityLabels(pred, "tool"), collectEntityLabels(gold, "tool")),
      parameters: tokenF1(collectParameterKeys(pred), collectParameterKeys(gold)),
    },
  };
}

function compareSets(predicted: string[], gold: string[]): MetricCounts {
  const predSet = new Set(predicted.map(normalize).filter(Boolean));
  const goldSet = new Set(gold.map(normalize).filter(Boolean));
  let matched = 0;
  for (const g of goldSet) if (predSet.has(g)) matched++;
  return { matched, predicted: predSet.size, gold: goldSet.size };
}

function tokenF1(predicted: string[], gold: string[]): TokenF1 {
  const predTokens = bagOfTokens(predicted);
  const goldTokens = bagOfTokens(gold);
  let overlap = 0;
  for (const [tok, count] of predTokens) {
    const g = goldTokens.get(tok) ?? 0;
    overlap += Math.min(count, g);
  }
  const predSum = sumValues(predTokens);
  const goldSum = sumValues(goldTokens);
  const precision = predSum === 0 ? 0 : overlap / predSum;
  const recall = goldSum === 0 ? 0 : overlap / goldSum;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

function bagOfTokens(labels: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const label of labels) {
    const tokens = normalize(label).split(/\s+/).filter(Boolean);
    for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
  }
  return m;
}

function sumValues(m: Map<string, number>): number {
  let s = 0;
  for (const v of m.values()) s += v;
  return s;
}

// ── procedure マッチング ──────────────────────────────────────────────

type Match = { gold: MatProvProcedure; pred: MatProvProcedure; predIndex: number };

/**
 * gold procedure と predicted procedure を greedy にマッチング。
 *
 * 1. まず gold.label と predicted.label が正規化後一致するペアを優先
 * 2. 残りは順序通り（gold[0]→pred[0]、gold[1]→pred[1] ...）でペアにする
 */
function greedyMatchProcedures(
  gold: MatProvOutput,
  pred: MatProvOutput,
): Match[] {
  const used = new Set<number>();
  const matches: Match[] = [];

  for (let gi = 0; gi < gold.length; gi++) {
    const g = gold[gi];
    const goldKey = normalize(g.label);
    let chosen = -1;
    if (goldKey) {
      for (let pi = 0; pi < pred.length; pi++) {
        if (used.has(pi)) continue;
        if (normalize(pred[pi].label) === goldKey) {
          chosen = pi;
          break;
        }
      }
    }
    if (chosen === -1) {
      for (let pi = 0; pi < pred.length; pi++) {
        if (!used.has(pi)) {
          chosen = pi;
          break;
        }
      }
    }
    if (chosen === -1) break;
    used.add(chosen);
    matches.push({ gold: g, pred: pred[chosen], predIndex: chosen });
  }

  return matches;
}

// ── normalize ──────────────────────────────────────────────

const PUNCT_REGEX = /[\p{P}\p{S}]/gu;

/**
 * label 文字列の正規化。
 * - NFKC（全角→半角等）
 * - lowercase
 * - 句読点・記号除去
 * - 連続空白を 1 個に
 * - trim
 */
export function normalize(s: string | undefined | null): string {
  if (!s) return "";
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(PUNCT_REGEX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── 集計 ──────────────────────────────────────────────

function addCounts(a: MetricCounts, b: MetricCounts): MetricCounts {
  return {
    matched: a.matched + b.matched,
    predicted: a.predicted + b.predicted,
    gold: a.gold + b.gold,
  };
}

function addTokenF1(a: TokenF1, b: TokenF1): TokenF1 {
  // 個別 procedure の F1 を単純平均ではなく、token 集計レベルで再計算するのが
  // 正しいが、Phase 5a では運用負荷を抑えるため算術平均で十分（指標の主は exact match）。
  return {
    precision: (a.precision + b.precision) / 2,
    recall: (a.recall + b.recall) / 2,
    f1: (a.f1 + b.f1) / 2,
  };
}

function sumProcedureMetrics(metrics: ProcedureMetric[]): ProcedureMetric {
  if (metrics.length === 0) {
    const zero: MetricCounts = { matched: 0, predicted: 0, gold: 0 };
    const zeroF1: TokenF1 = { precision: 0, recall: 0, f1: 0 };
    return {
      activities: zero,
      materials: zero,
      tools: zero,
      edges: zero,
      parameters: zero,
      tokenF1: {
        activities: zeroF1,
        materials: zeroF1,
        tools: zeroF1,
        parameters: zeroF1,
      },
    };
  }
  return metrics.reduce((acc, cur) => ({
    activities: addCounts(acc.activities, cur.activities),
    materials: addCounts(acc.materials, cur.materials),
    tools: addCounts(acc.tools, cur.tools),
    edges: addCounts(acc.edges, cur.edges),
    parameters: addCounts(acc.parameters, cur.parameters),
    tokenF1: {
      activities: addTokenF1(acc.tokenF1.activities, cur.tokenF1.activities),
      materials: addTokenF1(acc.tokenF1.materials, cur.tokenF1.materials),
      tools: addTokenF1(acc.tokenF1.tools, cur.tokenF1.tools),
      parameters: addTokenF1(acc.tokenF1.parameters, cur.tokenF1.parameters),
    },
  }));
}

/** precision / recall / F1 を MetricCounts から計算 */
export function prf(c: MetricCounts): { precision: number; recall: number; f1: number } {
  const precision = c.predicted === 0 ? 0 : c.matched / c.predicted;
  const recall = c.gold === 0 ? 0 : c.matched / c.gold;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

/** 複数 sample の集計 */
export function aggregate(samples: SampleMetric[]): ProcedureMetric {
  return sumProcedureMetrics(samples.map((s) => s.total));
}
