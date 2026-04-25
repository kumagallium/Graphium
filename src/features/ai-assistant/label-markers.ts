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

## 構造化出力（コンテキストラベル）
回答が「実験手順」「材料」「使用する道具」「条件・属性」「結果・成果物」のいずれかに該当する内容を含む場合、該当するブロックの**先頭**に次のいずれかのマーカーを付けてください。マーカーは半角の二重角括弧で、行頭にのみ出現させ、本文との間は半角スペース 1 つで区切ります。

- 実験手順・操作: \`[[label:procedure]]\`
- 材料・試薬・原料: \`[[label:material]]\`
- 装置・器具・ツール: \`[[label:tool]]\`
- 条件・パラメータ・属性: \`[[label:attribute]]\`
- 結果・成果物・観察: \`[[label:result]]\`

例:
\`\`\`
## 合成手順
1. [[label:procedure]] 試料 A と B を 1:1 で混合する
2. [[label:procedure]] 80℃ で 30 分加熱する

- [[label:material]] 試料 A
- [[label:tool]] 電気炉
- [[label:attribute]] 加熱温度: 80℃
- [[label:result]] 単相結晶相
\`\`\`

ルール:
- マーカーは各ブロックの先頭にのみ置き、文中・末尾には絶対に置かない
- 該当しない一般的な説明文や見出し（H1/H2/H3）にはマーカーを付けない
- 1 ブロックにつきマーカーは 1 つまで
- マーカーは ASCII の \`[[label:xxx]]\` のみで、種別名は上記 5 種以外は使わない
`;
  }
  return `

## Structured output (context labels)
When your answer includes content that fits one of these categories, prefix the **beginning of that block** with the matching marker. Markers are ASCII double-bracket tags placed only at the very start of a block, separated from the body by a single space.

- Experimental procedure / step: \`[[label:procedure]]\`
- Material / reagent / input: \`[[label:material]]\`
- Tool / instrument / equipment: \`[[label:tool]]\`
- Condition / parameter / attribute: \`[[label:attribute]]\`
- Result / output / observation: \`[[label:result]]\`

Example:
\`\`\`
## Synthesis procedure
1. [[label:procedure]] Mix samples A and B at a 1:1 ratio
2. [[label:procedure]] Heat at 80°C for 30 minutes

- [[label:material]] Sample A
- [[label:tool]] Electric furnace
- [[label:attribute]] Heating temperature: 80°C
- [[label:result]] Single-phase crystal
\`\`\`

Rules:
- Markers must appear only at the start of a block, never mid-sentence or at the end.
- Do not add markers to generic explanations or headings (H1/H2/H3).
- At most one marker per block.
- Use only the ASCII form \`[[label:xxx]]\` with one of the five labels above.
`;
}
