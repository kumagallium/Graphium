// Markdown 変換用のブロックサニタイザ（純ロジック）
//
// 背景: 保存済みノートにはカスタムブロック（bookmark / chart / callout 等）や
// カスタムインラインスタイル（inlineMaterial 等の来歴ハイライト）が含まれる。
// これらを default スキーマのヘッドレスエディタに食わせると BlockNote が
// 未知の type / style で throw するため、変換前に標準ブロックへ落とし込む。
//
// 方針: Markdown は元々 lossy なエクスポートなので、視覚情報（ハイライト色や
// callout の枠）は捨て、テキストとリンクだけを確実に残す。
// ただし数式は「見た目」ではなく内容なので、$$ ... $$ / $ ... $ の LaTeX 表記に
// 戻して残す（他の Markdown ツールでもそのまま数式として読める形）。
//
// ブロックごとの落とし込みはここには書かない。ブロック定義の隣（各ブロックの
// to-markdown.ts）に置き、blocks/markdown.ts のレジストリから引く。ここに
// 分岐を書き足す方式は、ブロックの props 変更に追従できず静かに陳腐化した。

import { inlineMathToMarkdown } from "../math/markdown-math";
import { blockMarkdownConverters } from "../../blocks/markdown";

/** BlockNote の inline content（text / link / その他）1 要素 */
type InlineItem = Record<string, any>;

/** BlockNote のブロック 1 個（構造だけ見るので any ベース） */
type AnyBlock = Record<string, any>;

/** サニタイズの対象情報。default スキーマから実行時に導出して渡す */
export type SanitizeSchemaInfo = {
  /** default スキーマが知っているブロック type 名の集合 */
  knownBlockTypes: ReadonlySet<string>;
  /** default スキーマが知っている style 名の集合（bold / italic / textColor 等） */
  knownStyles: ReadonlySet<string>;
};

/** text inline の styles から未知の style キーを取り除く */
function sanitizeStyles(styles: Record<string, unknown> | undefined, knownStyles: ReadonlySet<string>): Record<string, unknown> {
  if (!styles) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(styles)) {
    if (knownStyles.has(key)) out[key] = value;
  }
  return out;
}

/**
 * 内部リンク（青文字の `@タイトル` テキスト）を Obsidian 互換の `[[タイトル]]` に変換する。
 * ノート ID は本文に埋まっておらず「表示テキスト＝タイトル」が規約なので、表示テキスト
 * ベースで判定する（wiki-service の extractInlineTextWithCitations と同じ判定）。
 * Wiki メンションの `🤖 ` プレフィックスは剥がす。メンションでなければ null を返す。
 */
export function mentionToWikiLinkText(item: InlineItem): string | null {
  if (item?.type !== "text" || typeof item.text !== "string") return null;
  if (item.styles?.textColor !== "blue" || !item.text.startsWith("@")) return null;
  let title = item.text.slice(1);
  if (title.startsWith("🤖 ")) title = title.slice(3);
  title = title.trim();
  if (!title) return null;
  return `[[${title}]]`;
}

/** inline content 配列をサニタイズする（未知 inline type はプレーンテキスト化） */
function sanitizeInlines(content: unknown, knownStyles: ReadonlySet<string>): InlineItem[] {
  if (!Array.isArray(content)) return [];
  const out: InlineItem[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "text") {
      // 内部リンクは Markdown では [[タイトル]] として書き出す（インポートと対称）
      const wikiLink = mentionToWikiLinkText(item);
      if (wikiLink) {
        out.push({ type: "text", text: wikiLink, styles: {} });
        continue;
      }
      out.push({
        type: "text",
        text: typeof item.text === "string" ? item.text : "",
        styles: sanitizeStyles(item.styles, knownStyles),
      });
    } else if (item.type === "link") {
      out.push({
        type: "link",
        href: typeof item.href === "string" ? item.href : "",
        content: sanitizeInlines(item.content, knownStyles),
      });
    } else if (item.type === "inlineMath") {
      // インライン数式 → Markdown の $ ... $ 表記に戻す
      const md = inlineMathToMarkdown(String(item.props?.latex ?? ""));
      if (md) out.push({ type: "text", text: md, styles: {} });
    } else if (typeof item.text === "string") {
      // 未知の inline type（将来の mention 等）はテキストとして残す
      out.push({ type: "text", text: item.text, styles: {} });
    }
    // text を持たない未知 inline は情報が無いので落とす
  }
  return out;
}

