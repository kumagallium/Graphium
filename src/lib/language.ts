// AI 生成（要約・Wiki 化・知見抽出など）の出力言語。
//
// UI 言語（src/i18n の Locale）とは別概念。UI に新しい言語を足しても、その言語での
// 生成をサーバー・MCP・プロンプトが受け付けるまでは生成言語に加えない。
// サーバーや MCP からも import できるよう、React / i18n モジュールには依存しない。
//
// 翻訳（「表示言語へ翻訳」など）の目的言語はここを通さない。翻訳サービスは任意の
// 言語コードを受け付けるので、UI 言語をそのまま渡す。

/** AI 生成の出力言語 */
export type GenerationLanguage = "ja" | "en";

/**
 * UI 言語を生成言語に寄せる境界。
 *
 * ja / en はそのまま。生成に未対応の UI 言語（現在は ko）は en で生成する。
 * ko の生成対応は、サーバーの入力検証・MCP の入力スキーマ・出力言語の指示・スキルの
 * 言語方針を揃えた後で、最後にここを通すようにする。
 */
export function toGenerationLanguage(locale: string): GenerationLanguage {
  return locale === "ja" ? "ja" : "en";
}
