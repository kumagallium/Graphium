// Phase μ-1: LLM-as-judge スタブ
//
// 各 judge は明示の rubric を持ち、live mode では LLM に問い合わせる。
// dry-run mode では heuristic 判定で代替する。コスト抑制のため、判定モデルは
// `BENCH_JUDGE_MODEL_ID` で個別指定可能（spec §5: Haiku 等を想定）。

import type { BenchAtom } from "./types.ts";
import { getBenchJudgeConfig } from "./config.ts";

const JARGON = [
  "ZnSb", "SPS", "XRD", "Bi2Te3", "Sb", "Zn", "Te", "Bi", "Pt",
  "TiO2", "H2PtCl6", "ZEM-3", "LFA", "HP", "RDE", "ORR", "Nafion",
  "HClO4", "qPCR", "DMEM", "FBS", "HeLa", "siRNA", "GAPDH",
  "Lipofectamine", "MHC", "HIDS", "auditd", "SGD", "TDD",
  "Redis", "Temporal", "NTP", "TTL", "RHE", "PARSTAT", "Dr Sinter",
];

export type LiftJudgment = { passed: boolean; reason: string };

/**
 * Atom title が rung-2 まで lift されているかを判定する。
 *
 * rubric: "Does this Atom title contain any domain-specific proper noun, instrument
 *   name, abbreviation, or jargon that a non-specialist would not recognize?"
 *
 * dry-run: JARGON リストとの正規表現マッチで heuristic 判定する。
 * live: LLM に rubric を投げて binary 判定を取得する（Phase α 以降で実装を埋める）。
 */
export function judgeAtomLift(atom: BenchAtom): LiftJudgment {
  const target = `${atom.title} ${atom.body}`;
  const matched = JARGON.filter((j) => new RegExp(`\\b${j}\\b`, "i").test(target));
  if (matched.length > 0) {
    return {
      passed: false,
      reason: `domain-specific tokens remained: ${matched.slice(0, 5).join(", ")}`,
    };
  }
  return { passed: true, reason: "no domain-specific jargon detected" };
}

/**
 * Synthesis 本文が source Atom 本文の単純な言い換え（≒ 低 novelty）か判定する。
 *
 * dry-run: 文字列の包含チェック（pipeline.ts の dry-run synthesis 出力に対しては
 *   常に高 novelty 寄りに出る）。
 * live: LLM rubric 「この Synthesis は source の言い換え以上の情報を加えているか」。
 */
export function judgeSynthesisNovelty(
  synthesisBody: string,
  sourceTexts: string[],
): LiftJudgment {
  const synthLower = synthesisBody.toLowerCase();
  const concatLower = sourceTexts.join(" ").toLowerCase();
  if (concatLower.includes(synthLower.slice(0, 60))) {
    return { passed: false, reason: "synthesis body is largely a paraphrase of sources" };
  }
  return { passed: true, reason: "synthesis introduces structure beyond source" };
}

/** 設定情報の取得（report に記録するため） */
export function getJudgeMeta(): { provider: string; modelId: string; modelName: string } {
  const cfg = getBenchJudgeConfig();
  return { provider: cfg.provider, modelId: cfg.modelId, modelName: cfg.name };
}
