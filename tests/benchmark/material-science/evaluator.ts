// Material-science benchmark の評価層（v1.2 §10）。
//
// 比較は **Graphium 抽出出力（ProvIngesterOutput, prose+spans）** と
// **MatPROV gold standard（@graph 形式 JSON）** を双方とも下記 5 集合に正規化してから行う:
//   - Activities: H2 procedure heading の label / Activity の label
//   - Materials:  inline material/output span / Entity (type=material) の label
//   - Tools:      inline tool span / Entity (type=tool) の label
//   - Edges:      (Usage|Generation, activity-label, entity-label) の triple
//   - Parameters: (canonical-key, value) の pair
//
// Parameter key は synonym map（§10）で canonical 形に正規化してから比較する。
// material と output は gold 側では区別されない（Generation target も type=material）ため、
// predicted の material + output を合算して gold の material と比較する。
//
// LLM の出力ゆれを吸収する仕組み:
//   - 主指標: 正規化（NFKC + lowercase + 句読点除去 + 空白集約）後の exact match → P/R/F1
//   - 副指標: 空白 split token の bag F1
//
// 複数 procedure を含む gold は flatten して 1 大集合として比較する。現行 prompt は
// 1 抽出 = 1 ProvIngesterOutput を返すため、predicted 側も常に 1 出力（=1 集合）。
// 将来 procedureGroup ベースで複数 ProvIngesterOutput を返すようになれば、配列を
// flatten して比較する。

import type {
  ProvIngesterBlock,
  ProvIngesterOutput,
  ProvSpan,
} from "../../../src/server/services/prov-ingester";

// ── MatPROV gold standard の最小型 ──────────────────────────────
// LLM 出力ではなく gold JSON ファイル読み込み専用なので、軽量に定義する。

type MatProvValue = { "@value": string | string[]; "@language"?: string; "@type"?: string };
type MatProvLabel = MatProvValue[];

type MatProvEntity = {
  "@type": "Entity";
  "@id": string;
  label?: MatProvLabel;
  type?: MatProvValue[];
  [paramKey: string]: unknown;
};

type MatProvActivity = {
  "@type": "Activity";
  "@id": string;
  label?: MatProvLabel;
  [paramKey: string]: unknown;
};

type MatProvEdge = {
  "@type": "Usage" | "Generation";
  activity: string;
  entity: string;
};

type MatProvGraphItem = MatProvEntity | MatProvActivity | MatProvEdge;

export type MatProvProcedure = { label: string; "@graph": MatProvGraphItem[] };
export type MatProvOutput = MatProvProcedure[];

function readValueEntry(v: MatProvValue | undefined): string {
  if (!v) return "";
  const raw = v["@value"];
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
  return "";
}

function readLabel(label: MatProvLabel | undefined): string {
  return readValueEntry(label?.[0]);
}

// ── 比較集合 ──────────────────────────────

export type SpanSets = {
  activities: string[];
  materials: string[];
  tools: string[];
  /** "Usage::<activity-label>::<entity-label>" or "Generation::..." */
  edges: string[];
  /** "<canonical-key>::<value>" */
  parameters: string[];
};

function emptySets(): SpanSets {
  return { activities: [], materials: [], tools: [], edges: [], parameters: [] };
}

function mergeSets(a: SpanSets, b: SpanSets): SpanSets {
  return {
    activities: a.activities.concat(b.activities),
    materials: a.materials.concat(b.materials),
    tools: a.tools.concat(b.tools),
    edges: a.edges.concat(b.edges),
    parameters: a.parameters.concat(b.parameters),
  };
}

// ── ProvIngesterOutput → SpanSets ──────────────────────────────

export function extractSetsFromOutput(output: ProvIngesterOutput): SpanSets {
  const sets = emptySets();
  let currentActivity: string | null = null;

  const walk = (blocks: ProvIngesterBlock[]): void => {
    for (const block of blocks) {
      const isProcedureHeading =
        block.blockType === "heading" && block.role === "procedure";

      if (isProcedureHeading) {
        const label = (block.text ?? "").trim();
        if (label) {
          sets.activities.push(label);
          currentActivity = label;
        }
      }

      const spans: ProvSpan[] = block.content ?? [];
      for (const span of spans) {
        if (!span.text || !span.role) continue;
        if (span.role === "material") {
          sets.materials.push(span.text);
          if (currentActivity) {
            sets.edges.push(edgeKey("Usage", currentActivity, span.text));
          }
        } else if (span.role === "tool") {
          sets.tools.push(span.text);
          if (currentActivity) {
            sets.edges.push(edgeKey("Usage", currentActivity, span.text));
          }
        } else if (span.role === "output") {
          // gold では Generation target も type=material として扱われるので、
          // 比較の便宜上、output span は material に合算する。
          sets.materials.push(span.text);
          if (currentActivity) {
            sets.edges.push(edgeKey("Generation", currentActivity, span.text));
          }
        } else if (span.role === "attribute") {
          const parsed = parseAttributeSpan(span.text);
          if (parsed) {
            sets.parameters.push(`${canonicalKey(parsed.key)}::${normalize(parsed.value)}`);
          }
        }
      }

      if (block.children && block.children.length > 0) walk(block.children);
    }
  };

  walk(output.blocks);
  return sets;
}