/** inline content からプレーンテキストを抽出する（未知ブロックのフォールバック用） */
export function extractInlineText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  let text = "";
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    if ((item as any).type === "inlineMath") text += inlineMathToMarkdown(String((item as any).props?.latex ?? ""));
    else if (typeof (item as any).text === "string") text += (item as any).text;
    else if (Array.isArray((item as any).content)) text += extractInlineText((item as any).content);
  }
  return text;
}

/** table content（{ type: "tableContent", rows: [...] }）のセルをサニタイズする */
function sanitizeTableContent(content: any, knownStyles: ReadonlySet<string>): any {
  if (!content || typeof content !== "object" || !Array.isArray(content.rows)) return content;
  return {
    ...content,
    rows: content.rows.map((row: any) => ({
      ...row,
      cells: Array.isArray(row?.cells)
        ? row.cells.map((cell: any) => {
            // セルは inline 配列 or { type: "tableCell", content: [...] } の 2 形式
            if (Array.isArray(cell)) return sanitizeInlines(cell, knownStyles);
            if (cell && typeof cell === "object" && Array.isArray(cell.content)) {
              return { ...cell, content: sanitizeInlines(cell.content, knownStyles) };
            }
            return cell;
          })
        : row?.cells,
    })),
  };
}

/**
 * 保存済みブロック配列を default スキーマで安全に変換できる形にサニタイズする。
 * - カスタムブロック → blocks/markdown.ts のレジストリが標準ブロックへ落とす
 * - その他の未知ブロック → プレーンテキストの paragraph
 * - 既知ブロック → styles / inline をサニタイズしつつ維持（children も再帰処理）
 */
export function sanitizeBlocksForMarkdown(
  blocks: unknown,
  schemaInfo: SanitizeSchemaInfo,
  tableNames?: ReadonlyMap<string, string>,
): AnyBlock[] {
  if (!Array.isArray(blocks)) return [];
  const { knownBlockTypes, knownStyles } = schemaInfo;
  const out: AnyBlock[] = [];

  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const b = block as AnyBlock;
    const children = sanitizeBlocksForMarkdown(b.children, schemaInfo, tableNames);

    // カスタムブロック: ブロック定義の隣に置いた落とし込みを使う
    const convert = typeof b.type === "string" ? blockMarkdownConverters[b.type] : undefined;
    if (convert) {
      out.push(
        ...convert(b, { children, inlines: sanitizeInlines(b.content, knownStyles), tableNames }),
      );
      continue;
    }

    if (typeof b.type !== "string" || !knownBlockTypes.has(b.type)) {
      // 未知ブロック（将来のカスタムブロック等）→ プレーンテキストで残す
      const text = extractInlineText(b.content);
      out.push({
        type: "paragraph",
        props: {},
        content: text ? [{ type: "text", text, styles: {} }] : [],
        children,
      });
      continue;
    }

    // 既知の標準ブロック: inline / table content をサニタイズして維持
    const next: AnyBlock = { ...b, children };
    if (b.type === "table") {
      next.content = sanitizeTableContent(b.content, knownStyles);
    } else if (Array.isArray(b.content)) {
      next.content = sanitizeInlines(b.content, knownStyles);
    }
    // id は変換に不要なので落とす（ヘッドレスエディタ側で採番される）
    delete next.id;
    out.push(next);
  }
  return out;
}
