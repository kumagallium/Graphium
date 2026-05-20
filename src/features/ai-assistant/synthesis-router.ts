// Synthesis mode router (PR-B5, Phase 1.3)
//
// 入力 Atom 群の atomType 分布から、Synthesizer に提示する synthesisMode の
// 候補集合を返す純関数。最終的な mode 選択は LLM に委ねる（content 判断が必要な
// dialectic / analogical は router 単独では決められないため）。
//
// === Heuristic v1 mapping (proposal v4 ベース) =================================
//
//   abductive   ← observational + (causal または mechanistic)
//   dialectic   ← 逆向きの効果を主張する causal ペア（content 判断が要る）
//   analogical  ← 異領域の mechanistic ペア（content 判断が要る）
//   deductive   ← 独立した causal / methodological の組み合わせ
//   default     ← deductive（最も permissive）
//
// 設計判断:
// - router は atomType だけで決まる **必要条件** しか機械的に判定しない。
//   dialectic（逆向き）や analogical（異領域）は content 判断を要するので、
//   候補に「含めるか／含めないか」を atomType の組み合わせで決め、
//   どれを採用するかは LLM 側に委ねる。
// - mapping 自体は heuristic v1。観察してから調整する前提で、router 実装と
//   この mapping を分離可能なテストにしてある（synthesis-router.test.ts）。
// - proposal v4 から逸脱した点があれば、本コメントで理由を残すこと。
// =============================================================================

import type { AtomType, EpistemicStatus, SynthesisMode } from "../../lib/document-types.js";

export type SynthesisRouterResult = {
  /**
   * Synthesizer に提示する候補モード。LLM はこの中から 1 つだけ選ぶ。
   * 必ず 1 件以上含み、先頭が router の推奨モード（プロンプト表示順）。
   */
  candidateModes: SynthesisMode[];
  /** router がプロンプト構築のために選んだ「最も推奨される」単一モード */
  recommendedMode: SynthesisMode;
  /** 推定の根拠（ログ用・デバッグ用） */
  rationale: string;
  /**
   * Phase η: 入力 Atom / Claim の epistemicStatus 分布概要（ログ用）。
   * 入力に speculation が 1 件でも含まれていれば true。
   */
  hasSpeculativeInput?: boolean;
};

const DEFAULT_MODE: SynthesisMode = "deductive";

/**
 * 入力 Atom 群の atomType から候補 mode を推定する。
 *
 * @param atomTypes 入力 Atom の atomType 配列（undefined / 空配列も許容）
 * @param epistemicStatuses Phase η: 入力 Atom / Claim の epistemicStatus 配列（同じ並び、optional）。
 *   候補モード集合自体には影響しない（router は atomType ベースの判定を維持）。
 *   speculation が混じっていれば rationale と `hasSpeculativeInput` でログに残す。
 *   Synthesizer 側で「入力に speculation 含むなら hypothesisStatus="speculative" 強制」を行う
 *   ための補助情報。
 * @returns 候補モード + 推奨モード + rationale
 */