/** "key: value" の attribute span をパース。`:` を含まない span は parameter から外す */
function parseAttributeSpan(text: string): { key: string; value: string } | null {
  const idx = text.indexOf(":");
  if (idx <= 0) return null;
  const key = text.slice(0, idx).trim();
  const value = text.slice(idx + 1).trim();
  if (!key || !value) return null;
  return { key, value };
}

// ── MatProvProcedure[] → SpanSets ──────────────────────────────

export function extractSetsFromGold(procedures: MatProvOutput): SpanSets {
  let acc = emptySets();
  for (const proc of procedures) {
    acc = mergeSets(acc, extractSetsFromGoldProcedure(proc));
  }
  return acc;
}

function extractSetsFromGoldProcedure(proc: MatProvProcedure): SpanSets {
  const sets = emptySets();
  const entityLabelById = new Map<string, string>();
  const activityLabelById = new Map<string, string>();
  const entityTypeById = new Map<string, "material" | "tool" | null>();

  for (const item of proc["@graph"]) {
    if (item["@type"] === "Entity") {
      entityLabelById.set(item["@id"], readLabel(item.label));
      const t = readValueEntry(item.type?.[0]);
      entityTypeById.set(item["@id"], t === "material" || t === "tool" ? t : null);
    } else if (item["@type"] === "Activity") {
      activityLabelById.set(item["@id"], readLabel(item.label));
    }
  }

  for (const item of proc["@graph"]) {
    if (item["@type"] === "Activity") {
      const label = readLabel(item.label);
      if (label) sets.activities.push(label);
      for (const p of readMatprovParams(item)) {
        sets.parameters.push(`${canonicalKey(p.key)}::${normalize(p.value)}`);
      }
    } else if (item["@type"] === "Entity") {
      const label = readLabel(item.label);
      const t = entityTypeById.get(item["@id"]);
      if (label) {
        if (t === "material") sets.materials.push(label);
        else if (t === "tool") sets.tools.push(label);
      }
      for (const p of readMatprovParams(item)) {
        sets.parameters.push(`${canonicalKey(p.key)}::${normalize(p.value)}`);
      }
    } else if (item["@type"] === "Usage" || item["@type"] === "Generation") {
      const a = activityLabelById.get(item.activity) ?? item.activity;
      const e = entityLabelById.get(item.entity) ?? item.entity;
      sets.edges.push(edgeKey(item["@type"], a, e));
    }
  }

  return sets;
}

function readMatprovParams(
  node: MatProvActivity | MatProvEntity,
): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  for (const k of Object.keys(node)) {
    if (!k.startsWith("matprov:")) continue;
    const arr = (node as Record<string, unknown>)[k];
    if (!Array.isArray(arr)) continue;
    const v = readValueEntry(arr[0] as MatProvValue | undefined);
    if (v) out.push({ key: k.slice("matprov:".length), value: v });
  }
  return out;
}

// ── Synonym map（v1.2 §10）──────────────────────────────
// MatPROV の 10 種 key + よく観測される表記揺れを canonical 形にマップする。
// 観測されない値も将来の同義語追加に備えて配列で受ける。

const KEY_SYNONYMS: Record<string, string[]> = {
  temperature: ["temperature", "temp", "t"],
  duration: [
    "duration",
    "time",
    "elapsed_time",
    "annealing_time",
    "holding_time",
    "reaction_time",
    "incubation_time",
  ],
  pressure: ["pressure", "press", "p"],
  mass: ["mass", "weight", "amount"],
  length: ["length", "size", "dimension"],
  purity: ["purity", "grade"],
  concentration: ["concentration", "conc", "molarity"],
  rotation: ["rotation", "speed", "rpm", "rotational_speed"],
  atmosphere: ["atmosphere", "gas", "ambient"],
  form: ["form", "shape", "morphology", "state"],
};

// MatPROV modifier の後置形（_start / _end / _rate / _width / _height / _thickness / _diameter）
const MATPROV_MODIFIERS = ["_start", "_end", "_rate", "_width", "_height", "_thickness", "_diameter"];

const SYNONYM_TO_CANONICAL = new Map<string, string>();
for (const [canon, syns] of Object.entries(KEY_SYNONYMS)) {
  for (const s of syns) {
    SYNONYM_TO_CANONICAL.set(normalizeKeyToken(s), canon);
    for (const mod of MATPROV_MODIFIERS) {
      SYNONYM_TO_CANONICAL.set(normalizeKeyToken(s + mod), canon + mod);
    }
  }
}

