// Knowledge ノード（旧 Wiki）の kind 別カラーパレット。
// network-graph の view.tsx と asset-browser の MediaDetailModal の双方から共有する。
//
// 設計方針（design.md 準拠）:
//  - ブランドグリーン（#4B7A52）と落ち着いた青（#5b8fb9 通常ノート色）の周辺で
//    色相を分散させ、彩度・明度を揃えて凡例の識別性とリストでの落ち着きを両立。
//  - 4 種の kind（summary / atom / claim / synthesis）は実装上の最小単位なので
//    ここで完結させる。atomType / synthesisMode はサブ分類のため色には反映しない。
//  - border はベース色を 15〜20% 暗くしたもの。

import type { WikiKind } from "../../lib/document-types";

/**
 * Knowledge kind 別の塗り色。
 *  - summary  : 紫（要約は Knowledge の中心的存在として既存色を継承）
 *  - atom     : 青緑（原子＝データの粒）
 *  - meta-atom: 青緑をやや深く（atom を集約した中グループの粒、KJ 表札）
 *  - claim    : 紅葉色（主張＝注目）— メディアのゴールド/オレンジと衝突しない色相
 *  - synthesis: 紫紺（統合＝重み）
 */
export const KNOWLEDGE_KIND_COLORS: Record<WikiKind, string> = {
  summary: "#9b6dcc",
  atom: "#6ba89e",
  "meta-atom": "#4d8a80",
  claim: "#c46d56",
  synthesis: "#6c5ca8",
} as const;

/** Knowledge kind 別の border 色（塗りより 15〜20% 暗い） */
export const KNOWLEDGE_KIND_BORDERS: Record<WikiKind, string> = {
  summary: "#7b4fb0",
  atom: "#4f8a80",
  "meta-atom": "#356360",
  claim: "#9b5644",
  synthesis: "#544591",
} as const;

/** kind 未指定 / 不明なときのフォールバック（既存紫色を維持） */
export const KNOWLEDGE_FALLBACK_COLOR = "#9b6dcc";
export const KNOWLEDGE_FALLBACK_BORDER = "#7b4fb0";

/** WikiKind を受け取って塗り色を返す */
export function knowledgeKindColor(kind: WikiKind | undefined): string {
  if (!kind) return KNOWLEDGE_FALLBACK_COLOR;
  return KNOWLEDGE_KIND_COLORS[kind] ?? KNOWLEDGE_FALLBACK_COLOR;
}

/** WikiKind を受け取って border 色を返す */
export function knowledgeKindBorder(kind: WikiKind | undefined): string {
  if (!kind) return KNOWLEDGE_FALLBACK_BORDER;
  return KNOWLEDGE_KIND_BORDERS[kind] ?? KNOWLEDGE_FALLBACK_BORDER;
}

/** 凡例に並べる順序（要約 → 主張 → 原子 → meta-原子 → 統合） */
export const KNOWLEDGE_KIND_LEGEND_ORDER: WikiKind[] = [
  "summary",
  "claim",
  "atom",
  "meta-atom",
  "synthesis",
];
