// Cmd-K Composer の verb メニュー定義（R2）
//
// 引用ブロック（/claims・/Insights）を含むノートで Cmd-K を開いたとき、
// 「引用した知見・洞察の集合を精査する動詞」を提示する。
// LLM 一般論では再現しにくい “集合の精査” が Composer の core 価値（n=1 検証より）。
//
// 構成:
//   - core 3: 矛盾を探す / 抜けを指摘 / 次の検証   （集合精査。打率が高い）
//   - aux  3: 別解 / 反例 / 隣接領域の類例          （発想を広げる。補助）
//
// このモジュールは i18n のキーだけを持つ純データ。ラベル・プロンプト本文は
// src/i18n/{en,ja}.ts の composer.verb.* に置く（locale に合わせて出し分ける）。
// 押下時は promptKey を解決してプロンプト文字列を組み立て、既存 Ask 経路に流す。

/** verb の識別子。PROV-DM 記録（後続 PR）の Activity subtype にもこの id を使う。 */
export type ComposerVerb =
  | "contradiction"
  | "gaps"
  | "next-validation"
  | "alternative"
  | "counterexample"
  | "analogy";

export type VerbDef = {
  id: ComposerVerb;
  /** ボタンラベルの i18n キー */
  labelKey: string;
  /** AI に送るプロンプトテンプレートの i18n キー */
  promptKey: string;
};

/** core verb（集合精査）。前面・上段に置く。 */
export const CORE_VERBS: VerbDef[] = [
  {
    id: "contradiction",
    labelKey: "composer.verb.contradiction",
    promptKey: "composer.verb.prompt.contradiction",
  },
  {
    id: "gaps",
    labelKey: "composer.verb.gaps",
    promptKey: "composer.verb.prompt.gaps",
  },
  {
    id: "next-validation",
    labelKey: "composer.verb.nextValidation",
    promptKey: "composer.verb.prompt.nextValidation",
  },
];

/** aux verb（発想を広げる）。core の下に小さく置く。 */
export const AUX_VERBS: VerbDef[] = [
  {
    id: "alternative",
    labelKey: "composer.verb.alternative",
    promptKey: "composer.verb.prompt.alternative",
  },
  {
    id: "counterexample",
    labelKey: "composer.verb.counterexample",
    promptKey: "composer.verb.prompt.counterexample",
  },
  {
    id: "analogy",
    labelKey: "composer.verb.analogy",
    promptKey: "composer.verb.prompt.analogy",
  },
];

/**
 * verb プロンプトを組み立てる。
 * 任意コメントがあれば末尾に「<label>: <comment>」として付ける。
 *
 * @param promptTemplate t(verb.promptKey) で解決済みのテンプレート本文
 * @param comment        ユーザーが添えた任意コメント（空可）
 * @param commentLabel   t("composer.verb.commentLabel") で解決済みの接頭ラベル
 */
export function buildVerbPrompt(
  promptTemplate: string,
  comment: string,
  commentLabel: string,
): string {
  const trimmed = comment.trim();
  return trimmed ? `${promptTemplate}\n\n${commentLabel}: ${trimmed}` : promptTemplate;
}
