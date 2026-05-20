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

/**
 * gold ノードの label.@value から synonym list を取り出す。
 * MatPROV gold は label.@value が string か string[] のどちらか。後者は同じ実体の
 * 別名（例: ["SPEX-8000 shaker", "SPEX-8000", "shaker"]）で、評価では **どれかが
 * pred と一致すれば match** とみなす（MatPROV 論文の評価方針と整合）。
 */
function readLabelSynonyms(label: MatProvLabel | undefined): string[] {
  if (!label) return [];
  const out: string[] = [];
  for (const entry of label) {
    const raw = entry?.["@value"];
    if (typeof raw === "string") out.push(raw);
    else if (Array.isArray(raw)) {
      for (const s of raw) if (typeof s === "string") out.push(s);
    }
  }
  return out;
}

// ── 比較集合 ──────────────────────────────
//
// pred 側は LLM が「1 概念につき 1 ラベル」を出すので flat string array。
// gold 側は MatPROV のラベルが synonym list を持つ（例: SPEX-8000 shaker | SPEX-8000 |
// shaker）ので、各エントリは synonym 群として保持し、いずれかが match すれば
// match とみなす（MatPROV 論文の評価方針と整合）。

export type SpanSets = {
  activities: string[];
  materials: string[];
  tools: string[];
  /** "Usage::<activity-label>::<entity-label>" or "Generation::..." */
  edges: string[];
  /** "<canonical-key>::<value>" */
  parameters: string[];
};

export type GoldSynonymEntry = { synonyms: string[] };
export type GoldEdgeEntry = {
  type: "Usage" | "Generation";
  activitySyns: string[];
  entitySyns: string[];
};
export type GoldParamEntry = { canonicalKey: string; valueSyns: string[] };

export type GoldSpanSets = {
  activities: GoldSynonymEntry[];
  materials: GoldSynonymEntry[];
  tools: GoldSynonymEntry[];
  edges: GoldEdgeEntry[];
  parameters: GoldParamEntry[];
};

function emptySets(): SpanSets {
  return { activities: [], materials: [], tools: [], edges: [], parameters: [] };
}

