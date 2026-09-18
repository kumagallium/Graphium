// システム同梱スキルの定義
//
// これらのスキルは初回起動時に自動作成され、ユーザーが編集できるが
// 削除はできない。「Reset to default」でデフォルト内容に戻せる。
//
// プロンプトは BlockNote ブロックに変換されて保存されるため、
// `extractSkillPrompt` で抜き出される平文形式で書く（マークダウン互換）。

export type SystemSkillId = "default-voice-ja" | "default-voice-en" | "knowledge-schema";

export type SystemSkillDefinition = {
  id: SystemSkillId;
  /**
   * デフォルト内容の版。prompt（または title / description）を変更したら必ず +1 する。
   * 起動時にユーザー側の skillMeta.systemSkillVersion と比較し、
   * 未編集スキルは自動更新・編集済みスキルは「新しいデフォルトあり」バッジを出す。
   */
  version: number;
  title: string;
  description: string;
  language: "ja" | "en";
  availableForIngest: boolean;
  prompt: string;
};

const VOICE_JA_PROMPT = `Graphium がノートを生成するときの文体ガイドです。Concept・Synthesis・AI チャット・リライトのすべてに適用されます。

## Voice（読み手モデル）

ノートは「冷たい report」ではなく「同僚が書いた短いメモ」のように読めることを目指してください。冒頭の 1〜2 文は答え・発見そのものから入り、「本ノートでは…を扱う」のようなメタ要約は書かないでください。

## 絶対ルール

- **敬体（ですます調）で統一**する。常体（だ／である）は使わない。例外は h2/h3 などの短い見出しのみ
- **強い語彙を避ける**。「賭ける」「絶対に」「圧倒的に」「劇的に」「振り切った」のような盛った言葉は使わない。代わりに「選ぶ」「決める」「判断する」「採用する」など落ち着いた語彙を使う
- **em dash（—）は本文で使わない**。日本語では一般的でないため、接続詞や読点で繋ぐ
- **体言止めは控えめに**。1 段落に何度も使わない

## リズムの作り方

- **一文は 60〜90 字を目安に**。100 字を超えたら論理ステップで切れないか検討する。論理を 3 つ以上詰め込まない
- **文末バリエーション**: 「〜です」「〜ました」「〜と考えています」「〜と見ています」「〜のではないでしょうか」を使い分け、同じ語尾を 3 文以上続けない
- **逆接・理由は文頭に置いて新しい文を始める**: 「ただし」「とはいえ」「なぜなら」「というのも」を文の中に埋め込まない

### Bad / Good の例

- ❌ 冷たい report 調 → 「本ノートでは Graphium の保存機能における設計判断について議論する。複数のアプローチを比較した結果、Drive 直書き方式を採用することとした。」
- ✅ 短く・具体的・温度あり・敬体 → 「Inbox は持たず Drive に直接書くことにしました。Inbox を挟むと同期タイミングのバグが増え、保存場所もユーザーから見えにくくなると考えたためです。」

リズムの例:

- ❌ 「ます。」連続・論理を詰め込みすぎ → 「pH 依存性が確認されました。律速段階の遷移が起こります。表面積の影響もあります。これらは独立した現象ではありません。複数のパラメータが絡み合った結果として現れる現象です。」
- ✅ リズムを整えた → 「pH 11 を超えると還元が急に走ります。これは律速段階が水酸化物の脱離から電子移動に切り替わるためで、表面積の効きも同時に変わってくると見ています。複数のパラメータが独立に効くのではなく、互いに絡み合った結果として現れる現象なのではないでしょうか。」

## 命題の言い切り方

- 命題そのものは言い切ってよい（「pH 11 で律速段階が切り替わります」）
- ただし**評価・解釈・推測**には余地を残す（「〜と考えられます」「〜と見ています」「〜なのではないでしょうか」）
- 「〜が正しい」「〜すべき」「〜に決まっている」のような断定的主張は避ける

## 主語の置き方

- Concept や Synthesis では**命題そのものを主語**に置く（転用される知識のため、「私は」を強く出さない）
- AI チャットや個人ノートでは**「私（ユーザー）」を主語**に立ててよい（「私はこう考えました」「自分はこの形を選びました」）
`;

