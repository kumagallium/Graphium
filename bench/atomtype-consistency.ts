// Atom type inter-trial consistency probe (Phase A 観察用、2026-05-26)
//
// 同一 Claim 集合に対して Atomizer を K 回 live で叩き、
// 各 Claim がどの atomType の Atom に入ったかを集計する。
//
// 目的:
//   bench/probes/inter-trial/atom-type-exclusivity.probe.json を読み込み、
//   そこに列挙された corpus ノートで Claim を 1 回だけ ingest（live）し、
//   その後 Atomizer を K 回独立に呼んで、atomType の inter-trial 一致度と
//   confusion matrix を出す。標準 bench runner からは独立して動く。
//
// 出力:
//   - bench/results/atomtype-consistency-<timestamp>.json に raw 結果
//   - docs/internal/observations/atomtype-consistency-2026-05.md に
//     人間が読む要約を後から書き写す（このスクリプトは自動更新しない）
//
// pass/fail 判定や CI 連携は **意図的に作らない**。閾値や自動アラートは
// Phase A の責務外。
//
// 環境変数:
//   BENCH_API_KEY (or SAKURA_AI_API_KEY) — live 実行に必須
//   ATOMTYPE_PROBE_PATH (default: bench/probes/inter-trial/atom-type-exclusivity.probe.json)
//   ATOMTYPE_K (default: probe.expected.k or 5)
//
// 実行:
//   pnpm tsx bench/atomtype-consistency.ts

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { BENCH_DIR, REPO_ROOT, resolveProbeInput } from "./load.ts";
import { getBenchModelConfig, hasLiveApiKey } from "./config.ts";
import type { CorpusNote } from "./types.ts";

import { createModel } from "../src/server/services/llm.js";
import { runAgentLoop } from "../src/server/services/agent-loop.js";
import {
  buildIngesterSystemPrompt,
  parseIngesterOutput,
} from "../src/server/services/wiki-ingester.js";
import {
  buildAtomizerSystemPrompt,
  buildAtomizerUserMessage,
  parseAtomizerOutput,
  type AtomCandidate,
} from "../src/server/services/wiki-atomizer.js";
import type { ClaimSnapshot } from "../src/server/services/wiki-synthesizer.js";
import type { ModelConfig } from "../src/server/config/models.js";

type SimpleClaim = {
  sourceNoteId: string;
  title: string;
  body: string;
  epistemicStatus: string;
  rebuttalConditions: string[];
  level?: "finding" | "principle" | "bridge";
};

type TrialOutput = {
  trial: number;
  atoms: { title: string; atomType: string | undefined; sourceClaimIds: string[] }[];
};

type ProbeFile = {
  name: string;
  inputs: string[];
  expected: { measurement: string; k?: number; focusPairs?: [string, string][]; rationale?: string };
  rationale: string;
};

function toModelConfig(): ModelConfig {
  const cfg = getBenchModelConfig();
  return {
    id: "atomtype-consistency",
    name: cfg.name,
    provider: cfg.provider,
    modelId: cfg.modelId,
    apiKey: cfg.apiKey,
    apiBase: cfg.apiBase,
    createdAt: new Date().toISOString(),
  };
}

async function ingestNote(note: CorpusNote, modelConfig: ModelConfig): Promise<SimpleClaim[]> {
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
  const docs = parseIngesterOutput(result.message);
  const out: SimpleClaim[] = [];
  for (const doc of docs) {
    if (doc.kind !== "claim") continue;
    const body = doc.sections.map((s) => s.content).join("\n");
    out.push({
      sourceNoteId: note.noteId,
      title: doc.title,
      body,
      epistemicStatus: doc.epistemicStatus ?? "interpretation",
      rebuttalConditions: doc.rebuttalConditions ?? [],
      level: doc.level,
    });
  }
  return out;
}

function claimsToSnapshots(claims: SimpleClaim[]): ClaimSnapshot[] {
  return claims.map((c, idx): ClaimSnapshot => ({
    id: `claim-${idx}`,
    title: c.title,
    bodyPreview: c.body.slice(0, 280),
    level: c.level,
    relatedClaims: [],
    epistemicStatus: c.epistemicStatus as ClaimSnapshot["epistemicStatus"],
    rebuttalConditions: c.rebuttalConditions.length > 0 ? c.rebuttalConditions : undefined,
  }));
}

async function runAtomizerOnce(claims: SimpleClaim[], modelConfig: ModelConfig): Promise<AtomCandidate[]> {
  const snapshots = claimsToSnapshots(claims);
  const idToTitle = new Map(snapshots.map((s) => [s.id, s.title]));
  const idToEpistemic = new Map(snapshots.map((s) => [s.id, s.epistemicStatus]));
  const idToRebuttals = new Map(snapshots.map((s) => [s.id, s.rebuttalConditions]));
  const systemPrompt = buildAtomizerSystemPrompt("ja");
  const userMessage = buildAtomizerUserMessage(snapshots, []);
  const model = createModel(modelConfig);
  const result = await runAgentLoop({
    model,
    modelId: modelConfig.modelId,
    systemPrompt,
    messages: [{ role: "user" as const, content: userMessage }],
    maxSteps: 1,
  });
  return parseAtomizerOutput(result.message, idToTitle, idToEpistemic, idToRebuttals);
}

