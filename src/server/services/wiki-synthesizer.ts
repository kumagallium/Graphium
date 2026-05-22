// Wiki Synthesizer
// 既存の Claim ページ群を分析し、複数ページを統合した
// 新しい洞察（Synthesis ページ）を生成する

import type {
  AtomType,
  EpistemicStatus,
  HypothesisStatus,
  SynthesisMode,
} from "../../lib/document-types.js";
import { lowestEpistemicStatus } from "../../lib/document-types.js";
import { buildSynthesizerSystemPromptV2 } from "./synthesis-prompts/index.js";

/** Synthesis の推論モード（提案 v4 Phase 1.3）として認める値の一覧 */
const SYNTHESIS_MODE_VALUES: SynthesisMode[] = [
  "deductive",
  "abductive",
  "analogical",
  "dialectic",
];

/** Synthesis の検証状態として認める値の一覧 */
const HYPOTHESIS_STATUS_VALUES: HypothesisStatus[] = [
  "speculative",
  "tested",
  "confirmed",
  "refuted",
];

export type SynthesisCandidate = {
  /** 統合対象の Claim ID リスト（2-4 個） */
  sourceConceptIds: string[];
  /** 統合対象の Claim タイトル */
  sourceConceptTitles: string[];
  /** 生成する Synthesis のタイトル */
  title: string;
  /** Synthesis のセクション */
  sections: { heading: string; content: string }[];
  /** なぜこの統合が価値あるか */
  rationale: string;
  /** 信頼度 */
  confidence: number;
  /**
   * Synthesis の推論モード（提案 v4 Phase 1.3）。
   * 入力 Claim の関係性から自動推定。認識不能・パース失敗時は undefined。
   */
  synthesisMode?: SynthesisMode;
  /**
   * Synthesis の検証状態。特に abductive 型で意味を持つ。
   * 生成時のデフォルトは "speculative"。
   */
  hypothesisStatus?: HypothesisStatus;
  // procedureContext は意図的に持たない (PR-B4.5)。
  // Synthesis は context-stripped な Atom を編む層であり、手順条件は
  // Claim 層に留め置く。reproducibility は derivedFromNotes / 上流 Claim
  // から on-demand で参照する設計。
};

export type ClaimSnapshot = {
  id: string;
  title: string;
  /**
   * 本文先頭のプレビュー（1ノート1知見前提）。
   * 旧来の sections（見出し + プレビュー配列）から本文プレビュー一本に変更。
   */
  bodyPreview: string;
  /** Claim の抽象度レベル（principle / finding / bridge） */
  level?: "principle" | "finding" | "bridge";
  /** 関連 Claim タイトル */
  relatedClaims: string[];
  /**
   * 上流 Summary のプレビュー（誤差伝搬抑制のため Synthesizer に併読させる）。
   * 空配列でも動作する（後方互換）。
   */
  sourceSummaryPreviews?: { title: string; preview: string }[];
  // PR-B4.5: ClaimSnapshot からも procedureContext を外した。Atomizer /
  // Synthesizer に渡しても下流に持ち越せず、混乱の元になるため。
  // 必要があれば呼び出し側で source Claim から直接取得する。
  /**
   * 入力が Atom の場合の atomType（提案 v4 Phase 1.2）。
   * Synthesis router がモード推定に使う。kind が "claim" の場合は undefined。
   * PR-B5 で追加。
   */
  atomType?: AtomType;
  /**
   * 入力 Atom / Claim の認識論的ステータス（Phase η）。
   * Synthesizer は入力 Atom に speculation が混じっていれば、
   * 出力 Synthesis の hypothesisStatus を speculative に強制する。
   * undefined は legacy データで、 "interpretation" として扱う。
   */
  epistemicStatus?: EpistemicStatus;
  /**
   * 反例条件（Toulmin Rebuttal, Phase γ）。
   * Atomizer は「2+ Claim が共通の rebuttal を持つ」ことを判定して Atom 側へ伝播する。
   * Synthesizer の dialectic 候補抽出（≥2 Atom が rebuttal を持つ）でも使う。
   * 空配列 / undefined は「ノートに rebuttal の記述なし」。
   */
  rebuttalConditions?: string[];
};

