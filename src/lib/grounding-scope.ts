// AI 問い合わせ時に「AI に渡す grounding の範囲」を切り替えるスコープ。
//
// 世界(known/unknown) × 自分(known/unknown) の 4 象限に対応する 3 スコープ
// （発想 = 両 unknown は人間の領域として意図的に空けてある）:
//
// - "external"（外部参照 / 調査 = 世界 known × 自分 unknown）:
//   引用＋横断検索に加えて Web 検索を強制し、世界の known を取り込む。
// - "internal"（内部参照 / 知識の蓄積 = 世界 known × 自分 known）:
//   @引用したもの ＋ 蓄積した知識の横断検索（関連ナレッジ・派生知識）。
//   多文献を横断する着想・構成向け。旧 "overview"（発散）。
// - "notes"（ノート内参照 / 文章化 = 世界 unknown × 自分 known）:
//   @引用したものだけ（横断検索・派生知識を除外）。
//   正確な引用が要る執筆・引用・検証向け（デフォルト）。旧 "primary"（収束）。
//
// 包含関係は notes ⊂ internal ⊂ external の単調拡大。
// 「引用したもの」は種類を問わない（原文/ノート/ナレッジ/メモ、@で明示引用したもの全て）。
//
// 詳細: docs/internal/citation-grounding-scope-design-2026-06.md
//
// Composer（UI）と ai-assistant（grounding 組み立て）の双方が参照するため、
// feature をまたぐ単一定義としてここ（lib）に置く。
export type GroundingScope = "external" | "internal" | "notes";

/** UI・配線のデフォルト。ノート内参照（@引用したものだけ）で始める。 */
export const DEFAULT_GROUNDING_SCOPE: GroundingScope = "notes";

/** 横断検索（wikiContext・派生知識）を行うか。notes（ノート内参照）だけが引用のみに絞る。 */
export function includesCrossSearch(scope: GroundingScope): boolean {
  return scope !== "notes";
}

/** Web 検索を強制するか（外部参照のみ）。 */
export function forcesWebSearch(scope: GroundingScope): boolean {
  return scope === "external";
}