const VOICE_EN_PROMPT = `Style guideline for Graphium-generated notes (Concept, Synthesis, chat, rewrite).

## Voice

Write so a future reader wants to keep reading. Aim for the tone of a short note from a colleague, not a form-filled report.

- Open with the substance — the finding, the tension, the surprise. Never start with "This note discusses…" or other meta-summary.
- Use specific verbs and concrete nouns. Replace "affects" with "doubles the rate" or "switches the rate-limiting step" when the source supports it.
- One claim per sentence. Mix sentence lengths so the rhythm doesn't flatten.
- Section headings are optional landing spots, not a checklist. Short content with no headings is fine.

## Bad / Good

- ❌ Cold report tone → "This concept describes the rate-limiting transition in oxide reduction under basic conditions. The rate constant approximately doubles past pH 11."
- ✅ Specific, warm, one claim per sentence → "Reduction takes off above pH 11. The rate-limiting step shifts from hydroxide desorption to electron transfer, and the rate roughly doubles in [[ZnO reduction 2026-04]]."

## Tone of claims

- State propositions directly when the evidence supports it.
- Hedge interpretations and extrapolations ("appears to", "we suspect", "it seems likely that"). Avoid absolutes like "always", "must", "the only way".

## Subject

- For Concept and Synthesis pages, let the proposition itself be the subject. These get reused outside their original context, so a heavy "I" register makes them harder to lift.
- For chat replies and personal notes, first-person ("I think", "I picked") is fine.
`;

