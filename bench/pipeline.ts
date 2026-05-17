// Phase μ-1: bench パイプライン
//
// 2 つのモードをサポート:
//   1. live: 実 LLM (gpt-oss-120b on Sakura AI Engine 等) で wiki-ingester / atomizer /
//      synthesizer を呼び出す。BENCH_API_KEY または SAKURA_AI_API_KEY が必要。
//   2. dry-run: heuristic ベースの deterministic 出力。API key 不要で CI / scaffolding 用。
//
// dry-run はあくまで baseline 確立と CI 動作の保証用。実 phase 採否の判断には
// live mode が必須（spec §5 の merge 判断ルール参照）。

import type {
  BenchAtom,
  BenchClaim,
  BenchPipelineOutput,
  BenchSynthesis,
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

function splitIntoClaims(note: CorpusNote): BenchClaim[] {
  const text = note.body;
  // [Step] ブロックがあれば各 Step を 1 claim とする。なければ全体を 1 claim。
  const stepBlocks = text.split(/\n(?=\[Step\])/).map((b) => b.trim()).filter(Boolean);
  const claimChunks = stepBlocks.length >= 2 ? stepBlocks : [text];

  return claimChunks.map((chunk, idx): BenchClaim => {
    const status = detectEpistemicStatus(chunk);
    return {
      sourceNoteId: note.noteId,
      title: claimChunks.length > 1 ? `${note.title} (#${idx + 1})` : note.title,
      body: chunk.slice(0, 600),
      claimRoles: detectClaimRoles(chunk),
      epistemicStatus: status,
      rebuttalConditions: extractRebuttalConditions(chunk),
      modalQualifier: detectModalQualifier(chunk),
    };
  });
}

// 共通 lift 用の jargon 表（領域固有語）。Phase α でこのリストに頼らず LLM 側で lift する。
const DOMAIN_JARGON = [
  "ZnSb", "SPS", "XRD", "Bi2Te3", "Sb", "Zn", "Te", "Bi", "Pt",
  "TiO2", "H2PtCl6", "ZEM-3", "LFA", "HP", "RDE", "ORR", "Nafion",
  "HClO4", "qPCR", "DMEM", "FBS", "HeLa", "siRNA", "GAPDH",
  "Lipofectamine", "MHC", "HIDS", "auditd", "SGD", "TDD",
  "Redis", "Temporal", "NTP", "TTL", "API", "RHE", "PARSTAT", "Dr Sinter",
];

function hasJargon(text: string): boolean {
  return DOMAIN_JARGON.some((j) => new RegExp(`\\b${j}\\b`, "i").test(text));
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
    atoms.push({
      title,
      body: memberClaims.map((c) => c.body.split("\n")[0]).join(" / ").slice(0, 400),
      atomType: inferAtomType(memberClaims),
      derivedFromClaims: cluster.map(String),
      derivedFromNoteIds: Array.from(new Set(memberClaims.map((c) => c.sourceNoteId))),
      epistemicStatus: status,
      liftLevel: level,
    });
  }
  return atoms;
}

function dryRunPairMode(atomA: BenchAtom, atomB: BenchAtom): BenchSynthesis["mode"] {
  // 単純化した router（spec の synthesis-router を模した最小実装）
  // baseline 設計: deductive を fallback に含めるため、~比率で deductive 偏重になる。
  // Phase β でこの routing が rebalance される。
  const aNotes = atomA.derivedFromNoteIds;
  const bNotes = atomB.derivedFromNoteIds;
  const aDom = aNotes.join(",");
  const bDom = bNotes.join(",");

  // pairId のノート同士は意図的なペア
  const pairAtoms = atomA.derivedFromNoteIds.concat(atomB.derivedFromNoteIds);
  const obsOnly = atomA.atomType === "observational" && atomB.atomType === "observational";
  const bothHaveRebuttal = false; // baseline では rebuttalConditions が atom に伝播していない

  if (obsOnly) return "abductive";
  if (aDom !== bDom && (atomA.atomType !== atomB.atomType)) return "analogical";
  if (bothHaveRebuttal) return "dialectic";
  return "deductive"; // baseline で偏重するパス
}

