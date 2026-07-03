// Phase μ-1: bench パイプライン
//
// 2 つのモードをサポート:
//   1. live: 実 LLM (gpt-oss-120b on Sakura AI Engine 等) で wiki-ingester /
//      atomizer を呼び出す。BENCH_API_KEY または SAKURA_AI_API_KEY が必要。
//   2. dry-run: heuristic ベースの deterministic 出力。API key 不要で CI / scaffolding 用。
//
// dry-run はあくまで baseline 確立と CI 動作の保証用。実 phase 採否の判断には
// live mode が必須（spec §5 の merge 判断ルール参照）。
//
// 2026-05-27: 自動 Synthesis 生成パイプラインを撤退（design revision）。
// ingester / atomizer の 2-stage 構成に縮小。
// 旧 3-stage の合成ステージは production コード側の services 撤退に追随して削除済み。

import type {
  BenchAtom,
  BenchClaim,
  BenchMetaAtom,
  BenchPipelineOutput,
  CorpusNote,
} from "./types.ts";
import { getBenchModelConfig } from "./config.ts";

const SPECULATION_MARKERS = [
  "もしかして",
  "かもしれない",
  "かもしれません",
  "かもしれない",
  "気がする",
  "じゃないかな",
  "じゃないか",
  "じゃないでしょうか",
  "なのかな",
  "なのかも",
  "推測",
  "思いつき",
  "直感",
  "確証はない",
  "データは取っていない",
];

const OBSERVATION_HINTS = [
  "[Output]",
  "[Step]",
  "測った",
  "測定した",
  "計測",
  "観察",
  "記録",
  "観測",
  "見た",
];

const ESTABLISHED_HINTS = [
  "教科書",
  "文献",
  "established",
  "知られている",
  "標準的",
];

const MECHANISM_HINTS = [
  "機構",
  "機序",
  "原理",
  "メカニズム",
  "理論",
  "律速",
  "副交感",
];

const REBUTTAL_MARKERS = [
  "ただし",
  "ただし、",
  "ただし ",
  "の場合は",
  "を超える場合",
  "場合に限",
  "場合に限る",
  "前提",
  "境界",
  "を超えると",
];

function detectEpistemicStatus(text: string): string {
  if (SPECULATION_MARKERS.some((m) => text.includes(m))) return "speculation";
  if (ESTABLISHED_HINTS.some((m) => text.includes(m))) return "established";
  if (OBSERVATION_HINTS.some((m) => text.includes(m))) {
    if (MECHANISM_HINTS.some((m) => text.includes(m))) return "interpretation";
    return "observation";
  }
  return "interpretation";
}

function detectClaimRoles(text: string): string[] {
  const roles = new Set<string>();
  if (/もしかして|\?|？|なのかな|だろうか/.test(text)) roles.add("question");
  if (/\[Output\]|結果|得られた|測った|観察|計測/.test(text)) roles.add("finding");
  if (/決めた|決定|採用|選んだ|選択|判断|に揃えた|を選ぶ/.test(text)) roles.add("decision");
  if (/と考えられる|だと考えら|機構|機序|解釈|理由|因/.test(text)) roles.add("interpretation");
  if (roles.size === 0) roles.add("interpretation");
  return Array.from(roles);
}

function extractRebuttalConditions(text: string): string[] {
  const sentences = text.split(/[\n。]/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const s of sentences) {
    if (REBUTTAL_MARKERS.some((m) => s.includes(m))) {
      out.push(s.slice(0, 120));
    }
  }
  // 重複除去
  return Array.from(new Set(out));
}

function detectModalQualifier(text: string): string | undefined {
  if (/必ず|必然/.test(text)) return "necessarily";
  if (/おそらく|だいたい|ほぼ/.test(text)) return "probably";
  if (/かもしれない|かもしれません|もしかして|可能性がある/.test(text)) return "possibly";
  if (/まれに|ごく一部/.test(text)) return "rarely";
  return undefined;
}

/**
 * Toulmin Backing の heuristic 検出（Phase γ-follow-up）。
 * 本来は live LLM の出力を使うが、dry-run pipeline / probe evaluator のために最低限の
 * 検出を入れる。idiom が一致したら 1 件以上の backing として扱う。
 *
 * カバーする idiom（Ingester プロンプトと同じ集合）:
 * - JP: 「〜理論から」「〜原理から」「教科書では」「定石として」「established な」
 * - EN: "matches X" / "textbook story" / "the standard X" / "as X formalized" /
 *       "established interpretation" / "well-known" / "published [literature/result]"
 */