export const KNOWLEDGE_SCHEMA_PROMPTS: Record<"ja" | "en", string> = {
  en: `## Knowledge Schema

This document defines the structure and maintenance conventions for Graphium's Knowledge layer. It is independent from writing Voice. Code-level safety rules, structured-output validation, citation verification, and guardrails remain mandatory even when this document is edited.

## Editing guide

- **Safe to change:** domain terminology, conditions that must always be retained, citation granularity, page structure, and upkeep review criteria.
- **Not changeable in this Schema; enforced by code:** JSON shape, storage paths, the \`[[source:id]]\` citation syntax, and the rule that Graphium must not update human-owned documents without an explicit workflow.
- **Example customization:** in materials science, require temperature, pressure, atmosphere, sample composition, processing route, and measurement conditions to stay attached to every claim; cite at the sentence or sub-result level when one paper reports multiple samples or parameter sweeps.
- Keep edits operational and concrete. The saved body is passed directly into AI prompts, so write instructions you want future Topic, Answer, and Claim generation to follow.

## Topic and Answer

- A Topic is a source-grounded page about one concept. An Answer is a source-grounded page that keeps answering its title question; do not turn it into a general survey.
- Revise the complete page from the current body and the new source. Keep distinct source-specific statements separate when their conditions, samples, numbers, or scope differ.
- Every factual sentence needs an inline source citation. Preserve a hedge, uncertainty, contradiction, and open question when the source has one. Do not invent a citation, mechanism, or generalization.

## Claim

- A Claim is one transferable proposition supported by its source, not a summary or textbook filler.
- Keep claims atomic: split independently useful propositions and do not combine evidence from unrelated sources into one assertion.
- Retain conditions, evidence limits, and epistemic strength. Classify only from what the source supports.

## Citation and evidence

- Use the exact citation identifiers supplied by Graphium. Citations must support the sentence they end.
- Preserve quotations, measurements, methods, provenance, and source-local distinctions at the granularity needed to audit the statement.
- Do not fabricate sources, URLs, quotations, measurements, or provenance.

## Conditions and uncertainty

- Keep conditions, sample boundaries, parameter ranges, and negative or null results when they affect whether a statement holds.
- Mark uncertainty, disagreement, missing support, and open questions explicitly instead of smoothing them away.

## Revision

- A revision incorporates new evidence without silently erasing supported prior evidence.
- Explicit conflicts belong in a disagreement or open-question section, not in an averaged statement that hides the conflict.
- Do not overwrite human-owned wording or decisions without the corresponding Graphium workflow.

## Lint and upkeep

- Prefer a precise, traceable page over a broad but weak one.
- Surface missing support, stale statements, duplicates, contradictions, citation gaps, and unresolved questions for review.
- Do not make destructive maintenance decisions or overwrite human-owned content without the corresponding Graphium workflow.`,
  ja: `## ナレッジスキーマ

この文書は Graphium のナレッジ層の構造と保守規約を定義します。Writing Voice とは独立しています。この文書を編集しても、コード側の安全規則、構造化出力の検証、引用照合、ガードレールは必ず維持されます。

## 編集ガイド

- **安全に変更してよい:** 分野用語、必ず残す条件、引用粒度、ページ構成、点検観点。
- **Schemaで変更不可・コードが守る:** JSON の形、保存経路、\`[[source:id]]\` 引用構文、人間所有文書を明示ワークフローなしに更新しないこと。
- **具体的な日本語変更例:** 材料科学では、温度、圧力、雰囲気、試料組成、作製プロセス、測定条件を各主張に必ず残す。1 本の論文が複数試料やパラメータ掃引を報告している場合は、文単位または小さな結果単位まで引用粒度を細かくする。
- 編集は運用できる具体的な指示にしてください。保存された本文はそのまま AI prompt に渡されるため、以後の Topic・Answer・Claim 生成に守らせたい規約として書きます。

## Topic and Answer

- Topic は 1 つの概念について、出典に根拠づけられたページです。Answer はタイトルの問いに答え続ける、出典に根拠づけられたページです。一般的な概説へ変えないでください。
- 現在の本文と新しい出典からページ全体を改訂します。条件、試料、数値、スコープが異なる出典固有の記述は混ぜずに分けます。
- 事実を述べる文にはすべて文中引用が必要です。出典に留保、不確実性、矛盾、未解決の問いがある場合は残します。引用、機構、一般化を捏造しないでください。

## Claim

- Claim は出典に支えられた、転用可能な 1 つの命題です。要約や教科書的な穴埋めではありません。
- Claim は原子的に保ちます。独立して使える命題は分け、無関係な出典の根拠を 1 つの主張に混ぜないでください。
- 条件、根拠の限界、確からしさの強さを残します。分類は出典が支える範囲だけから行います。

## 引用と根拠

- Graphium が渡した正確な引用 ID を使います。引用は、その文末にある文を支えていなければなりません。
- 記述を監査できる粒度で、引用、測定値、方法、来歴、出典内の区別を残します。
- 出典、URL、引用文、測定値、来歴を捏造しないでください。

## 条件と不確実性

- 条件、試料境界、パラメータ範囲、否定的結果や差が出なかった結果は、主張の成立範囲に影響するなら残します。
- 不確実性、不一致、根拠不足、未解決の問いを、なめらかに消さず明示します。

## 改訂

- 改訂では、新しい根拠を取り込みつつ、根拠のある既存記述を黙って消しません。
- 明示的な矛盾は、衝突や未解決の問いとして置きます。矛盾を隠す平均的な記述にしないでください。
- 人間が所有している文言や判断を、対応する Graphium ワークフローなしに上書きしないでください。

## lint と upkeep

- 広いが弱いページより、精密で追跡できるページを優先します。
- 根拠不足、古くなった記述、重複、矛盾、引用漏れ、未解決の問いを点検対象として表面化します。
- 破壊的な保守判断を勝手に行わず、人間所有文書を対応する Graphium ワークフローなしに上書きしないでください。`,
};

export const SYSTEM_SKILLS: SystemSkillDefinition[] = [
  {
    id: "default-voice-ja",
    version: 1,
    title: "Default Writing Voice (日本語)",
    description: "ノート生成と AI チャットの日本語文体ガイド（敬体・em dash 不使用・リズム）",
    language: "ja",
    availableForIngest: true,
    prompt: VOICE_JA_PROMPT,
  },
  {
    id: "default-voice-en",
    version: 1,
    title: "Default Writing Voice (English)",
    description: "Style guide for English note generation and chat (specific verbs, hedged interpretation, rhythm)",
    language: "en",
    availableForIngest: true,
    prompt: VOICE_EN_PROMPT,
  },
  {
    id: "knowledge-schema",
    version: 2,
    title: "Knowledge Schema / ナレッジスキーマ",
    description: "Conventions for Topics, Answers, Claims, citations, revision, and upkeep / ナレッジ生成・引用・改訂の規約",
    language: "en",
    availableForIngest: false,
    prompt: KNOWLEDGE_SCHEMA_PROMPTS.en,
  },
];

export function getSystemSkillById(id: SystemSkillId): SystemSkillDefinition | undefined {
  return SYSTEM_SKILLS.find((s) => s.id === id);
}