function emptyGoldSets(): GoldSpanSets {
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

function mergeGoldSets(a: GoldSpanSets, b: GoldSpanSets): GoldSpanSets {
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

/** "key: value" の attribute span をパース。`:` が無いときは bare value として表記から key を推定する */
function parseAttributeSpan(text: string): { key: string; value: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const idx = trimmed.indexOf(":");
  if (idx > 0) {
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (key && value) return { key, value };
  }
  const inferred = inferBareValueKey(trimmed);
  if (inferred) return inferred;
  return null;
}

const FORM_KEYWORDS = new Set([
  "shot",
  "shots",
  "piece",
  "pieces",
  "powder",
  "powders",
  "pellet",
  "pellets",
  "ingot",
  "ingots",
  "foil",
  "foils",
  "chip",
  "chips",
  "slice",
  "slices",
  "rod",
  "rods",
  "granule",
  "granules",
  "flake",
  "flakes",
  "wire",
  "crystal",
  "crystals",
]);

const ATMOSPHERE_KEYWORDS = new Set([
  "vacuum",
  "air",
  "argon",
  "ar",
  "nitrogen",
  "n2",
  "helium",
  "he",
  "oxygen",
  "o2",
  "hydrogen",
  "h2",
]);

const ATMOSPHERE_PHRASE_REGEX = /^(?:under|in|in an?|in the)\s+(.+?)(?:\s+atmosphere)?$/i;

/** key が省略された attribute span から canonical key を推定する */
function inferBareValueKey(text: string): { key: string; value: string } | null {
  const lower = text.toLowerCase().trim();
  if (!lower) return null;
  // "99.999 %", "99%" — percentage → purity
  if (/^\d+(?:\.\d+)?\s*%$/.test(lower)) {
    return { key: "purity", value: text };
  }
  // form descriptor 単独
  if (FORM_KEYWORDS.has(lower)) return { key: "form", value: text };
  // atmosphere keyword 単独
  if (ATMOSPHERE_KEYWORDS.has(lower)) return { key: "atmosphere", value: text };
  // "under vacuum", "in argon", "in an inert atmosphere of argon"
  const atmosMatch = lower.match(ATMOSPHERE_PHRASE_REGEX);
  if (atmosMatch) {
    const tail = atmosMatch[1].trim();
    if (ATMOSPHERE_KEYWORDS.has(tail) || tail.endsWith(" atmosphere")) {
      const value = tail.replace(/\s+atmosphere$/, "").trim();
      if (ATMOSPHERE_KEYWORDS.has(value)) {
        return { key: "atmosphere", value };
      }
    }
  }
  return null;
}

// ── MatProvProcedure[] → GoldSpanSets ──────────────────────────────

export function extractSetsFromGold(procedures: MatProvOutput): GoldSpanSets {
  let acc = emptyGoldSets();
  for (const proc of procedures) {
    acc = mergeGoldSets(acc, extractSetsFromGoldProcedure(proc));
  }
  return acc;
}

function extractSetsFromGoldProcedure(proc: MatProvProcedure): GoldSpanSets {
  const sets = emptyGoldSets();
  const entitySynsById = new Map<string, string[]>();
  const activitySynsById = new Map<string, string[]>();
  const entityTypeById = new Map<string, "material" | "tool" | null>();

  for (const item of proc["@graph"]) {
    if (item["@type"] === "Entity") {
      entitySynsById.set(item["@id"], readLabelSynonyms(item.label));
      const t = readValueEntry(item.type?.[0]);
      entityTypeById.set(item["@id"], t === "material" || t === "tool" ? t : null);
    } else if (item["@type"] === "Activity") {
      activitySynsById.set(item["@id"], readLabelSynonyms(item.label));
    }
  }

  for (const item of proc["@graph"]) {
    if (item["@type"] === "Activity") {
      const syns = readLabelSynonyms(item.label);
      if (syns.length > 0) sets.activities.push({ synonyms: syns });
      for (const p of readMatprovParamSynonyms(item)) {
        sets.parameters.push({ canonicalKey: canonicalKey(p.key), valueSyns: p.syns });
      }
    } else if (item["@type"] === "Entity") {
      const syns = entitySynsById.get(item["@id"]) ?? [];
      const t = entityTypeById.get(item["@id"]);
      if (syns.length > 0) {
        if (t === "material") sets.materials.push({ synonyms: syns });
        else if (t === "tool") sets.tools.push({ synonyms: syns });
      }
      for (const p of readMatprovParamSynonyms(item)) {
        sets.parameters.push({ canonicalKey: canonicalKey(p.key), valueSyns: p.syns });
      }
    } else if (item["@type"] === "Usage" || item["@type"] === "Generation") {
      const activitySyns = activitySynsById.get(item.activity) ?? [item.activity];
      const entitySyns = entitySynsById.get(item.entity) ?? [item.entity];
      sets.edges.push({ type: item["@type"], activitySyns, entitySyns });
    }
  }

  return sets;
}

/** matprov:* の配列内に複数 @value がある場合、全部 synonym として収集 */
function readMatprovParamSynonyms(
  node: MatProvActivity | MatProvEntity,
): Array<{ key: string; syns: string[] }> {
  const out: Array<{ key: string; syns: string[] }> = [];
  for (const k of Object.keys(node)) {
    if (!k.startsWith("matprov:")) continue;
    const arr = (node as Record<string, unknown>)[k];
    if (!Array.isArray(arr)) continue;
    const syns: string[] = [];
    for (const entry of arr) {
      const v = (entry as MatProvValue | undefined)?.["@value"];
      if (typeof v === "string") syns.push(v);
      else if (Array.isArray(v)) for (const s of v) if (typeof s === "string") syns.push(s);
    }
    if (syns.length > 0) out.push({ key: k.slice("matprov:".length), syns });
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

function compareSets(pred: SpanSets, gold: GoldSpanSets): ProcedureMetric {
  return {
    activities: matchSynonymEntries(pred.activities, gold.activities, headGerund),
    materials: matchSynonymEntries(pred.materials, gold.materials, canonicalMaterial),
    tools: matchSynonymEntries(pred.tools, gold.tools, normalize),
    edges: matchEdges(pred.edges, gold.edges),
    parameters: matchParameters(pred.parameters, gold.parameters),
    tokenF1: {
      activities: tokenF1(pred.activities, flattenSynonyms(gold.activities)),
      materials: tokenF1(pred.materials, flattenSynonyms(gold.materials)),
      tools: tokenF1(pred.tools, flattenSynonyms(gold.tools)),
      parameters: tokenF1(
        pred.parameters,
        gold.parameters
          .filter((p) => p.valueSyns[0])
          .map((p) => `${p.canonicalKey}::${p.valueSyns[0]}`),
      ),
    },
  };
}

function flattenSynonyms(entries: GoldSynonymEntry[]): string[] {
  // token-F1 では 1 エンティティ 1 ラベル相当の token bag を作りたいので、primary synonym だけ取る
  return entries.map((e) => e.synonyms[0]).filter((s): s is string => Boolean(s));
}

/**
 * synonym-aware の集合比較。gold 各エントリは synonym list を持ち、いずれかが
 * pred と一致すれば match。
 *
 * gold 側の dedup: 同じ primary label を持つエントリ（例: "Cu" が複数 Entity として
 * 別 procedure に登場するケース）は 1 つに集約。LLM 出力は flat list で同一 label を
 * 1 度しか出さないため、これを別カウントすると recall が不当に下がる。
 *
 * pred 側の dedup: normalized 文字列の集合化。
 */
function matchSynonymEntries(
  predicted: string[],
  gold: GoldSynonymEntry[],
  normFn: (s: string) => string,
): MetricCounts {
  const predNorm = new Set(predicted.map(normFn).filter(Boolean));

  // gold dedup: 先頭 synonym（primary）を normalize した文字列をキーに集約。
  // 同一 primary に複数エントリがあるときは synonym list が最も多いものを採用（最も permissive）。
  const uniqueGold = new Map<string, string[]>();
  for (const g of gold) {
    const norms = g.synonyms.map(normFn).filter(Boolean);
    if (norms.length === 0) continue;
    const primary = norms[0];
    const existing = uniqueGold.get(primary);
    if (!existing || norms.length > existing.length) {
      uniqueGold.set(primary, norms);
    }
  }

  const predUsed = new Set<string>();
  let matched = 0;
  for (const syns of uniqueGold.values()) {
    for (const s of syns) {
      if (predNorm.has(s) && !predUsed.has(s)) {
        predUsed.add(s);
        matched++;
        break;
      }
    }
  }
  return { matched, predicted: predNorm.size, gold: uniqueGold.size };
}

/**
 * Edge matching。pred edge は serialized string、gold edge は (activitySyns, entitySyns)
 * の組。pred と gold の全 (activity, entity) synonym 組合せから edge key を作って match。
 */
function matchEdges(predicted: string[], gold: GoldEdgeEntry[]): MetricCounts {
  const predSet = new Set(predicted.filter(Boolean));

  // gold edge dedup: 先頭 synonym で作った primary edge key で集約。
  const uniqueGold = new Map<string, GoldEdgeEntry>();
  for (const ge of gold) {
    if (ge.activitySyns.length === 0 || ge.entitySyns.length === 0) continue;
    const primaryKey = `${ge.type}::${headGerund(ge.activitySyns[0])}::${canonicalMaterial(ge.entitySyns[0])}`;
    if (!uniqueGold.has(primaryKey)) uniqueGold.set(primaryKey, ge);
  }

  const predUsed = new Set<string>();
  let matched = 0;
  for (const ge of uniqueGold.values()) {
    let found = false;
    for (const a of ge.activitySyns) {
      if (found) break;
      for (const e of ge.entitySyns) {
        const key = `${ge.type}::${headGerund(a)}::${canonicalMaterial(e)}`;
        if (predSet.has(key) && !predUsed.has(key)) {
          predUsed.add(key);
          matched++;
          found = true;
          break;
        }
      }
    }
  }
  return { matched, predicted: predSet.size, gold: uniqueGold.size };
}

/**
 * Parameter matching。pred の "canonicalKey::normalizedValue" と gold の同じキーの
 * synonym 全候補を比較。Value 側で min↔minute / h↔hour 等の synonym 展開も行う。
 */
function matchParameters(predicted: string[], gold: GoldParamEntry[]): MetricCounts {
  const predSet = new Set(predicted.filter(Boolean));

  // gold parameter dedup: (canonicalKey, normalized first value) で集約。
  // 同じ (purity, 99.999%) が複数 Entity に紐づくケース（Cu の purity と Fe の purity が
  // 同じ 99.999% のような場合）を 1 つにまとめる。LLM 出力は flat list で entity binding を
  // 持たないため、別カウントすると recall が不当に下がる。
  const uniqueGold = new Map<string, GoldParamEntry>();
  for (const gp of gold) {
    if (gp.valueSyns.length === 0) continue;
    const primaryKey = `${gp.canonicalKey}::${normalize(gp.valueSyns[0])}`;
    if (!uniqueGold.has(primaryKey)) uniqueGold.set(primaryKey, gp);
  }

  const predUsed = new Set<string>();
  let matched = 0;
  for (const gp of uniqueGold.values()) {
    let found = false;
    for (const raw of gp.valueSyns) {
      if (found) break;
      const candidates = expandValueSynonyms(normalize(raw)).map(
        (v) => `${gp.canonicalKey}::${v}`,
      );
      for (const key of candidates) {
        if (predSet.has(key) && !predUsed.has(key)) {
          predUsed.add(key);
          matched++;
          found = true;
          break;
        }
      }
    }
  }
  return { matched, predicted: predSet.size, gold: uniqueGold.size };
}

/**
 * normalize 済み value 文字列に対し、時間単位の表記揺れを展開する。
 * 例: "1 4 min" → ["1 4 min", "1 4 minute"]、"6 h" → ["6 h", "6 hour"]
 *
 * 数値の直後に置かれる time-unit token のみ展開する（誤展開を避けるため、
 * 単独で "h" や "s" が出てくる材料ラベル等には影響しない）。
 */
const TIME_UNIT_MAP: Record<string, string> = {
  s: "second",
  sec: "second",
  m: "minute", // bare "m" は時々観測される（minute の略）
  min: "minute",
  mins: "minute",
  h: "hour",
  hr: "hour",
  hrs: "hour",
  d: "day",
};
function expandValueSynonyms(value: string): string[] {
  const out = new Set<string>([value]);
  const tokens = value.split(" ");
  // 末尾 token が time-unit synonym ならその expanded を加える
  if (tokens.length >= 2) {
    const last = tokens[tokens.length - 1];
    const prev = tokens[tokens.length - 2];
    const isNumber = /^\d+(?:\.\d+)?$/.test(prev);
    if (isNumber && Object.prototype.hasOwnProperty.call(TIME_UNIT_MAP, last)) {
      const expanded = [...tokens.slice(0, -1), TIME_UNIT_MAP[last]].join(" ");
      out.add(expanded);
    }
    // 逆方向: gold が "6 hour" / pred が "6 h" の場合も拾う
    for (const [abbr, full] of Object.entries(TIME_UNIT_MAP)) {
      if (last === full && isNumber) {
        out.add([...tokens.slice(0, -1), abbr].join(" "));
      }
    }
  }
  return Array.from(out);
}

/**
 * Activity 文字列から先頭の gerund verb（または "spark plasma sintering" のような複合
 * gerund 名）を取り出し、normalize した形を返す。
 *
 * - 単独 token が "-ing" で終わる → 採用
 * - 先頭 token が "-ing" で、次の token も "-ing" or 形容詞っぽい複合語（spark plasma
 *   sintering 等）の場合は連結を維持
 * - 単純化: 先頭から連続する gerund 風 token と「ハイフン語」を吸収
 */
function headGerund(activity: string): string {
  const norm = normalize(activity);
  if (!norm) return "";
  const tokens = norm.split(" ").filter(Boolean);
  if (tokens.length === 0) return "";
  // 単純な末尾 gerund 拾い: 末尾が gerund っぽい token を含むまでを採用
  const idx = tokens.findIndex((t) => t.endsWith("ing"));
  if (idx === -1) return tokens[0];
  return tokens.slice(0, idx + 1).join(" ");
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
//
// 主指標は exact match だが、自然語の表記揺れ（括弧内の補足、単複差、定冠詞）まで
// 落とすために以下の前処理を入れる:
//   1. 括弧内補足を除去  "spark plasma sintering (Sumitomo SPS-2040)" → "spark plasma sintering"
//   2. 定冠詞除去        "the sealed sample" → "sealed sample"
//   3. NFKC + lowercase + 句読点・記号除去 + 空白集約
//   4. 単複の素朴な正規化（末尾 s / es / ies → 削除）— 名詞語尾の典型ケースのみ
//
// 単複正規化は完全ではない（"glass" → "glas" のような誤マッチが理論上発生する）が、
// "crucibles" vs "crucible" のような頻出ノイズを潰す効果が大きい。token 単位で適用する。

const PUNCT_REGEX = /[\p{P}\p{S}]/gu;
const PAREN_CONTENT_REGEX = /\s*[\(（][^\)）]*[\)）]\s*/g;
const LEADING_ARTICLE_REGEX = /^(the|a|an)\s+/;

export function normalize(s: string | undefined | null): string {
  if (!s) return "";
  const stripped = s
    .normalize("NFKC")
    .replace(PAREN_CONTENT_REGEX, " ")
    .toLowerCase()
    .replace(PUNCT_REGEX, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return "";
  const noArticle = stripped.replace(LEADING_ARTICLE_REGEX, "");
  return noArticle.split(" ").map(stemPlural).join(" ");
}

/** 末尾の単複を素朴に揃える（ies → y、es → 削除、s → 削除）。3 文字未満の token は触らない */
function stemPlural(token: string): string {
  if (token.length < 4) return token;
  if (token.endsWith("ies")) return token.slice(0, -3) + "y";
  if (token.endsWith("ses") || token.endsWith("xes") || token.endsWith("zes") || token.endsWith("ches") || token.endsWith("shes")) {
    return token.slice(0, -2);
  }
  if (token.endsWith("s") && !token.endsWith("ss") && !token.endsWith("us")) {
    return token.slice(0, -1);
  }
  return token;
}

// 中間生成物として使われる form-noun の集合。`<past-participle> <form-noun>` の組み合わせは
// 同じ過去分詞を共有する `<past-participle> sample`（gold の慣用形式）と等価に扱う。
// list は普遍的な「容器」「形状」「物質状態」語彙のみで、ドメイン固有語（"alloy" 等）は含めない。
const INTERMEDIATE_FORM_NOUNS = new Set([
  "sample",
  "ingot",
  "powder",
  "pellet",
  "foil",
  "piece",
  "crystal",
  "chip",
  "granule",
  "flake",
  "slice",
  "block",
  "mixture",
  "solution",
  "precipitate",
  "slurry",
  "paste",
  "compound",
  "product",
  "material",
  "particle",
  "particles",
  "grain",
  "rod",
  "bar",
  "sheet",
  "fiber",
  "film",
]);

const PARTICIPLE_FORM_REGEX = /^([a-z]+ed)\s+([a-z]+)$/;

/**
 * material span を canonical 形に揃える。
 * `<past-participle> <form-noun>` パターンは `<past-participle> sample` に正規化する
 * （例: "annealed ingot" → "annealed sample"、"crushed powder" → "crushed sample"）。
 * 該当しない（"olive oil", "MnSO4", "Cu" など）は normalize の結果をそのまま返す。
 */
export function canonicalMaterial(text: string): string {
  const norm = normalize(text);
  const m = norm.match(PARTICIPLE_FORM_REGEX);
  if (m && INTERMEDIATE_FORM_NOUNS.has(m[2])) {
    return `${m[1]} sample`;
  }
  return norm;
}

function edgeKey(type: "Usage" | "Generation", activity: string, entity: string): string {
  // edge の比較で activity / entity の表記揺れを吸収するため:
  //   - activity 側: headGerund で gerund 抽出
  //   - entity 側: canonicalMaterial で `<past-participle> <form-noun>` を sample 形に
  return `${type}::${headGerund(activity)}::${canonicalMaterial(entity)}`;
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
