// AI 生成（要約・Wiki 化・知見抽出など）の出力言語。
//
// UI 言語（src/i18n の Locale）とは別概念。サーバーや MCP からも import できるよう、
// React / i18n モジュールには依存しない。
//
// 翻訳（「表示言語へ翻訳」など）の目的言語はここを通さない。翻訳サービスは任意の
// 言語コードを受け付けるので、UI 言語をそのまま渡す。
// 会議の清書は発話の言語を保つ（出力言語を指定しない）。

/** AI 生成の出力言語 */
export type GenerationLanguage = "ja" | "en" | "ko";

export const GENERATION_LANGUAGES: readonly GenerationLanguage[] = ["ja", "en", "ko"];

export function isGenerationLanguage(value: unknown): value is GenerationLanguage {
  return typeof value === "string" && (GENERATION_LANGUAGES as readonly string[]).includes(value);
}

/**
 * 外から来た値を生成言語に寄せる（API・MCP の入力、保存済みメタデータ）。
 * 対応外・不明な値は fallback（既定 en）にする。
 */
export function normalizeGenerationLanguage(value: unknown, fallback: GenerationLanguage = "en"): GenerationLanguage {
  return isGenerationLanguage(value) ? value : fallback;
}

const LANGUAGE_NAMES: Record<GenerationLanguage, string> = {
  ja: "Japanese",
  en: "English",
  ko: "Korean",
};

/** プロンプトの「Output in: …」に書く英語の言語名。不明な値は English */
export function generationLanguageName(language: string): string {
  return LANGUAGE_NAMES[normalizeGenerationLanguage(language)];
}

/**
 * UI 言語を生成言語に寄せる境界。
 *
 * 生成に対応した言語（ja / en / ko）はそのまま。対応外の UI 言語は en で生成する。
 * 新しい UI 言語を生成に対応させるときは、サーバーの入力検証・MCP の入力スキーマ・
 * 出力言語の指示（generationLanguageName）・スキルの言語方針を揃えてから
 * GENERATION_LANGUAGES に足す（ここは最後に効く）。
 */
export function toGenerationLanguage(locale: string): GenerationLanguage {
  return normalizeGenerationLanguage(locale);
}

/**
 * チャットの返答言語の指示。AI チャットに渡す前置きは日本語固定のため、ko では返答言語を
 * 明示する。ja / en は従来どおり指示しない（空文字）。
 */
export function chatReplyLanguageInstruction(language: string): string {
  if (language !== "ko") return "";
  return "## Reply language\nReply in Korean (the user's display language), even when the notes, quotes or preambles above are in Japanese or English, unless the user asks for another language. Keep quoted text, titles, code and citation markers as they are.";
}