function detectBacking(text: string): { source: string; citation: string }[] {
  const out: { source: string; citation: string }[] = [];
  // textbook 系
  const textbookIdioms = [
    /教科書では?[^\n。]{0,80}/,
    /定石として[^\n。]{0,80}/,
    /[一-龠ぁ-んァ-ヶa-zA-Z]+理論[^\n。]{0,30}から[^\n。]{0,80}/,
    /[一-龠ぁ-んァ-ヶa-zA-Z]+原理[^\n。]{0,30}から[^\n。]{0,80}/,
    /\b(?:the\s+)?textbook[^.\n]{0,100}\bstory\b[^.\n]{0,80}/i,
    /\bthe\s+standard\s+[^.\n]{0,80}story\b/i,
    /\bestablished\s+interpretation\b[^.\n]{0,80}/i,
    /\bwell[-\s]known[^.\n]{0,80}/i,
    /\bpublished\s+(?:literature|behaviour|behavior|results?)\b[^.\n]{0,80}/i,
  ];
  for (const re of textbookIdioms) {
    const m = text.match(re);
    if (m) out.push({ source: "textbook", citation: m[0].slice(0, 120).trim() });
  }
  // external-paper 系: 「matches X」「as X formalized」「matches the published」「[Author] et al. ([year])」
  const paperIdioms = [
    /\bmatches\s+(?:the\s+)?[A-Z][^.\n]{0,80}/i,
    /\bas\s+[A-Z][a-zA-Z'’]+\s+(?:formalized|formalised|showed|demonstrated|proved|argued)\b[^.\n]{0,80}/i,
    /\b[A-Z][a-zA-Z'’]+\s+(?:&|and)\s+[A-Z][a-zA-Z'’]+\b/,  // "Rochet & Tirole"
    /\b[A-Z][a-zA-Z'’]+\s+et\s+al\.?\s*\(?\d{4}\)?/,        // "Smith et al. 2013"
  ];
  for (const re of paperIdioms) {
    const m = text.match(re);
    if (m) out.push({ source: "external-paper", citation: m[0].slice(0, 120).trim() });
  }
  // 重複除去
  const seen = new Set<string>();
  return out.filter((b) => {
    const k = `${b.source}::${b.citation}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function splitIntoClaims(note: CorpusNote): BenchClaim[] {
  const text = note.body;
  // [Step] ブロックがあれば各 Step を 1 claim とする。なければ全体を 1 claim。
  const stepBlocks = text.split(/\n(?=\[Step\])/).map((b) => b.trim()).filter(Boolean);
  const claimChunks = stepBlocks.length >= 2 ? stepBlocks : [text];

  // Phase γ-follow-up 2: pairId は cross-domain / cross-language pair の検出専用。
  // contradiction-pair も pairId を持つが、それは「同ドメインの対立」なので analogical
  // ではなく dialectic が正しい mode。pipeline 側で混ぜないために、ここでカテゴリ別に
  // pairId を attach するかを決める。
  const isAnalogicalPair =
    note.category === "cross-domain-pair" || note.category === "cross-language-pair";
  const claimPairId = isAnalogicalPair ? note.pairId : undefined;

  return claimChunks.map((chunk, idx): BenchClaim => {
    const status = detectEpistemicStatus(chunk);
    const backings = detectBacking(chunk);
    return {
      sourceNoteId: note.noteId,
      title: claimChunks.length > 1 ? `${note.title} (#${idx + 1})` : note.title,
      body: chunk.slice(0, 600),
      claimRoles: detectClaimRoles(chunk),
      epistemicStatus: status,
      rebuttalConditions: extractRebuttalConditions(chunk),
      modalQualifier: detectModalQualifier(chunk),
      backing: backings.length > 0 ? backings : undefined,
      pairId: claimPairId,
    };
  });
}

// dry-run heuristic で Atom の liftLevel を雑に決めるための jargon 検出。
// Phase μ-1.1: corpus に登場する固有名詞の固定リストを使うと self-referential bias と
// μ-2 corpus 拡張で当たらなくなる問題があるので、pattern-based に切り替えた。
// 本物の lift 判定は live mode の LLM judge が担う（bench/judge.ts createLiveJudges）。
const COMMON_ACRONYM_STOPLIST = new Set([
  "AI", "API", "URL", "URI", "JSON", "HTML", "CSS", "JS", "TS", "OS",
  "PR", "ID", "OK", "NG", "JP", "EN", "UI", "UX", "SQL", "HTTP", "HTTPS",
  "TLS", "SSL", "TCP", "UDP", "DNS", "CPU", "GPU", "RAM", "ROM",
  "PDF", "CSV", "TSV", "ML", "DL", "NLP",
]);
const JARGON_PATTERNS = [
  // 化学式 (数字つき): 例 Bi2Te3 / TiO2 / H2PtCl6
  /\b(?:[A-Z][a-z]?\d+(?:[A-Z][a-z]?\d*){0,}|(?:[A-Z][a-z]?){2,}\d+|[A-Z]{2,}\d+)\b/g,
  // 化学式 (数字なし 2 元素連結): 例 ZnSb / AlV / BiTe / NaCl — Atomizer-strengthen 2026-05 で追加
  /\b(?:H|He|Li|Be|B|C|N|O|F|Ne|Na|Mg|Al|Si|P|S|Cl|Ar|K|Ca|Sc|Ti|V|Cr|Mn|Fe|Co|Ni|Cu|Zn|Ga|Ge|As|Se|Br|Kr|Rb|Sr|Y|Zr|Nb|Mo|Tc|Ru|Rh|Pd|Ag|Cd|In|Sn|Sb|Te|I|Xe|Cs|Ba|La|Ce|Pr|Nd|Pm|Sm|Eu|Gd|Tb|Dy|Ho|Er|Tm|Yb|Lu|Hf|Ta|W|Re|Os|Ir|Pt|Au|Hg|Tl|Pb|Bi|Po|At|Rn)(?:H|He|Li|Be|B|C|N|O|F|Ne|Na|Mg|Al|Si|P|S|Cl|Ar|K|Ca|Sc|Ti|V|Cr|Mn|Fe|Co|Ni|Cu|Zn|Ga|Ge|As|Se|Br|Kr|Rb|Sr|Y|Zr|Nb|Mo|Tc|Ru|Rh|Pd|Ag|Cd|In|Sn|Sb|Te|I|Xe|Cs|Ba|La|Ce|Pr|Nd|Pm|Sm|Eu|Gd|Tb|Dy|Ho|Er|Tm|Yb|Lu|Hf|Ta|W|Re|Os|Ir|Pt|Au|Hg|Tl|Pb|Bi|Po|At|Rn)+\b/g,
  // 大文字略語 (3 文字以上、stoplist 除外): 例 SPS / XRD / ORR / MHC / PROV
  // Atomizer-strengthen で 2-char 一般略語 (OS / TS / CI) を pattern 段階で外し、
  // 3+ char の真に specific な略語に絞った。stoplist の保険は残す。
  /\b[A-Z]{3,}(?:[a-z][A-Z]+)?\b/g,
  // 装置 / 製品 ID: 例 ZEM-3 / GPT-4
  /\b[A-Z][a-zA-Z]+(?:[-\s][A-Z]?[a-zA-Z]*)?[-\s]?\d+[A-Za-z]?\b/g,
  // Hyphenated 大文字始まり複合: 例 Klemens-Callaway / Klein-Nishina — Atomizer-strengthen 2026-05 で追加
  /\b[A-Z][a-zA-Z]+-[A-Z][a-zA-Z]+\b/g,
];
function hasJargon(text: string): boolean {
  for (const re of JARGON_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const token = m[0];
      if (COMMON_ACRONYM_STOPLIST.has(token.toUpperCase())) continue;
      if (/^\d+$/.test(token)) continue;
      return true;
    }
  }
  return false;
}

function clusterClaimsForAtoms(claims: BenchClaim[]): number[][] {
  // 簡易クラスタリング: ノート ID で grouping + cross-pair 同士をペアリング
  const byNote = new Map<string, number[]>();
  claims.forEach((c, i) => {
    const arr = byNote.get(c.sourceNoteId) ?? [];
    arr.push(i);
    byNote.set(c.sourceNoteId, arr);
  });

  // 1 ノートに複数 Claim があれば、それらをまとめて 1 Atom クラスタにする
  const clusters: number[][] = [];
  for (const arr of byNote.values()) {
    if (arr.length >= 2) {
      clusters.push(arr);
    } else {
      // 単一 Claim は他ノートとペアにできるか探す（cross-domain pair 等）
      clusters.push(arr);
    }
  }
  return clusters;
}

function lowestEpistemicStatus(statuses: string[]): string {
  const order = ["speculation", "interpretation", "observation", "established"];
  let lowest = "established";
  let lowestIdx = order.indexOf(lowest);
  for (const s of statuses) {
    const idx = order.indexOf(s);
    if (idx >= 0 && idx < lowestIdx) {
      lowestIdx = idx;
      lowest = s;
    }
  }
  return lowest;
}

function inferAtomType(claims: BenchClaim[]): string {
  if (claims.some((c) => c.claimRoles.includes("finding") && !MECHANISM_HINTS.some((m) => c.body.includes(m)))) {
    return "observational";
  }
  if (claims.some((c) => MECHANISM_HINTS.some((m) => c.body.includes(m)))) return "mechanistic";
  if (claims.some((c) => /場合|条件|前提/.test(c.body))) return "conditional";
  return "causal";
}

function buildAtomTitle(claims: BenchClaim[]): { title: string; level: "rung-0" | "rung-1" | "rung-2" } {
  // baseline は jargon を含む rung-1 を素で出す（Phase α が rung-2 まで上げる前提）
  const firstTitle = claims[0]?.title ?? "Untitled";
  const compact = firstTitle.split(/[（(]/)[0].trim();
  const level: "rung-0" | "rung-1" | "rung-2" = hasJargon(compact) ? "rung-1" : "rung-2";
  return { title: compact, level };
}

function buildAtoms(claims: BenchClaim[]): BenchAtom[] {
  const clusters = clusterClaimsForAtoms(claims);
  const atoms: BenchAtom[] = [];
  for (const cluster of clusters) {
    const memberClaims = cluster.map((i) => claims[i]);
    const { title, level } = buildAtomTitle(memberClaims);
    const status = lowestEpistemicStatus(memberClaims.map((c) => c.epistemicStatus));
    // Phase γ-follow-up 2: pairId 集合を atom レベルに集約。
    // 通常は 0/1 件、複数 pair を跨ぐ atom では 2+ 件。
    const pairIds = Array.from(
      new Set(memberClaims.map((c) => c.pairId).filter((p): p is string => Boolean(p))),
    );
    // Phase γ-follow-up 3: dry-run でも rebuttalConditions を Atom 層に propagate する。
    // live mode の Atomizer は「2+ Claim 共通 rebuttal のみ伝播」ガードがかかっているが、
    // dry-run cluster は 1 ノート = 1 cluster なので「単一 Claim の rebuttal」を素直に
    // 持ち上げる方が contradiction-resolution probe の意図に合う (probe の corpus は
    // 1 ノート 1 rebuttal の構成で、cluster 横断的な propagation rule の対象外)。
    // 重複は除去する。
    const rebuttals = Array.from(
      new Set(memberClaims.flatMap((c) => c.rebuttalConditions ?? [])),
    );
    atoms.push({
      title,
      body: memberClaims.map((c) => c.body.split("\n")[0]).join(" / ").slice(0, 400),
      atomType: inferAtomType(memberClaims),
      derivedFromClaims: cluster.map(String),
      derivedFromNoteIds: Array.from(new Set(memberClaims.map((c) => c.sourceNoteId))),
      epistemicStatus: status,
      liftLevel: level,
      pairIds: pairIds.length > 0 ? pairIds : undefined,
      rebuttalConditions: rebuttals.length > 0 ? rebuttals : undefined,
    });
  }
  return atoms;
}

export type DryRunResult = {
  pipelineByNote: BenchPipelineOutput[];
  allClaims: BenchClaim[];
  allAtoms: BenchAtom[];
  allMetaAtoms: BenchMetaAtom[];
};

export function runDryRunPipeline(corpus: CorpusNote[]): DryRunResult {
  const pipelineByNote: BenchPipelineOutput[] = [];
  const allClaims: BenchClaim[] = [];

  for (const note of corpus) {
    const claims = splitIntoClaims(note);
    pipelineByNote.push({ noteId: note.noteId, claims });
    allClaims.push(...claims);
  }

  const allAtoms = buildAtoms(allClaims);

  // Phase δ: dry-run でも relatedAtoms を自動付与する。
  // - 同 pairId を持つ別 Atom がいて、derivedFromNoteIds が異なるなら
  //   `applies-to-different-domain` （analogical mode の load-bearing signal）。
  // - 両方 rebuttalConditions を持つ別 Atom がいるなら `contradicts`（dialectic）。
  // 上限 3 件 / 重複除去は live Atomizer parser と同じ流儀。
  // memory: feedback_probe_dry_run_blind_spot — bench prompt 強化 PR には必ず dry-run heuristic を併設する
  for (let i = 0; i < allAtoms.length; i++) {
    const atomA = allAtoms[i];
    const aPairs = new Set(atomA.pairIds ?? []);
    const aHasRebuttal = (atomA.rebuttalConditions?.length ?? 0) > 0;
    const relations: NonNullable<BenchAtom["relatedAtoms"]> = [];
    for (let j = 0; j < allAtoms.length; j++) {
      if (i === j) continue;
      const atomB = allAtoms[j];
      const bPairs = new Set(atomB.pairIds ?? []);
      const sharedPair = [...aPairs].some((p) => bPairs.has(p));
      const sameNoteSet =
        atomA.derivedFromNoteIds.length === atomB.derivedFromNoteIds.length &&
        atomA.derivedFromNoteIds.every((id) => atomB.derivedFromNoteIds.includes(id));
      if (sharedPair && !sameNoteSet) {
        relations.push({
          targetAtomTitle: atomB.title,
          relationType: "applies-to-different-domain",
        });
        continue;
      }
      const bHasRebuttal = (atomB.rebuttalConditions?.length ?? 0) > 0;
      if (aHasRebuttal && bHasRebuttal && !sameNoteSet) {
        relations.push({ targetAtomTitle: atomB.title, relationType: "contradicts" });
      }
    }
    if (relations.length > 0) {
      atomA.relatedAtoms = relations.slice(0, 3);
    }
  }

  // Phase ε: meta-Atom（KJ 中グループ）を Atom 群から擬似抽出する。
  // dry-run heuristic は「同 atomType + 異 noteId × 3+」のシンプル基準。
  // - 同じ atomType の Atom が異なるノート由来で 3+ 集まれば、それを「再現する型」として
  //   1 つの meta-Atom にまとめる
  // - epistemicStatus は最低継承
  // - cap 5（spec の quality bar）
  const allMetaAtoms = buildMetaAtoms(allAtoms);

  return { pipelineByNote, allClaims, allAtoms, allMetaAtoms };
}

function buildMetaAtoms(atoms: BenchAtom[]): BenchMetaAtom[] {
  if (atoms.length < 3) return [];
  // atomType ごとに集約。derivedFromNoteIds の和集合に異 noteId が 2+ あることを条件にする
  // （= 単一 note 由来クラスタを meta-Atom 扱いしない）。
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < atoms.length; i++) {
    const t = atoms[i].atomType ?? "_untyped";
    if (!buckets.has(t)) buckets.set(t, []);
    buckets.get(t)!.push(i);
  }
  const out: BenchMetaAtom[] = [];
  for (const [type, idxs] of buckets) {
    if (idxs.length < 3) continue;
    const noteIds = new Set<string>();
    for (const i of idxs) {
      for (const n of atoms[i].derivedFromNoteIds) noteIds.add(n);
    }
    if (noteIds.size < 2) continue;
    const statuses = idxs.map((i) => atoms[i].epistemicStatus);
    const lowest = lowestStatus(statuses);
    const memberTitles = idxs.slice(0, 5).map((i) => atoms[i].title);
    out.push({
      title: `「${type}」型の繰り返し構造 (${idxs.length} atoms)`,
      body: `${idxs.length} 件の atomType=${type} Atom が ${noteIds.size} ノートにまたがって再現される共通軸。代表 Atom: ${memberTitles.join(" / ")}`,
      derivedFromAtomIndices: idxs,
      epistemicStatus: lowest,
      confidence: 0.75,
    });
    if (out.length >= 5) break;
  }
  return out;
}

// dry-run 用の最低継承ヘルパー（lib の lowestEpistemicStatus と同等の振る舞いを文字列で再現）
function lowestStatus(statuses: string[]): string {
  const order = ["speculation", "interpretation", "observation", "established"];
  let lowest = "established";
  let lowestRank = 3;
  let seen = false;
  for (const s of statuses) {
    const r = order.indexOf(s);
    if (r < 0) continue;
    seen = true;
    if (r < lowestRank) {
      lowestRank = r;
      lowest = s;
    }
  }
  return seen ? lowest : "interpretation";
}

// live mode の実装。実 LLM (gpt-oss-120b on Sakura AI Engine など) を使い、
// production と同じ wiki-ingester / atomizer を直接呼ぶ。
//
// 25 ノート corpus に対する LLM call は概ね:
//   - ingester: 25 call (ノート 1 件ずつ)
//   - atomizer: 1 call (全 Claim 横断)
// 合計 ~26 call/run。
//
// 2026-05-27: synthesizer ステージを撤退。pipeline は 2-stage（ingester / atomizer）。
//
// epistemicStatus / liftLevel など Phase η / α が後付けする属性は、現状では
// LLM 出力に対する heuristic 推定で埋める（baseline 確立用）。Phase η 実装時に
// LLM 側で正規に出させて、ここの heuristic を撤去する想定。

import { createModel } from "../src/server/services/llm.js";
import { runAgentLoop } from "../src/server/services/agent-loop.js";
import {
  buildIngesterSystemPrompt,
  parseIngesterOutput,
  type IngesterOutput,
} from "../src/server/services/wiki-ingester.js";
import {
  buildAtomizerSystemPrompt,
  buildAtomizerUserMessage,
  parseAtomizerOutput,
  type AtomCandidate,
} from "../src/server/services/wiki-atomizer.js";
import type { ClaimSnapshot } from "../src/server/services/wiki-types.js";
import type { ModelConfig } from "../src/server/config/models.js";

function toModelConfig(): ModelConfig {
  const cfg = getBenchModelConfig();
  return {
    id: "bench-runtime",
    name: cfg.name,
    provider: cfg.provider,
    modelId: cfg.modelId,
    apiKey: cfg.apiKey,
    apiBase: cfg.apiBase,
    createdAt: new Date().toISOString(),
  };
}

function liftLevelFromText(text: string): "rung-0" | "rung-1" | "rung-2" {
  // jargon パターンが残っていれば rung-1 とする (pattern-based, corpus-agnostic)。
  return hasJargon(text) ? "rung-1" : "rung-2";
}

/** 出力テキストが「JSON っぽいが parse 失敗した」かを軽く判定する */
function looksLikeFailedJson(text: string): boolean {
  const t = text.trim();
  if (t.length < 80) return false; // 短すぎる出力は単に空回答とみなす
  if (!t.includes("{") || !t.includes("}")) return false; // そもそも JSON 風でない
  try {
    let candidate = t;
    const m = candidate.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (m) candidate = m[1].trim();
    JSON.parse(candidate);
    return false; // 普通に parse できる
  } catch {
    return true; // JSON 風だが parse できなかった
  }
}

const PARSE_RETRY_REMINDER =
  "Your previous response could not be parsed as JSON. Re-emit the same content as a STRICT JSON object only (no markdown, no commentary, no trailing comma). The schema must match the one in the system prompt.";

async function ingestNoteLive(
  note: CorpusNote,
  modelConfig: ModelConfig,
): Promise<{ claims: BenchClaim[]; parseRetried: boolean; parseFailed: boolean }> {
  const systemPrompt = buildIngesterSystemPrompt(note.language, [], undefined);
  const userMessage = `Source note title: "${note.title}"\nUse this exact title for inline citations (e.g., "Based on [${note.title}], ...").\n\n# ${note.title}\n\n${note.body}`;
  const model = await createModel(modelConfig);

  let result = await runAgentLoop({
    model,
    modelId: modelConfig.modelId,
    systemPrompt,
    messages: [{ role: "user" as const, content: userMessage }],
    maxSteps: 1,
  });

  let docs: IngesterOutput[] = parseIngesterOutput(result.message);
  let parseRetried = false;
  let parseFailed = false;

  // 「LLM は応答を返したが parser が捨てた」ケースを retry 対象として 1 回再生成する。
  // parseIngesterOutput は失敗時に [] を返してエラーを呑むので、テキストの形から
  // 失敗を逆推定する。
  if (docs.length === 0 && looksLikeFailedJson(result.message)) {
    parseRetried = true;
    result = await runAgentLoop({
      model,
      modelId: modelConfig.modelId,
      systemPrompt,
      messages: [
        { role: "user" as const, content: userMessage },
        { role: "assistant" as const, content: result.message },
        { role: "user" as const, content: PARSE_RETRY_REMINDER },
      ],
      maxSteps: 1,
    });
    docs = parseIngesterOutput(result.message);
    if (docs.length === 0 && looksLikeFailedJson(result.message)) {
      parseFailed = true; // retry も失敗
    }
  }

  const claims: BenchClaim[] = [];
  for (const doc of docs) {
    if (doc.kind !== "claim") continue;
    const fullText = `${doc.title}\n${doc.sections.map((s) => s.content).join("\n")}`;
    const claimRoles = doc.claimRole?.length ? doc.claimRole : detectClaimRoles(fullText);
    // Phase γ: Ingester が rebuttalConditions / modalQualifier / backing を出すように
    // なったので、LLM 出力を primary に、heuristic を fallback に使う。これにより
    // bench は「LLM が Toulmin を正しく抽出できるか」を測れる。
    claims.push({
      sourceNoteId: note.noteId,
      title: doc.title,
      body: (doc.sections[0]?.content ?? "").slice(0, 600),
      claimRoles,
      epistemicStatus: doc.epistemicStatus ?? detectEpistemicStatus(fullText),
      rebuttalConditions:
        doc.rebuttalConditions && doc.rebuttalConditions.length > 0
          ? doc.rebuttalConditions
          : extractRebuttalConditions(fullText),
      modalQualifier: doc.modalQualifier ?? detectModalQualifier(fullText),
      // Phase γ-follow-up: LLM が backing を返さなかった場合は heuristic で補う
      // (rebuttal / modalQualifier と同じ "LLM primary, heuristic fallback" ポリシー)。
      backing:
        doc.backing && doc.backing.length > 0
          ? doc.backing
          : (() => {
              const h = detectBacking(fullText);
              return h.length > 0 ? h : undefined;
            })(),
    });
  }
  return { claims, parseRetried, parseFailed };
}

function claimsToSnapshots(claims: BenchClaim[]): ClaimSnapshot[] {
  return claims.map((c, idx): ClaimSnapshot => ({
    id: `claim-${idx}`,
    title: c.title,
    bodyPreview: c.body.slice(0, 280),
    level: c.claimRoles.includes("finding") ? "finding" : undefined,
    relatedClaims: [],
    // Phase η: epistemicStatus を Atomizer に渡す（lowest-status inheritance）
    epistemicStatus: c.epistemicStatus as ClaimSnapshot["epistemicStatus"],
    // Phase γ: rebuttalConditions を Atomizer に渡し、「2+ Claim 共通 rebuttal のみ伝播」
    // という propagation rule を LLM + parser に守らせる。
    rebuttalConditions:
      c.rebuttalConditions && c.rebuttalConditions.length > 0 ? c.rebuttalConditions : undefined,
  }));
}

function atomCandidatesToBenchAtoms(
  atoms: AtomCandidate[],
  claims: BenchClaim[],
): BenchAtom[] {
  return atoms.map((a) => {
    const sourceIdxs = a.derivedFromClaims
      .map((id) => parseInt(id.replace(/^claim-/, ""), 10))
      .filter((n) => Number.isFinite(n) && n >= 0 && n < claims.length);
    const memberClaims = sourceIdxs.map((i) => claims[i]);
    const statuses = memberClaims.map((c) => c.epistemicStatus);
    const status = statuses.length > 0 ? lowestEpistemicStatus(statuses) : "interpretation";
    const noteIds = Array.from(new Set(memberClaims.map((c) => c.sourceNoteId)));
    return {
      title: a.title,
      body: a.body,
      atomType: a.atomType,
      derivedFromClaims: a.derivedFromClaims,
      derivedFromNoteIds: noteIds,
      epistemicStatus: status,
      liftLevel: liftLevelFromText(`${a.title} ${a.body}`),
      // Phase γ: parseAtomizerOutput 側で「2+ Claim 共通の rebuttal のみ伝播」ガードが
      // かかっているので、ここはそのまま受ける。
      rebuttalConditions:
        a.rebuttalConditions && a.rebuttalConditions.length > 0 ? a.rebuttalConditions : undefined,
    };
  });
}

export async function runLivePipeline(corpus: CorpusNote[]): Promise<DryRunResult> {
  const cfg = getBenchModelConfig();
  // claude-subscription はローカル claude CLI の OAuth 認証を使うため apiKey 不要。
  // それ以外の provider は従来通り apiKey が無ければ live pipeline を止める。
  if (!cfg.apiKey.trim() && cfg.provider !== "claude-subscription") {
    throw new Error(
      "BENCH_API_KEY (または SAKURA_AI_API_KEY) が未設定です。BENCH_MODE=dry-run で実行するか API キーを設定してください。",
    );
  }
  const modelConfig = toModelConfig();
  console.log(
    `[bench] live mode: model=${cfg.modelId} via ${cfg.provider === "claude-subscription" ? "claude-subscription (local CLI OAuth)" : cfg.apiBase}`,
  );

  // 1) ingester: ノートごとに直列で呼ぶ（rate limit と無償枠を意識した素直な実装）
  const pipelineByNote: BenchPipelineOutput[] = [];
  const allClaims: BenchClaim[] = [];
  let parseRetries = 0;
  let parseFailures = 0;
  for (let i = 0; i < corpus.length; i++) {
    const note = corpus[i];
    process.stdout.write(`[bench] ingest ${i + 1}/${corpus.length} ${note.noteId} ... `);
    let claims: BenchClaim[] = [];
    try {
      const res = await ingestNoteLive(note, modelConfig);
      claims = res.claims;
      if (res.parseRetried) parseRetries += 1;
      if (res.parseFailed) parseFailures += 1;
      const suffix = res.parseFailed
        ? " (parse failed after retry)"
        : res.parseRetried
          ? " (recovered by retry)"
          : "";
      process.stdout.write(`${claims.length} claim(s)${suffix}\n`);
    } catch (err) {
      process.stdout.write(`ERROR\n`);
      console.error(`  ingester error for ${note.noteId}:`, (err as Error).message);
    }
    pipelineByNote.push({ noteId: note.noteId, claims });
    allClaims.push(...claims);
  }
  if (parseRetries > 0 || parseFailures > 0) {
    console.log(
      `[bench] ingester JSON parse: retried=${parseRetries}, failed-after-retry=${parseFailures}`,
    );
  }

  // 2) atomizer: 全 Claim を 1 ショットで投げる
  let allAtoms: BenchAtom[] = [];
  if (allClaims.length >= 2) {
    console.log(`[bench] atomize: ${allClaims.length} claims -> ...`);
    const snapshots = claimsToSnapshots(allClaims);
    const idToTitle = new Map(snapshots.map((s) => [s.id, s.title]));
    const systemPrompt = buildAtomizerSystemPrompt("ja");
    const userMessage = buildAtomizerUserMessage(snapshots, []);
    try {
      const model = await createModel(modelConfig);
      let result = await runAgentLoop({
        model,
        modelId: modelConfig.modelId,
        systemPrompt,
        messages: [{ role: "user" as const, content: userMessage }],
        maxSteps: 1,
      });
      // Phase η + γ: source の epistemicStatus / rebuttalConditions マップを parser に渡し、
      // (a) lowest-status inheritance、(b) 2+ Claim 共通 rebuttal のみ伝播、を強制する。
      const idToEpistemic = new Map(
        snapshots.map((s) => [s.id, s.epistemicStatus]),
      );
      const idToRebuttals = new Map(
        snapshots.map((s) => [s.id, s.rebuttalConditions]),
      );
      let atomCandidates = parseAtomizerOutput(result.message, idToTitle, idToEpistemic, idToRebuttals);
      if (atomCandidates.length === 0 && looksLikeFailedJson(result.message)) {
        console.log("[bench] atomize: retrying (parse failed)");
        result = await runAgentLoop({
          model,
          modelId: modelConfig.modelId,
          systemPrompt,
          messages: [
            { role: "user" as const, content: userMessage },
            { role: "assistant" as const, content: result.message },
            { role: "user" as const, content: PARSE_RETRY_REMINDER },
          ],
          maxSteps: 1,
        });
        atomCandidates = parseAtomizerOutput(result.message, idToTitle);
      }
      allAtoms = atomCandidatesToBenchAtoms(atomCandidates, allClaims);
      console.log(`[bench] atomize result: ${allAtoms.length} atom(s)`);
    } catch (err) {
      console.error("  atomizer error:", (err as Error).message);
    }
  } else {
    console.log("[bench] atomize skipped (claims < 2)");
  }

  // Phase ε: live でも meta-Atom 抽出をヒューリスティック付与する。
  // 本来は wiki-meta-atomizer.ts を呼びたいが、現状の live bench scaffold は
  // 1 つの pass しか持っていないので、まずは dry-run と同じ atomType 集約で
  // 推定値を出す（probe metric の整合性のため）。将来は LLM 呼び出しに差し替える。
  const allMetaAtoms = buildMetaAtoms(allAtoms);
  if (allMetaAtoms.length > 0) {
    console.log(`[bench] meta-atomize (heuristic): ${allMetaAtoms.length} meta-atom(s)`);
  }

  return { pipelineByNote, allClaims, allAtoms, allMetaAtoms };
}
