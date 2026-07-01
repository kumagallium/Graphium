// AI 問い合わせ時に「AI に渡す grounding の範囲」を切り替えるスコープ。
//
// - "overview"（発散）: @引用したもの ＋ 質問からの横断検索（関連ナレッジ・派生知識）。
//   多文献を横断する着想・構成向け（デフォルト）
// - "primary"（収束）: @引用したものだけ（横断検索・派生知識を除外）。
//   正確な引用が要る執筆・引用・検証向け
//
// 「引用したもの」は種類を問わない（原文/ノート/ナレッジ/メモ、@で明示引用したもの全て）。
//
// 詳細: docs/internal/citation-grounding-scope-design-2026-06.md
//
// Composer（UI）と ai-assistant（grounding 組み立て）の双方が参照するため、
// feature をまたぐ単一定義としてここ（lib）に置く。
export type GroundingScope = "overview" | "primary";

/** UI・配線のデフォルト。既存挙動（発散）を保つ。 */
export const DEFAULT_GROUNDING_SCOPE: GroundingScope = "overview";