function normalizeKeyToken(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

/** parameter key を canonical 形に正規化（synonym で見つかればマップ、見つからなければ snake_case 正規化のみ） */
export function canonicalKey(rawKey: string): string {
  const norm = normalizeKeyToken(rawKey);
  return SYNONYM_TO_CANONICAL.get(norm) ?? norm;
}

// ── 集合比較（exact match + token F1）──────────────────────────────

export type MetricCounts = {
  matched: number;
  predicted: number;
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
  tokenF1: {
    activities: TokenF1;
    materials: TokenF1;
    tools: TokenF1;
    parameters: TokenF1;
  };
};

export type SampleMetric = {
  id: string;
  goldProcedureCount: number;
  /** open-set output は当面常に 1（procedureGroup 拡張時に増える） */
  predictedProcedureCount: number;
  total: ProcedureMetric;
};

export function evaluateSample(
  id: string,
  predictedOutputs: ProvIngesterOutput[],
  gold: MatProvOutput,
): SampleMetric {
  const predSets = predictedOutputs
    .map((o) => extractSetsFromOutput(o))
    .reduce((acc, cur) => mergeSets(acc, cur), emptySets());
  const goldSets = extractSetsFromGold(gold);

  return {
    id,
    goldProcedureCount: gold.length,
    predictedProcedureCount: predictedOutputs.length,
    total: compareSets(predSets, goldSets),
  };
}

function compareSets(pred: SpanSets, gold: SpanSets): ProcedureMetric {
  return {
    activities: countOverlap(pred.activities, gold.activities),
    materials: countOverlap(pred.materials, gold.materials),
    tools: countOverlap(pred.tools, gold.tools),
    edges: countOverlap(pred.edges, gold.edges, /*alreadyNormalized*/ true),
    parameters: countOverlap(pred.parameters, gold.parameters, /*alreadyNormalized*/ true),
    tokenF1: {
      activities: tokenF1(pred.activities, gold.activities),
      materials: tokenF1(pred.materials, gold.materials),
      tools: tokenF1(pred.tools, gold.tools),
      parameters: tokenF1(pred.parameters, gold.parameters),
    },
  };
}

function countOverlap(predicted: string[], gold: string[], alreadyNormalized = false): MetricCounts {
  const predSet = new Set(
    predicted
      .map((s) => (alreadyNormalized ? s : normalize(s)))
      .filter(Boolean),
  );
  const goldSet = new Set(
    gold.map((s) => (alreadyNormalized ? s : normalize(s))).filter(Boolean),
  );
  let matched = 0;
  for (const g of goldSet) if (predSet.has(g)) matched++;
  return { matched, predicted: predSet.size, gold: goldSet.size };
}

function tokenF1(predicted: string[], gold: string[]): TokenF1 {
  const predBag = bagOfTokens(predicted);
  const goldBag = bagOfTokens(gold);
  let overlap = 0;
  for (const [tok, count] of predBag) {
    const g = goldBag.get(tok) ?? 0;
    overlap += Math.min(count, g);
  }
  const predSum = sumValues(predBag);
  const goldSum = sumValues(goldBag);
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

// ── normalize ──────────────────────────────

const PUNCT_REGEX = /[\p{P}\p{S}]/gu;

export function normalize(s: string | undefined | null): string {
  if (!s) return "";
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(PUNCT_REGEX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function edgeKey(type: "Usage" | "Generation", activity: string, entity: string): string {
  return `${type}::${normalize(activity)}::${normalize(entity)}`;
}

// ── 集計 / helpers ──────────────────────────────

export function prf(c: MetricCounts): { precision: number; recall: number; f1: number } {
  const precision = c.predicted === 0 ? 0 : c.matched / c.predicted;
  const recall = c.gold === 0 ? 0 : c.matched / c.gold;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

function addCounts(a: MetricCounts, b: MetricCounts): MetricCounts {
  return {
    matched: a.matched + b.matched,
    predicted: a.predicted + b.predicted,
    gold: a.gold + b.gold,
  };
}

function addTokenF1(a: TokenF1, b: TokenF1): TokenF1 {
  return {
    precision: (a.precision + b.precision) / 2,
    recall: (a.recall + b.recall) / 2,
    f1: (a.f1 + b.f1) / 2,
  };
}

export function aggregate(samples: SampleMetric[]): ProcedureMetric {
  if (samples.length === 0) {
    const zero: MetricCounts = { matched: 0, predicted: 0, gold: 0 };
    const zeroF1: TokenF1 = { precision: 0, recall: 0, f1: 0 };
    return {
      activities: zero,
      materials: zero,
      tools: zero,
      edges: zero,
      parameters: zero,
      tokenF1: { activities: zeroF1, materials: zeroF1, tools: zeroF1, parameters: zeroF1 },
    };
  }
  return samples
    .map((s) => s.total)
    .reduce((acc, cur) => ({
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
