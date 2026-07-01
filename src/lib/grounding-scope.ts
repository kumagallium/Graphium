// AI 問い合わせ時に「引用資料のどの層を grounding として渡すか」のスコープ。
// 資料3層モデル（素材=一次 / ノート=二次 / knowledge=索引）に対応する。
//
// - "overview"（俯瞰）: 派生知識 + Wiki を含めて広く渡す。多文献を横断する着想・構成向け（デフォルト）
// - "primary"（原典）: 派生知識・Wiki（LLM が抽象化した二次的な索引）を除外し、原文＋派生メモに
//   絞る。正確な引用が要る執筆・引用・検証向け（ハルシネーション最小）
//
// 詳細: docs/internal/citation-grounding-scope-design-2026-06.md
//
// Composer（UI）と ai-assistant（grounding 組み立て）の双方が参照するため、
// feature をまたぐ単一定義としてここ（lib）に置く。
export type GroundingScope = "overview" | "primary";

/** UI・配線のデフォルト。既存挙動（俯瞰）を保つ。 */
export const DEFAULT_GROUNDING_SCOPE: GroundingScope = "overview";
