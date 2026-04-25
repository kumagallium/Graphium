// AI 出力に含まれるコンテキストラベルマーカーをパースするユーティリティ
//
// AI には system prompt で `[[label:procedure]]` のようなマーカーを
// 各ブロック先頭に置くよう指示する（buildLabeledOutputInstruction 参照）。
// 挿入時にこのモジュールでマーカーを剥がし、ブロックパスと CoreLabel の
// 対応リストに変換して labelStore に流し込む。

import type { CoreLabel } from "../context-label/labels";
import { CORE_LABELS } from "../context-label/labels";

const CORE_LABEL_SET = new Set<string>(CORE_LABELS);

// 行頭のマーカーを 1 つだけ消費する正規表現。
// 末尾の半角空白／全角空白を最大 1 つまで一緒に剥がす。
const LEADING_MARKER_RE = /^\[\[label:([a-z]+)\]\][ 　]?/;

export type ExtractedLabel = {
  /** ルートからの index 配列（[3, 0, 1] = blocks[3].children[0].children[1]） */
  path: number[];
  label: CoreLabel;
};

/**
 * BlockNote ブロック配列を再帰的に走査してマーカーを剥がす。
 * - 引数の blocks は破壊的に変更しない（新しいブロック配列を返す）
 * - 1 ブロックにつき先頭マーカー 1 個まで対象
 *
 * 戻り値:
 *   blocks: マーカーを剥がしたブロック配列
 *   labels: 適用すべき [path, label] のリスト
 */
export function extractLabelMarkersFromBlocks(blocks: any[]): {
  blocks: any[];
  labels: ExtractedLabel[];
} {
  const labels: ExtractedLabel[] = [];

  const walk = (nodes: any[], parentPath: number[]): any[] =>
    nodes.map((node, idx) => {
      const path = [...parentPath, idx];
      const next = stripMarkerFromBlock(node);
      if (next.label) {
        labels.push({ path, label: next.label });
      }
      const children = Array.isArray(node?.children) ? node.children : null;
      if (children && children.length > 0) {
        return { ...next.block, children: walk(children, path) };
      }
      return next.block;
    });

  return { blocks: walk(blocks, []), labels };
}

/**
 * 1 ブロックの先頭テキストからマーカーを 1 つ剥がす。
 * - content が文字列のブロック（例: BlockNote 既定段落）／配列のブロックの両方に対応
 * - マーカーが見つからない・解釈できないラベルの場合は元のブロックをそのまま返す
 */
function stripMarkerFromBlock(block: any): { block: any; label: CoreLabel | null } {
  if (!block) return { block, label: null };
  const content = block.content;

  // content が文字列（一部のカスタムブロック）
  if (typeof content === "string") {
    const m = content.match(LEADING_MARKER_RE);
    if (!m) return { block, label: null };
    const label = normalizeMarkerLabel(m[1]);
    if (!label) return { block, label: null };
    const stripped = content.slice(m[0].length);
    return { block: { ...block, content: stripped }, label };
  }

  // content が InlineContent 配列
  if (!Array.isArray(content) || content.length === 0) {
    return { block, label: null };
  }
  const first = content[0];
  if (!first || first.type !== "text" || typeof first.text !== "string") {
    return { block, label: null };
  }
  const m = first.text.match(LEADING_MARKER_RE);
  if (!m) return { block, label: null };
  const label = normalizeMarkerLabel(m[1]);
  if (!label) return { block, label: null };

  const newFirstText = first.text.slice(m[0].length);
  let newContent: any[];
  if (newFirstText.length === 0 && content.length > 1) {
    // 先頭テキストが空になったらインライン要素自体を取り除く
    newContent = content.slice(1);
  } else {
    newContent = [{ ...first, text: newFirstText }, ...content.slice(1)];
  }
  return { block: { ...block, content: newContent }, label };
}

function normalizeMarkerLabel(raw: string): CoreLabel | null {
  const lower = raw.toLowerCase();
  return CORE_LABEL_SET.has(lower) ? (lower as CoreLabel) : null;
}

/**
 * AI への system prompt に追加するラベル付き出力の指示文。
 * 既存のシステムプロンプト末尾に append される想定。
 *
 * 同一文言を server 側 (src/server/routes/agent.ts) からも参照する。
 * features → server の片方向依存は避けたいので、ここは pure 関数として
 * frontend / backend どちらからも安全にインポートできるよう保つ。
 */