function buildSyntheses(atoms: BenchAtom[]): BenchSynthesis[] {
  if (atoms.length < 2) return [];
  const out: BenchSynthesis[] = [];
  // Atom を 2 つずつペアにしていく（重複なし）
  for (let i = 0; i < atoms.length; i++) {
    for (let j = i + 1; j < atoms.length; j++) {
      // 全 Atom ペア組み合わせは爆発するので、隣接 + 同 category っぽいものに絞る
      if (j - i > 3 && j !== atoms.length - 1) continue;
      const a = atoms[i];
      const b = atoms[j];
      const mode = dryRunPairMode(a, b);
      const status = lowestEpistemicStatus([a.epistemicStatus, b.epistemicStatus]);
      const hypothesisStatus = status === "speculation" ? "speculative" : "tested";
      out.push({
        title: `${a.title} × ${b.title}`,
        body: `${mode} reasoning over ${a.title} and ${b.title}. (dry-run heuristic)`,
        mode,
        sourceAtomIndices: [i, j],
        hypothesisStatus,
        externalSources: [],
      });
    }
  }
  return out;
}

export type DryRunResult = {
  pipelineByNote: BenchPipelineOutput[];
  allClaims: BenchClaim[];
  allAtoms: BenchAtom[];
  allSyntheses: BenchSynthesis[];
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
  const allSyntheses = buildSyntheses(allAtoms);

  return { pipelineByNote, allClaims, allAtoms, allSyntheses };
}

// live mode の実装。実 LLM (gpt-oss-120b on Sakura AI Engine など) を使い、
// production と同じ wiki-ingester / atomizer / synthesizer を直接呼ぶ。
//
// 25 ノート corpus に対する LLM call は概ね:
//   - ingester: 25 call (ノート 1 件ずつ)
//   - atomizer: 1 call (全 Claim 横断)
//   - synthesizer: 1 call (全 Atom 横断)
// 合計 ~27 call/run。
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
import {
  buildSynthesizerSystemPrompt,
  buildSynthesizerUserMessage,
  parseSynthesizerOutputWithStats,
  type ClaimSnapshot,
  type SynthesisCandidate,
} from "../src/server/services/wiki-synthesizer.js";
import { routeSynthesisMode } from "../src/features/ai-assistant/synthesis-router.js";
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
  // Phase α 前の baseline 用 heuristic。jargon が残っていれば rung-1 とする。
  return DOMAIN_JARGON.some((j) => new RegExp(`\\b${j}\\b`, "i").test(text))
    ? "rung-1"
    : "rung-2";
}

async function ingestNoteLive(
  note: CorpusNote,
  modelConfig: ModelConfig,
): Promise<BenchClaim[]> {
  const systemPrompt = buildIngesterSystemPrompt(note.language, [], undefined);
  const userMessage = `Source note title: "${note.title}"\nUse this exact title for inline citations (e.g., "Based on [${note.title}], ...").\n\n# ${note.title}\n\n${note.body}`;
  const model = createModel(modelConfig);

  const result = await runAgentLoop({
    model,
    modelId: modelConfig.modelId,
    systemPrompt,
    messages: [{ role: "user" as const, content: userMessage }],
    maxSteps: 1,
  });

  const docs: IngesterOutput[] = parseIngesterOutput(result.message);
  const claims: BenchClaim[] = [];
  for (const doc of docs) {
    if (doc.kind !== "claim") continue;
    const fullText = `${doc.title}\n${doc.sections.map((s) => s.content).join("\n")}`;
    const claimRoles = doc.claimRole?.length ? doc.claimRole : detectClaimRoles(fullText);
    claims.push({
      sourceNoteId: note.noteId,
      title: doc.title,
      body: (doc.sections[0]?.content ?? "").slice(0, 600),
      claimRoles,
      epistemicStatus: detectEpistemicStatus(fullText),
      rebuttalConditions: extractRebuttalConditions(fullText),
      modalQualifier: detectModalQualifier(fullText),
    });
  }
  return claims;
}

function claimsToSnapshots(claims: BenchClaim[]): ClaimSnapshot[] {
  return claims.map((c, idx): ClaimSnapshot => ({
    id: `claim-${idx}`,
    title: c.title,
    bodyPreview: c.body.slice(0, 280),
    level: c.claimRoles.includes("finding") ? "finding" : undefined,
    relatedClaims: [],
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
    };
  });
}

function atomsToConceptSnapshots(atoms: BenchAtom[]): ClaimSnapshot[] {
  return atoms.map((a, idx) => ({
    id: `atom-${idx}`,
    title: a.title,
    bodyPreview: a.body.slice(0, 280),
    relatedClaims: [],
    atomType: a.atomType as ClaimSnapshot["atomType"],
  }));
}