/** Ingest 時に適用するスキルの情報 */
export type SynthesizerSkill = {
  title: string;
  prompt: string;
};

/**
 * Synthesis 生成用のシステムプロンプトを構築する。
 *
 * PR-B5 以降は synthesis-prompts/ 配下の mode 別ファイルに委譲する。
 * candidateModes を渡すと、その mode のみの説明が詳細化される。
 * 省略時は全 4 モードを提示する（既存挙動の後方互換）。
 */
export function buildSynthesizerSystemPrompt(
  language: string,
  skills?: SynthesizerSkill[],
  candidateModes?: SynthesisMode[],
  theme?: string,
): string {
  return buildSynthesizerSystemPromptV2({ language, skills, candidateModes, theme });
}

/**
 * Synthesis 用のユーザーメッセージを構築する
 */
export function buildSynthesizerUserMessage(
  concepts: ClaimSnapshot[],
  existingSynthesisTitles: string[],
): string {
  // Synthesis は 2 件以上で成立する（プロンプトでも "two or more concepts" としている）。
  // Discovery 側で 3 件以上に絞りたい場合は、呼び出し元（fetchSynthesisCandidates）で
  // 既に件数ガードを行っているため、ここはサーバー /synthesize の最小要件と一致させる。
  if (concepts.length < 2) {
    return "Not enough Claim pages for synthesis (minimum 2 required).";
  }

  const conceptDescriptions = concepts.map((c) => {
    const levelTag = c.level ? ` [${c.level}]` : "";
    // Phase η: 入力 Atom / Claim の epistemicStatus を可視化する。
    const epistemicTag = c.epistemicStatus ? ` [${c.epistemicStatus}]` : " [interpretation*]";
    const preview = c.bodyPreview ? `  ${c.bodyPreview}` : "";
    const related = c.relatedClaims.length > 0
      ? `  Related to: ${c.relatedClaims.join(", ")}`
      : "";
    const tail = [preview, related].filter(Boolean).join("\n");
    return `### ${c.title}${levelTag}${epistemicTag} (id: ${c.id})${tail ? "\n" + tail : ""}`;
  }).join("\n\n");

  // Phase η: 入力に speculation が含まれる場合、Synthesis を speculative に強制する旨を明示。
  const hasSpeculation = concepts.some((c) => c.epistemicStatus === "speculation");
  const speculationNote = hasSpeculation
    ? `\n\n> **Important (Phase η)**: at least one input above carries \`epistemicStatus: "speculation"\`. The Synthesis you produce MUST set \`hypothesisStatus: "speculative"\` regardless of how confident the wording feels — a synthesis derived from a casual musing is still a casual musing.`
    : "";

  // 上流 Summary のプレビュー（誤差伝搬対策: Synthesizer に原料に近い層も見せる）
  const summaryMap = new Map<string, string>();
  for (const c of concepts) {
    for (const s of c.sourceSummaryPreviews ?? []) {
      if (!summaryMap.has(s.title)) summaryMap.set(s.title, s.preview);
    }
  }
  const summarySection = summaryMap.size > 0
    ? `\n\n## Source Summaries (upstream evidence — cite as [[Summary Title]] when load-bearing)\n${
        Array.from(summaryMap.entries())
          .map(([title, preview]) => `### ${title}\n${preview}`)
          .join("\n\n")
      }`
    : "";

  const existingNote = existingSynthesisTitles.length > 0
    ? `\n\n## Existing Syntheses (avoid duplicating these)\n${existingSynthesisTitles.map((t) => `- ${t}`).join("\n")}`
    : "";

  return `Analyze the following ${concepts.length} Claim pages and propose synthesis opportunities:${speculationNote}\n\n${conceptDescriptions}${summarySection}${existingNote}`;
}