function buildConfusionMatrix(trials: TrialOutput[]): {
  perClaim: Record<string, Record<string, number>>;
  pairwise: Record<string, Record<string, number>>;
} {
  // 各 Claim について、trial をまたいで何回どの atomType に入ったか
  const perClaim: Record<string, Record<string, number>> = {};
  for (const trial of trials) {
    for (const atom of trial.atoms) {
      const t = atom.atomType ?? "_undefined";
      for (const cid of atom.sourceClaimIds) {
        perClaim[cid] ??= {};
        perClaim[cid][t] = (perClaim[cid][t] ?? 0) + 1;
      }
    }
  }

  // pairwise confusion: 全 trial の組み合わせ (i, j) について、
  // 同じ Claim が trial_i で type_a, trial_j で type_b に居た場合に
  // pairwise[type_a][type_b] を 1 増やす
  const pairwise: Record<string, Record<string, number>> = {};
  const claimToTrialType: Map<string, Map<number, string>> = new Map();
  for (const trial of trials) {
    for (const atom of trial.atoms) {
      const t = atom.atomType ?? "_undefined";
      for (const cid of atom.sourceClaimIds) {
        if (!claimToTrialType.has(cid)) claimToTrialType.set(cid, new Map());
        claimToTrialType.get(cid)!.set(trial.trial, t);
      }
    }
  }
  for (const [, trialMap] of claimToTrialType) {
    const entries = Array.from(trialMap.entries());
    for (let i = 0; i < entries.length; i++) {
      for (let j = 0; j < entries.length; j++) {
        if (i === j) continue;
        const a = entries[i][1];
        const b = entries[j][1];
        pairwise[a] ??= {};
        pairwise[a][b] = (pairwise[a][b] ?? 0) + 1;
      }
    }
  }
  return { perClaim, pairwise };
}

async function main() {
  const probePath =
    process.env.ATOMTYPE_PROBE_PATH ??
    join(BENCH_DIR, "probes/inter-trial/atom-type-exclusivity.probe.json");
  const probe = JSON.parse(readFileSync(probePath, "utf-8")) as ProbeFile;
  const K = Number(process.env.ATOMTYPE_K ?? probe.expected.k ?? 5);

  if (!hasLiveApiKey()) {
    console.error(
      "[atomtype-consistency] BENCH_API_KEY (or SAKURA_AI_API_KEY) is required.\n" +
        "  This probe measures LLM stochasticity across K independent atomizer calls,\n" +
        "  which only makes sense in live mode. Dry-run is deterministic.\n" +
        "  Set the key and rerun. Aborting.",
    );
    process.exitCode = 2;
    return;
  }

  const modelConfig = toModelConfig();
  console.log(`[atomtype-consistency] probe=${probe.name} K=${K} model=${modelConfig.modelId}`);

  const corpus: CorpusNote[] = probe.inputs.map((p) => resolveProbeInput(p));
  console.log(`[atomtype-consistency] inputs: ${corpus.length} note(s)`);

  // 1) Ingester は 1 回だけ。Claim 集合を固定する（atomType variance だけを測りたいので）。
  const claims: SimpleClaim[] = [];
  for (let i = 0; i < corpus.length; i++) {
    const note = corpus[i];
    process.stdout.write(`[atomtype-consistency] ingest ${i + 1}/${corpus.length} ${note.noteId} ... `);
    const c = await ingestNote(note, modelConfig);
    claims.push(...c);
    process.stdout.write(`${c.length} claim(s)\n`);
  }
  if (claims.length < 2) {
    console.error("[atomtype-consistency] not enough claims to atomize (need >= 2). aborting.");
    process.exitCode = 3;
    return;
  }
  console.log(`[atomtype-consistency] total claims: ${claims.length}`);

  // 2) Atomizer を K 回。同じ Claim 集合を渡す。
  const trials: TrialOutput[] = [];
  for (let t = 1; t <= K; t++) {
    process.stdout.write(`[atomtype-consistency] atomize trial ${t}/${K} ... `);
    try {
      const atoms = await runAtomizerOnce(claims, modelConfig);
      trials.push({
        trial: t,
        atoms: atoms.map((a) => ({
          title: a.title,
          atomType: a.atomType,
          sourceClaimIds: a.derivedFromClaims,
        })),
      });
      process.stdout.write(`${atoms.length} atom(s)\n`);
    } catch (err) {
      process.stdout.write(`ERROR: ${(err as Error).message}\n`);
    }
  }

  // 3) Confusion matrix
  const matrix = buildConfusionMatrix(trials);

  const out = {
    probeName: probe.name,
    timestamp: new Date().toISOString(),
    modelId: modelConfig.modelId,
    k: K,
    claimCount: claims.length,
    claims: claims.map((c, idx) => ({ id: `claim-${idx}`, title: c.title, sourceNoteId: c.sourceNoteId })),
    trials,
    perClaimAtomTypeHistogram: matrix.perClaim,
    pairwiseConfusionMatrix: matrix.pairwise,
    focusPairs: probe.expected.focusPairs ?? [],
  };

  const resultsDir = join(REPO_ROOT, "bench/results");
  mkdirSync(resultsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = join(resultsDir, `atomtype-consistency-${ts}.json`);
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n[atomtype-consistency] wrote ${outPath}`);

  // 軽い summary
  console.log("\n[atomtype-consistency] focus pair counts (pairwise):");
  for (const [a, b] of out.focusPairs) {
    const ab = out.pairwiseConfusionMatrix[a]?.[b] ?? 0;
    const ba = out.pairwiseConfusionMatrix[b]?.[a] ?? 0;
    const aa = out.pairwiseConfusionMatrix[a]?.[a] ?? 0;
    const bb = out.pairwiseConfusionMatrix[b]?.[b] ?? 0;
    console.log(`  ${a} <-> ${b}: ${a}->${b}=${ab}, ${b}->${a}=${ba}, ${a}->${a}=${aa}, ${b}->${b}=${bb}`);
  }
}

main().catch((err) => {
  console.error("[atomtype-consistency] fatal:", err);
  process.exitCode = 1;
});