function synthesisCandidatesToBenchSyntheses(
  syntheses: SynthesisCandidate[],
  atoms: BenchAtom[],
): BenchSynthesis[] {
  const out: BenchSynthesis[] = [];
  for (const s of syntheses) {
    const idxs = s.sourceConceptIds
      .map((id) => parseInt(id.replace(/^atom-/, ""), 10))
      .filter((n) => Number.isFinite(n) && n >= 0 && n < atoms.length);
    if (idxs.length < 2) continue;
    const mode = (s.synthesisMode ?? "deductive") as BenchSynthesis["mode"];
    const body = s.sections.map((sec) => `${sec.heading}\n${sec.content}`).join("\n\n");
    const statuses = idxs.map((i) => atoms[i].epistemicStatus);
    const status = lowestEpistemicStatus(statuses);
    out.push({
      title: s.title,
      body,
      mode,
      sourceAtomIndices: idxs,
      hypothesisStatus:
        s.hypothesisStatus === "speculative" || status === "speculation"
          ? "speculative"
          : "tested",
      externalSources: [],
    });
  }
  return out;
}

export async function runLivePipeline(corpus: CorpusNote[]): Promise<DryRunResult> {
  const cfg = getBenchModelConfig();
  if (!cfg.apiKey.trim()) {
    throw new Error(
      "BENCH_API_KEY (または SAKURA_AI_API_KEY) が未設定です。BENCH_MODE=dry-run で実行するか API キーを設定してください。",
    );
  }
  const modelConfig = toModelConfig();
  console.log(`[bench] live mode: model=${cfg.modelId} via ${cfg.apiBase}`);

  // 1) ingester: ノートごとに直列で呼ぶ（rate limit と無償枠を意識した素直な実装）
  const pipelineByNote: BenchPipelineOutput[] = [];
  const allClaims: BenchClaim[] = [];
  for (let i = 0; i < corpus.length; i++) {
    const note = corpus[i];
    process.stdout.write(`[bench] ingest ${i + 1}/${corpus.length} ${note.noteId} ... `);
    let claims: BenchClaim[] = [];
    try {
      claims = await ingestNoteLive(note, modelConfig);
      process.stdout.write(`${claims.length} claim(s)\n`);
    } catch (err) {
      process.stdout.write(`ERROR\n`);
      console.error(`  ingester error for ${note.noteId}:`, (err as Error).message);
    }
    pipelineByNote.push({ noteId: note.noteId, claims });
    allClaims.push(...claims);
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
      const model = createModel(modelConfig);
      const result = await runAgentLoop({
        model,
        modelId: modelConfig.modelId,
        systemPrompt,
        messages: [{ role: "user" as const, content: userMessage }],
        maxSteps: 1,
      });
      const atomCandidates = parseAtomizerOutput(result.message, idToTitle);
      allAtoms = atomCandidatesToBenchAtoms(atomCandidates, allClaims);
      console.log(`[bench] atomize result: ${allAtoms.length} atom(s)`);
    } catch (err) {
      console.error("  atomizer error:", (err as Error).message);
    }
  } else {
    console.log("[bench] atomize skipped (claims < 2)");
  }

  // 3) synthesizer: 全 Atom を 1 ショットで投げる
  let allSyntheses: BenchSynthesis[] = [];
  if (allAtoms.length >= 2) {
    console.log(`[bench] synthesize: ${allAtoms.length} atoms -> ...`);
    const conceptSnapshots = atomsToConceptSnapshots(allAtoms);
    const router = routeSynthesisMode(conceptSnapshots.map((c) => c.atomType));
    const systemPrompt = buildSynthesizerSystemPrompt(
      "ja",
      undefined,
      router.candidateModes,
    );
    const userMessage = buildSynthesizerUserMessage(conceptSnapshots, []);
    try {
      const model = createModel(modelConfig);
      const result = await runAgentLoop({
        model,
        modelId: modelConfig.modelId,
        systemPrompt,
        messages: [{ role: "user" as const, content: userMessage }],
        maxSteps: 1,
      });
      const stats = parseSynthesizerOutputWithStats(result.message);
      allSyntheses = synthesisCandidatesToBenchSyntheses(stats.candidates, allAtoms);
      console.log(
        `[bench] synthesize result: ${allSyntheses.length} synthesis (rawCount=${stats.rawCount}, dropped=${stats.droppedByConfidence})`,
      );
    } catch (err) {
      console.error("  synthesizer error:", (err as Error).message);
    }
  } else {
    console.log("[bench] synthesize skipped (atoms < 2)");
  }

  return { pipelineByNote, allClaims, allAtoms, allSyntheses };
}