export function routeSynthesisMode(
  atomTypes: (AtomType | undefined)[],
  epistemicStatuses?: (EpistemicStatus | undefined)[],
  /**
   * Phase γ: 入力 Atom / Claim の rebuttalConditions 配列（同じ並び、optional）。
   * 2 件以上が rebuttal を持っている場合、causal でなくても dialectic を候補入りさせる。
   * Toulmin の Rebuttal が「regime separator の素材」として効くため。
   */
  rebuttalConditionsByInput?: (string[] | undefined)[],
): SynthesisRouterResult {
  const known = atomTypes.filter((t): t is AtomType => Boolean(t));

  // 情報が無い／極端に薄い場合は default
  if (known.length === 0) {
    return {
      candidateModes: [DEFAULT_MODE],
      recommendedMode: DEFAULT_MODE,
      rationale: "no atomType signal — falling back to deductive (default).",
    };
  }

  const has = (t: AtomType) => known.includes(t);
  const countOf = (t: AtomType) => known.filter((x) => x === t).length;

  const hasObservational = has("observational");
  const hasCausal = has("causal");
  const hasMechanistic = has("mechanistic");
  const hasMethodological = has("methodological");
  const causalCount = countOf("causal");
  const mechanisticCount = countOf("mechanistic");

  // 候補集合を組み立てる（順序 = プロンプトでの提示順 = 推奨度）
  const candidates: SynthesisMode[] = [];
  const reasons: string[] = [];

  // 1) abductive: observational + (causal | mechanistic) が揃えば最有力
  if (hasObservational && (hasCausal || hasMechanistic)) {
    candidates.push("abductive");
    reasons.push("observational + causal/mechanistic → abductive is the strongest candidate.");
  }

  // 2) dialectic: causal が 2 件以上あれば「逆向き効果ペア」の可能性を残す
  //    LLM が content を見て本物の矛盾なら選び、そうでなければ deductive にフォールバックする
  if (causalCount >= 2) {
    candidates.push("dialectic");
    reasons.push("≥2 causal atoms → dialectic is possible if they argue opposite directions (LLM decides).");
  }

  // 2.5) Phase γ: ≥2 inputs carry Toulmin rebuttalConditions → dialectic を候補入り
  //    causal trigger を満たさなくても、共通の rebuttal axis があれば regime separator として
  //    dialectic が成立しうる。LLM が rebuttal の axis が一致するかを最終判断する。
  if (rebuttalConditionsByInput) {
    const withRebuttal = rebuttalConditionsByInput.filter(
      (rb) => rb && rb.length > 0,
    ).length;
    if (withRebuttal >= 2 && !candidates.includes("dialectic")) {
      candidates.push("dialectic");
      reasons.push(
        `≥2 inputs carry rebuttalConditions (${withRebuttal}) → dialectic candidate added (Toulmin rebuttals can act as regime separators).`,
      );
    }
  }

  // 3) analogical: mechanistic が 2 件以上あれば「異領域ペア」の可能性を残す
  //    LLM が content を見て本当に異領域なら選ぶ
  if (mechanisticCount >= 2) {
    candidates.push("analogical");
    reasons.push("≥2 mechanistic atoms → analogical is possible if domains differ (LLM decides).");
  }

  // 4) deductive: causal / methodological の独立組み合わせは deductive 向き
  if ((hasCausal || hasMethodological) && !candidates.includes("deductive")) {
    candidates.push("deductive");
    reasons.push("causal / methodological combination → deductive (strategy from independent facts).");
  }

  // フォールバック: 何もマッチしなければ deductive を最 permissive モードとして残す
  if (candidates.length === 0) {
    candidates.push(DEFAULT_MODE);
    reasons.push("no specific signal beyond default — falling back to deductive.");
  }

  // Phase η: epistemicStatus 分布を rationale に含める（候補集合自体には影響しない）。
  let hasSpeculativeInput: boolean | undefined;
  if (epistemicStatuses && epistemicStatuses.length > 0) {
    const knownStatuses = epistemicStatuses.filter((s): s is EpistemicStatus => Boolean(s));
    hasSpeculativeInput = knownStatuses.some((s) => s === "speculation");
    if (knownStatuses.length > 0) {
      const counts: Record<string, number> = {};
      for (const s of knownStatuses) counts[s] = (counts[s] ?? 0) + 1;
      const breakdown = Object.entries(counts)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      reasons.push(`epistemic distribution: ${breakdown}.`);
      if (hasSpeculativeInput) {
        reasons.push(
          "speculation present in inputs → Synthesizer should emit hypothesisStatus=\"speculative\" (enforced downstream).",
        );
      }
    }
  }

  return {
    candidateModes: candidates,
    recommendedMode: candidates[0],
    rationale: reasons.join(" "),
    ...(hasSpeculativeInput !== undefined ? { hasSpeculativeInput } : {}),
  };
}
