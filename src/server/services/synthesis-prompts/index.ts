// Synthesis system prompt composer (PR-B5)
//
// 共通部分 (common.ts) と mode 別の説明 (deductive/abductive/analogical/dialectic.ts)
// を組み合わせて、候補モードに応じた system prompt を構築する。
//
// 呼び出し元 (wiki.ts /synthesize) は synthesis-router から候補モード配列を受け取り、
// その配列を candidateModes として渡す。配列が空または全 4 モードのときは、
// 既存 (PR-B4 まで) と同じ「LLM が 4 モードから自由に選ぶ」プロンプトになる。

import type { SynthesisMode } from "../../../lib/document-types.js";
import {
  buildGuidelines,
  buildLanguageDirective,
  buildThemeLensSection,
  buildVoiceSection,
  CITATION_RULES,
  HYPOTHESIS_STATUS_RULES,
  INDUCTION_NOT_HERE,
  OUTPUT_FORMAT,
  PROMPT_HEADER,
  SYNTHESIS_DEFINITION,
  SYNTHESIS_NO_PROCEDURE_CONTEXT,
} from "./common.js";
import { ABDUCTIVE_DESCRIPTION, ABDUCTIVE_MODE_NAME } from "./abductive.js";
import { ANALOGICAL_DESCRIPTION, ANALOGICAL_MODE_NAME } from "./analogical.js";
import { DEDUCTIVE_DESCRIPTION, DEDUCTIVE_MODE_NAME } from "./deductive.js";
import { DIALECTIC_DESCRIPTION, DIALECTIC_MODE_NAME } from "./dialectic.js";
import type { SynthesizerSkill } from "./types.js";

export type { SynthesizerSkill } from "./types.js";

/** mode → 説明テキスト */
const MODE_DESCRIPTIONS: Record<SynthesisMode, string> = {
  [DEDUCTIVE_MODE_NAME]: DEDUCTIVE_DESCRIPTION,
  [ABDUCTIVE_MODE_NAME]: ABDUCTIVE_DESCRIPTION,
  [ANALOGICAL_MODE_NAME]: ANALOGICAL_DESCRIPTION,
  [DIALECTIC_MODE_NAME]: DIALECTIC_DESCRIPTION,
};

const ALL_MODES: SynthesisMode[] = [
  DEDUCTIVE_MODE_NAME,
  ABDUCTIVE_MODE_NAME,
  ANALOGICAL_MODE_NAME,
  DIALECTIC_MODE_NAME,
];

function normalizeCandidateModes(modes: SynthesisMode[] | undefined): SynthesisMode[] {
  if (!modes || modes.length === 0) return ALL_MODES;
  // 重複除去 + 既知 mode のみ + 安定順序
  const allowed = new Set(modes);
  return ALL_MODES.filter((m) => allowed.has(m));
}

function buildModeSection(candidateModes: SynthesisMode[]): string {
  const intro = candidateModes.length === ALL_MODES.length
    ? `## Synthesis mode (Phase 1.3 — read this carefully)

Tag every candidate with **one** \`synthesisMode\` that names the kind of reasoning that produced it. This is an important field: it captures *how* the new insight is grounded, not just that it exists.`
    : `## Synthesis mode (Phase 1.3 — read this carefully)

Based on the input Claims' \`atomType\` distribution, the following modes are the most plausible fits for this run. **Pick the single best mode from this candidate set.** If none fit, fall back to \`deductive\` and explain in the rationale why no other mode applied.

Candidate modes: ${candidateModes.map((m) => `\`${m}\``).join(", ")}`;

  const descriptions = candidateModes.map((m) => MODE_DESCRIPTIONS[m]).join("\n\n");

  const generalRules = `### General selection rules (all modes)

- Pick the most informative single mode. Don't multi-label.
- If the candidate is "A and B both say the same thing, so probably true" — that is **not** a Synthesis, it's a restatement. Drop it.`;

  return [intro, descriptions, generalRules].join("\n\n");
}

export type BuildSystemPromptOptions = {
  language: string;
  skills?: SynthesizerSkill[];
  /**
   * synthesis-router から渡される候補モード。
   * 空配列 / undefined のときは全 4 モードを提示する（後方互換）。
   */
  candidateModes?: SynthesisMode[];
  /**
   * テーマ（人間が指定した lens）。指定があれば、theme lens セクションが
   * PROMPT_HEADER の直後に挿入され、出力をテーマの語彙・読者層に書き直すよう
   * モデルに強く要求する（2026-05-23 theme-driven Synthesizer）。
   * 未指定（旧フロー）なら従来動作を保つ。
   */
  theme?: string;
};

/**
 * 4 モード対応の Synthesizer system prompt を構築する。
 * candidateModes を絞ると、その mode のみが詳細説明される。
 * theme が指定されると、テーマ lens セクションを挿入する。
 */
export function buildSynthesizerSystemPromptV2(opts: BuildSystemPromptOptions): string {
  const { language, skills, candidateModes, theme } = opts;
  const modes = normalizeCandidateModes(candidateModes);

  const themeSection = buildThemeLensSection(theme, language);

  return [
    PROMPT_HEADER,
    // テーマ lens は HEADER の直後に置く: モードや citation rule よりも上流に
    // 効かせて、最初から出力の register を theme 側に倒す。
    ...(themeSection ? [themeSection] : []),
    buildVoiceSection(language, skills),
    SYNTHESIS_DEFINITION,
    OUTPUT_FORMAT,
    SYNTHESIS_NO_PROCEDURE_CONTEXT,
    buildModeSection(modes),
    INDUCTION_NOT_HERE,
    HYPOTHESIS_STATUS_RULES,
    CITATION_RULES,
    buildGuidelines(language),
    buildLanguageDirective(language),
  ].join("\n\n");
}
