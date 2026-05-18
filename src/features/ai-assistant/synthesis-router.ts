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

import type { AtomType, SynthesisMode } from "../../lib/document-types.js";

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
};

const DEFAULT_MODE: SynthesisMode = "deductive";

/**
 * 入力 Atom 群の atomType から候補 mode を推定する。
 *
 * @param atomTypes 入力 Atom の atomType 配列（undefined / 空配列も許容）
 * @returns 候補モード + 推奨モード + rationale
 */
export function routeSynthesisMode(
  atomTypes: (AtomType | undefined)[],
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

  // 1) abductive: Phase β で発火条件を緩めた。観測 Atom が混ざっていれば
  //    candidate Atom の総数が 2 件以上ある時点で候補に入れる。LLM 側で
  //    実際に「観測 + 仮説」の論理が成り立つか判断する。
  if (hasObservational && known.length >= 2) {
    candidates.push("abductive");
    reasons.push("observational + ≥1 other atomType (known ≥2) → abductive is the strongest candidate.");
  }

  // 2) dialectic: causal が 2 件以上あれば「逆向き効果ペア」の可能性を残す
  //    LLM が content を見て本物の矛盾なら選び、そうでなければ deductive にフォールバックする
  if (causalCount >= 2) {
    candidates.push("dialectic");
    reasons.push("≥2 causal atoms → dialectic is possible if they argue opposite directions (LLM decides).");
  }

  // 3) analogical: mechanistic が 2 件以上あれば「異領域ペア」の可能性を残す
  //    LLM が content を見て本当に異領域なら選ぶ
  if (mechanisticCount >= 2) {
    candidates.push("analogical");
    reasons.push("≥2 mechanistic atoms → analogical is possible if domains differ (LLM decides).");
  }

  // 4) deductive: causal / methodological の独立組み合わせは deductive 向き。
  //
  // Phase β で当初は「他モードが候補に入っていたら deductive を外す」設計だったが、
  // n=3 の経験的ベンチでは synthesis_count が小さく (n=1-2) deductive を外しても
  // 単一モードに貼り付くだけで entropy が改善しなかった。むしろ「他モードが推奨
  // されつつも deductive を fallback として残す」古い挙動のほうが synth 件数を
  // 確保できる場合があったため、Phase β-revised では deductive 共起を許す形に
  // 戻している。Phase μ-2 で corpus が拡張され synth 件数が増えたら再評価する。
  if ((hasCausal || hasMethodological) && !candidates.includes("deductive")) {
    candidates.push("deductive");
    reasons.push("causal / methodological combination → deductive (strategy from independent facts).");
  }

  // フォールバック: 何もマッチしなければ deductive を最 permissive モードとして残す
  if (candidates.length === 0) {
    candidates.push(DEFAULT_MODE);
    reasons.push("no specific signal beyond default — falling back to deductive.");
  }

  return {
    candidateModes: candidates,
    recommendedMode: candidates[0],
    rationale: reasons.join(" "),
  };
}
