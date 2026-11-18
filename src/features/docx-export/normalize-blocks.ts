// Word 書き出し用のブロック正規化（純ロジック・同期）
//
// 保存形のブロック配列には、カスタムブロック（callout / chart / math 等）や
// カスタム inline（来歴ハイライト等）が混ざる。Word への描画側（blocks-to-docx.ts）が
// 知っておくべき型を BlockNote 標準ブロックだけに絞るため、ここで落とし込む。
//
// カスタムブロックの落とし込みは Markdown 書き出しと同じ表（blocks/markdown.ts の
// blockMarkdownConverters）を再利用する。Word 用に別の表を作ると、ブロックの props が
// 変わったときに片方だけ陳腐化する（markdown-export/sanitize-blocks.ts と同じ方針）。
//
// Markdown 用との違いは inline だけ:
//   - ＠メンションは [[題]] にせず、画面の見た目（青文字の "@題"）のまま残す
//   - 上付き・下付きはタグ文字列にせず style のまま残す（Word の書式で出せる）
//   - 画像 inline はそのまま残す（描画側で読み込む）
// chart だけは画像で出せる可能性があるので、落とし込み結果を fallback に持たせた
// 内部ノード { type: "docxChart" } にして描画側へ渡す。

import { defaultBlockSpecs } from "@blocknote/core";
import { blockMarkdownConverters } from "../../blocks/markdown";
import { parseChartBlockConfig } from "../../blocks/chart/chart-config";
import { inlineMathToMarkdown } from "../math/markdown-math";
import { inlineContentToText } from "../markdown-export/inline-text";

/** BlockNote のブロック 1 個（構造だけ見るので any ベース） */
export type NormalizedBlock = Record<string, any>;
type InlineItem = Record<string, any>;

/** default スキーマが知っているブロック type（実行時に導出。BlockNote の更新に追従する） */
export const STANDARD_BLOCK_TYPES: ReadonlySet<string> = new Set(Object.keys(defaultBlockSpecs));

/** Word に持ち込む style。ほかは捨てる */
const KEPT_STYLES = [
  "bold", "italic", "underline", "strike", "code",
  "textColor", "backgroundColor", "superscript", "subscript",
] as const;

function normalizeStyles(styles: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!styles || typeof styles !== "object") return out;
  for (const key of KEPT_STYLES) {
    const value = (styles as Record<string, unknown>)[key];
    if (value !== undefined && value !== false && value !== null) out[key] = value;
  }
  return out;
}

/** inline content 配列を Word 用に正規化する */
export function normalizeInlinesForDocx(content: unknown): InlineItem[] {
  if (!Array.isArray(content)) return [];
  const out: InlineItem[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "text") {
      out.push({
        type: "text",
        text: typeof item.text === "string" ? item.text : "",
        styles: normalizeStyles(item.styles),
      });
    } else if (item.type === "link") {
      out.push({
        type: "link",
        href: typeof item.href === "string" ? item.href : "",
        content: normalizeInlinesForDocx(item.content),
      });
    } else if (item.type === "inlineMath") {
      const md = inlineMathToMarkdown(String(item.props?.latex ?? ""));
      if (md) out.push({ type: "text", text: md, styles: {} });
    } else if (item.type === "inlineImage") {
      out.push({
        type: "inlineImage",
        props: {
          fileId: String(item.props?.fileId ?? ""),
          name: String(item.props?.name ?? ""),
          width: Number(item.props?.width ?? 0) || 0,
        },
      });
    } else if (typeof item.text === "string") {
      out.push({ type: "text", text: item.text, styles: {} });
    }
    // text を持たない未知 inline は情報が無いので落とす
  }
  return out;
}

/** table content のセルを正規化する（inline 配列 / { type: "tableCell", content } の両形式） */
function normalizeTableContent(content: any): any {
  if (!content || typeof content !== "object" || !Array.isArray(content.rows)) return content;
  return {
    ...content,
    rows: content.rows.map((row: any) => ({
      ...row,
      cells: Array.isArray(row?.cells)
        ? row.cells.map((cell: any) => {
            if (Array.isArray(cell)) return normalizeInlinesForDocx(cell);
            if (cell && typeof cell === "object") {
              return { ...cell, content: normalizeInlinesForDocx(cell.content) };
            }
            return [];
          })
        : [],
    })),
  };
}

/** チャートのキャプション（設定が壊れていれば空） */
function chartCaption(b: NormalizedBlock): string {
  try {
    const config = parseChartBlockConfig(String(b.props?.config ?? ""), String(b.props?.sourceBlockId ?? ""));
    return typeof config.caption === "string" ? config.caption.trim() : "";
  } catch {
    return "";
  }
}

/**
 * 保存形のブロック配列を「標準ブロック（＋ docxChart）だけ」の配列にする。
 * 配列でなければ空配列。null や object でない要素は飛ばす。
 */
export function normalizeBlocksForDocx(
  blocks: unknown,
  tableNames?: ReadonlyMap<string, string>,
): NormalizedBlock[] {
  if (!Array.isArray(blocks)) return [];
  const out: NormalizedBlock[] = [];

  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const b = block as NormalizedBlock;
    const children = normalizeBlocksForDocx(b.children, tableNames);

    // カスタムブロック: Markdown 書き出しと同じ落とし込みを使う
    // 継承プロパティ（constructor など）を引かないよう、自前のキーだけを見る
    const convert =
      typeof b.type === "string" && Object.prototype.hasOwnProperty.call(blockMarkdownConverters, b.type)
        ? blockMarkdownConverters[b.type]
        : undefined;
    if (convert) {
      const lowered = convert(b, {
        children,
        inlines: normalizeInlinesForDocx(b.content),
        tableNames,
      });
      if (b.type === "chart") {
        // 画像で出すときも、キャプションと子ブロックは落とさない
        out.push({
          type: "docxChart",
          blockId: typeof b.id === "string" ? b.id : "",
          fallback: lowered,
          caption: chartCaption(b),
          chartChildren: children,
        });
      } else {
        out.push(...lowered);
      }
      continue;
    }

    if (typeof b.type !== "string" || !STANDARD_BLOCK_TYPES.has(b.type)) {
      // 未知ブロックは inline の文字だけの paragraph にする（Markdown と同じ）
      const text = inlineContentToText(b.content);
      out.push({
        type: "paragraph",
        props: {},
        content: text ? [{ type: "text", text, styles: {} }] : [],
        children,
      });
      continue;
    }

    const next: NormalizedBlock = { ...b, children };
    if (b.type === "table") {
      next.content = normalizeTableContent(b.content);
    } else if (Array.isArray(b.content)) {
      next.content = normalizeInlinesForDocx(b.content);
    }
    out.push(next);
  }
  return out;
}