/**
 * Synthesizer の confidence 採用閾値。
 *
 * 設計の変遷:
 * - μ-1: 全 mode 一律 0.85。シンプルで安全側だが deductive の "とりあえず合体" が pass
 *        しやすく、結果として 1-2 件の synth がほぼ deductive 単一 mode で
 *        `mode_distribution_entropy` を 0 に貼り付かせていた。
 * - β 当初案: 全 mode を deductive 0.92 / others 0.85 に。β-1 と一緒に defer。
 * - 現行 (post-η): per-mode 化。deductive を 0.92 で厳しく保ちつつ、
 *   abductive / analogical / dialectic は 0.70 まで下げる。router がもともと
 *   これらの mode を firing condition で絞っているので、threshold を下げても
 *   gambling synthesis にはなりにくい。synth 件数を増やし、entropy が動ける
 *   状態にすることが目的。
 *
 * `DEFAULT_SYNTHESIS_THRESHOLD` は mode 不明出力 (parser が mode を識別できなかった)
 * のフォールバック。歴史的経緯から 0.85 を保つ — mode 不明候補は安全側に倒す。
 */
export const SYNTHESIS_THRESHOLDS: Record<SynthesisMode, number> = {
  deductive: 0.92,
  abductive: 0.7,
  analogical: 0.7,
  dialectic: 0.7,
};

export const DEFAULT_SYNTHESIS_THRESHOLD = 0.85;

function thresholdFor(mode: SynthesisMode | undefined): number {
  if (mode && mode in SYNTHESIS_THRESHOLDS) return SYNTHESIS_THRESHOLDS[mode];
  return DEFAULT_SYNTHESIS_THRESHOLD;
}

/** @deprecated per-mode マップに移行。新規コードでは `DEFAULT_SYNTHESIS_THRESHOLD` か `thresholdFor()` を使う */
export const SYNTHESIS_CONFIDENCE_THRESHOLD = DEFAULT_SYNTHESIS_THRESHOLD;

/**
 * Synthesizer の LLM 出力をパースし、フィルタ理由の統計も返す。
 *
 * 通常の `parseSynthesizerOutput` は `candidates` のみを返すが、regenerate などで
 * 「LLM は候補を出したが confidence ガードで落とされた」ケースを区別したい場面で
 * こちらを使う。トーストの曖昧な "No synthesis generated" を「品質基準未達」と
 * 「LLM が候補を出さなかった」に分ける。
 */
export function parseSynthesizerOutputWithStats(
  text: string,
  /**
   * Phase η: 入力 concept ID → epistemicStatus マップ。指定されると、
   * 入力に speculation が含まれる Synthesis は hypothesisStatus を
   * "speculative" に強制する（lowest-status inheritance の Synthesis 版）。
   * 未指定なら従来通り LLM 出力の hypothesisStatus を採用する。
   */
  conceptIdToEpistemicStatus?: Map<string, EpistemicStatus | undefined>,
): {
  candidates: SynthesisCandidate[];
  rawCount: number;
  droppedByConfidence: number;
  maxDroppedConfidence?: number;
} {
  try {
    let jsonText = text.trim();
    const jsonMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) jsonText = jsonMatch[1].trim();
    const parsed = JSON.parse(jsonText);
    const raw = parsed.candidates ?? parsed;
    if (!Array.isArray(raw)) return { candidates: [], rawCount: 0, droppedByConfidence: 0 };

    let droppedByConfidence = 0;
    let maxDroppedConfidence: number | undefined;
    for (const c of raw) {
      const structurallyOk =
        c?.title &&
        Array.isArray(c.sourceConceptIds) && c.sourceConceptIds.length >= 2 &&
        Array.isArray(c.sections) && c.sections.length > 0;
      if (!structurallyOk) continue;
      const conf = typeof c.confidence === "number" ? c.confidence : 0.7;
      // per-mode threshold (synthesizer-diversity 改修)。mode が出力に無ければ
      // default 0.85 にフォールバックして安全側に倒す。
      const rawMode = typeof c.synthesisMode === "string" ? c.synthesisMode : undefined;
      const mode: SynthesisMode | undefined =
        rawMode && (SYNTHESIS_MODE_VALUES as string[]).includes(rawMode)
          ? (rawMode as SynthesisMode)
          : undefined;
      const threshold = thresholdFor(mode);
      if (conf < threshold) {
        droppedByConfidence += 1;
        if (maxDroppedConfidence === undefined || conf > maxDroppedConfidence) {
          maxDroppedConfidence = conf;
        }
      }
    }
    return {
      candidates: parseSynthesizerOutput(text, conceptIdToEpistemicStatus),
      rawCount: raw.length,
      droppedByConfidence,
      maxDroppedConfidence,
    };
  } catch (err) {
    console.error("Synthesizer 出力の stats パース失敗:", err);
    return { candidates: [], rawCount: 0, droppedByConfidence: 0 };
  }
}