export function buildLabeledOutputInstruction(language: "en" | "ja" | string): string {
  if (language === "ja") {
    return `

## 構造化出力（PROV グラフ生成）
回答に「実験手順」「材料」「ツール」「条件」「結果」が含まれる場合、Graphium が PROV グラフを自動生成できるよう、**次の構造ルール**に従って出力してください。マーカーは半角の二重角括弧で、ブロック先頭にのみ置き、本文との間は半角スペース 1 つで区切ります。

### 5 つのラベル
- \`[[label:procedure]]\` — 実験手順・操作（**必ず H2 見出しに付与する**）
- \`[[label:material]]\` — 材料・試薬・原料
- \`[[label:tool]]\` — 装置・器具
- \`[[label:attribute]]\` — 条件・パラメータ
- \`[[label:result]]\` — 結果・成果物・観察

### 構造ルール（重要）
1. **手順は必ず H2 見出し（\`## \`）にする**。番号リストや箇条書きに \`[[label:procedure]]\` を付けても Activity ノードにならず、エッジが張られません。
2. **その手順で使うもの・出るもの**（material / tool / attribute / result）は、その H2 見出しの**直下に箇条書きまたは段落として配置**する。次の H2 見出しまでが 1 手順のスコープです。
3. 概要・背景の H2 には \`[[label:procedure]]\` を付けない（Activity にしない）。
4. 番号付きリストは「手順内の細かいステップ説明」として使い、ラベルは付けない（H2 が手順、リストは中身の説明）。

### 推奨フォーマット例
\`\`\`
# XRD 解析の標準手順

## 概要
粉末XRD測定から相同定までの流れ。

## [[label:procedure]] 試料準備
- [[label:material]] 測定対象の粉末試料
- [[label:tool]] メノウ乳鉢・乳棒
- [[label:tool]] ガラス試料ホルダー
- [[label:attribute]] 粒径目安: 10 µm 以下
- [[label:result]] 充填済み試料ホルダー

## [[label:procedure]] XRD 測定
- [[label:material]] 充填済み試料ホルダー
- [[label:tool]] X 線回折装置
- [[label:attribute]] X 線源: Cu Kα
- [[label:attribute]] 走査範囲: 10°–90° (2θ)
- [[label:result]] 回折パターン (.xy)

## [[label:procedure]] 相同定
- [[label:material]] 回折パターン
- [[label:tool]] ICDD PDF データベース
- [[label:result]] 同定された相
\`\`\`

### NG パターン
- ❌ \`1. [[label:procedure]] 試料を粉砕する\` （リスト項目に procedure → Activity にならない）
- ❌ \`## 試料準備\` の下に procedure マーカー無し （見出しは普通の見出しのまま）
- ❌ マーカーが行中・末尾に出現する

ルール: マーカーは行頭のみ、1 ブロック 1 つまで、ASCII の \`[[label:xxx]]\` だけ、種別は上記 5 種以外使わない。
`;
  }
  return `

## Structured output (PROV graph generation)
When your answer includes experimental procedure, materials, tools, conditions, or results, follow the **structure rules** below so Graphium can auto-generate a PROV graph. Markers are ASCII double-bracket tags placed only at the very start of a block, separated from the body by a single space.

### Five labels
- \`[[label:procedure]]\` — Experimental step / activity (**must be on an H2 heading**)
- \`[[label:material]]\` — Material / reagent / input
- \`[[label:tool]]\` — Tool / instrument / equipment
- \`[[label:attribute]]\` — Condition / parameter
- \`[[label:result]]\` — Result / output / observation

### Structure rules (important)
1. **Procedures MUST be on H2 headings** (\`## \`). Putting \`[[label:procedure]]\` on numbered list items or bullets will NOT create an Activity node, so no edges will be drawn.
2. **Materials, tools, attributes, and results for that step** go as bullets or paragraphs **directly under** that H2 heading. The scope of one activity runs until the next H2.
3. Do NOT label overview / background H2 headings as procedures.
4. Use numbered lists only for fine-grained sub-steps inside a procedure; do not add labels to those list items.

### Recommended format
\`\`\`
# XRD analysis — standard procedure

## Overview
Flow from powder XRD measurement to phase identification.

## [[label:procedure]] Sample preparation
- [[label:material]] Powder sample to be measured
- [[label:tool]] Agate mortar and pestle
- [[label:tool]] Glass sample holder
- [[label:attribute]] Target particle size: ≤ 10 µm
- [[label:result]] Filled sample holder

## [[label:procedure]] XRD measurement
- [[label:material]] Filled sample holder
- [[label:tool]] X-ray diffractometer
- [[label:attribute]] X-ray source: Cu Kα
- [[label:attribute]] Scan range: 10°–90° (2θ)
- [[label:result]] Diffraction pattern (.xy)

## [[label:procedure]] Phase identification
- [[label:material]] Diffraction pattern
- [[label:tool]] ICDD PDF database
- [[label:result]] Identified phases
\`\`\`

### Anti-patterns
- ❌ \`1. [[label:procedure]] Crush the sample\` (list item — won't become an Activity)
- ❌ \`## Sample preparation\` without the procedure marker (stays a plain heading)
- ❌ Markers placed mid-sentence or at end of a block

Rules: marker only at start of a block, at most one per block, ASCII \`[[label:xxx]]\` only, no labels outside the five above.
`;
}