/**
 * Synthesizer の LLM 出力をパースする
 *
 * @param conceptIdToEpistemicStatus Phase η: 入力の status から speculative 強制を行うため。
 *   未指定 (legacy 呼び出し) なら従来通り LLM 出力をそのまま採用する。
 */
export function parseSynthesizerOutput(
  text: string,
  conceptIdToEpistemicStatus?: Map<string, EpistemicStatus | undefined>,
): SynthesisCandidate[] {
  try {
    let jsonText = text.trim();
    const jsonMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonText);
    const candidates = parsed.candidates ?? parsed;

    if (!Array.isArray(candidates)) return [];

    return candidates
      .filter((c: any) => {
        if (!c.title) return false;
        if (!Array.isArray(c.sourceConceptIds) || c.sourceConceptIds.length < 2) return false;
        if (!Array.isArray(c.sections) || c.sections.length === 0) return false;
        // per-mode threshold: deductive は 0.92 で厳しく、他は 0.70 まで通す。
        // 出力に mode が無ければ default (0.85) フォールバック。
        const conf = typeof c.confidence === "number" ? c.confidence : 0.7;
        const rawMode = typeof c.synthesisMode === "string" ? c.synthesisMode : undefined;
        const mode: SynthesisMode | undefined =
          rawMode && (SYNTHESIS_MODE_VALUES as string[]).includes(rawMode)
            ? (rawMode as SynthesisMode)
            : undefined;
        return conf >= thresholdFor(mode);
      })
      .map((c: any) => {
        const rawMode = typeof c.synthesisMode === "string" ? c.synthesisMode : undefined;
        const synthesisMode: SynthesisMode | undefined =
          rawMode && (SYNTHESIS_MODE_VALUES as string[]).includes(rawMode)
            ? (rawMode as SynthesisMode)
            : undefined;

        const rawStatus = typeof c.hypothesisStatus === "string" ? c.hypothesisStatus : undefined;
        let hypothesisStatus: HypothesisStatus | undefined =
          rawStatus && (HYPOTHESIS_STATUS_VALUES as string[]).includes(rawStatus)
            ? (rawStatus as HypothesisStatus)
            : synthesisMode
              ? "speculative" // モード判定できているのに status 欠落は speculative にフォールバック
              : undefined;
        // Phase η: 入力 concept に speculation が含まれていれば hypothesisStatus を
        // "speculative" に強制する（lowest-status inheritance の Synthesis 版）。
        // LLM が "tested" / "confirmed" を出していても、speculation 入力からの Synthesis は
        // 構造的に speculative に固定する。
        if (conceptIdToEpistemicStatus && conceptIdToEpistemicStatus.size > 0) {
          const sourceIds = Array.isArray(c.sourceConceptIds)
            ? c.sourceConceptIds.map(String)
            : [];
          const sourceStatuses = sourceIds.map((id: string) =>
            conceptIdToEpistemicStatus.get(id),
          );
          const lowest = lowestEpistemicStatus(sourceStatuses);
          if (lowest === "speculation") {
            hypothesisStatus = "speculative";
          }
        }

        return {
          sourceConceptIds: c.sourceConceptIds.map(String),
          sourceConceptTitles: Array.isArray(c.sourceConceptTitles) ? c.sourceConceptTitles.map(String) : [],
          title: String(c.title),
          sections: c.sections.map((s: any) => ({
            heading: String(s.heading ?? ""),
            content: String(s.content ?? ""),
          })),
          rationale: String(c.rationale ?? ""),
          confidence: typeof c.confidence === "number" ? c.confidence : DEFAULT_SYNTHESIS_THRESHOLD,
          synthesisMode,
          hypothesisStatus,
        };
      });
  } catch (err) {
    console.error("Synthesizer 出力のパース失敗:", err);
    return [];
  }
}
