// 一括 Markdown 変換用のブロックサニタイザ（純ロジック）
//
// 背景: 保存済みノートにはカスタムブロック（bookmark / pdfViewer / callout）や
// カスタムインラインスタイル（inlineMaterial 等の来歴ハイライト）が含まれる。
// これらを default スキーマのヘッドレスエディタに食わせると BlockNote が
// 未知の type / style で throw するため、変換前に標準ブロックへ落とし込む。
//
// 方針: Markdown は元々 lossy なエクスポートなので、視覚情報（ハイライト色や
// callout の枠）は捨て、テキストとリンクだけを確実に残す。
// ただし数式は「見た目」ではなく内容なので、$$ ... $$ / $ ... $ の LaTeX 表記に
// 戻して残す（他の Markdown ツールでもそのまま数式として読める形）。

import { mathBlockToMarkdown, inlineMathToMarkdown } from "../math/markdown-math";

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

/** テキスト + リンク 1 本のシンプルな paragraph ブロックを組み立てる */
function paragraphWithLink(text: string, href: string | undefined): AnyBlock {
  const label = text.trim() || href || "";
  const content: InlineItem[] = href
    ? [{ type: "link", href, content: [{ type: "text", text: label, styles: {} }] }]
    : [{ type: "text", text: label, styles: {} }];
  return { type: "paragraph", props: {}, content, children: [] };
}

/**
 * 保存済みブロック配列を default スキーマで安全に変換できる形にサニタイズする。
 * - bookmark → タイトル付きリンクの paragraph
 * - pdfViewer → ファイル名リンクの paragraph
 * - callout → 本文を維持した paragraph
 * - その他の未知ブロック → プレーンテキストの paragraph
 * - 既知ブロック → styles / inline をサニタイズしつつ維持（children も再帰処理）
 */
export function sanitizeBlocksForMarkdown(blocks: unknown, schemaInfo: SanitizeSchemaInfo): AnyBlock[] {
  if (!Array.isArray(blocks)) return [];
  const { knownBlockTypes, knownStyles } = schemaInfo;
  const out: AnyBlock[] = [];

  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const b = block as AnyBlock;
    const children = sanitizeBlocksForMarkdown(b.children, schemaInfo);

    if (b.type === "bookmark") {
      // URL ブックマークカード → Markdown ではリンク 1 行に落とす
      const props = b.props ?? {};
      const label = String(props.title || props.domain || props.url || "");
      out.push({ ...paragraphWithLink(label, props.url || undefined), children });
      continue;
    }
    if (b.type === "pdfViewer") {
      // PDF ビューア → ファイル名リンクに落とす（URL はアプリ内スキームのこともある）
      const props = b.props ?? {};
      const label = String(props.name || props.url || "PDF");
      out.push({ ...paragraphWithLink(label, props.url || undefined), children });
      continue;
    }
    if (b.type === "sharedCitation") {
      // shared:// 引用カード → 出所が読めるテキスト 1 行に落とす。
      // shared:// URI はローカルアプリ外では解決できないため、リンクにはせず
      // タイトル・種別・作者と ID を書誌情報風に残す。
      const props = b.props ?? {};
      const title = String(props.cachedTitle || "(untitled)");
      const meta = [props.entryType, props.cachedAuthor]
        .map((v) => String(v ?? "").trim())
        .filter(Boolean)
        .join(", ");
      const idPart = props.sharedId ? ` — shared://${String(props.sharedId)}` : "";
      out.push({
        type: "paragraph",
        props: {},
        content: [
          {
            type: "text",
            text: `📎 ${title}${meta ? ` (${meta})` : ""}${idPart}`,
            styles: {},
          },
        ],
        children,
      });
      continue;
    }
    if (b.type === "callout") {
      // callout → 本文テキストを維持した paragraph（枠・アイコンは捨てる）
      out.push({
        type: "paragraph",
        props: {},
        content: sanitizeInlines(b.content, knownStyles),
        children,
      });
      continue;
    }
    if (b.type === "chart") {
      // チャートブロック → 参照メモの斜体 1 行に落とす。
      // データ本体（参照先テーブル）は標準 table として書き出されるため、
      // ここで失われる情報は「どう描いていたか」だけ。静かに消さず痕跡を残す。
      const label = String(b.props?.xColumn ?? "").trim();
      out.push({
        type: "paragraph",
        props: {},
        content: [
          {
            type: "text",
            text: label ? `(Chart: ${label})` : "(Chart)",
            styles: { italic: true },
          },
        ],
        children,
      });
      continue;
    }
    if (b.type === "math") {
      // 数式ブロック → $$ ... $$ の段落（LaTeX ソースをそのまま残す）
      const md = mathBlockToMarkdown(String(b.props?.latex ?? ""));
      out.push({
        type: "paragraph",
        props: {},
        content: md ? [{ type: "text", text: md, styles: {} }] : [],
        children,
      });
      continue;
    }
    if (b.type === "step") {
      // step コンテナ → Markdown では H2 見出し + 中身（カードの枠は捨てる）。
      // 移行前の「procedure ラベル付き H2 + スコープ」と同じ体裁で出力し、
      // 工程の階層が外部でも読めるようにする。
      out.push({
        type: "heading",
        props: { level: 2 },
        content: sanitizeInlines(b.content, knownStyles),
        children,
      });
      continue;
    }
    if (b.type === "columnList" || b.type === "column") {
      // マルチカラム → Markdown はレイアウトを持たないので、カラムの中身を
      // カラム 1 → カラム 2 の順にそのまま持ち上げる（ラッパーは捨てる）。
      // 未知ブロック fallback に落とすと空 paragraph が挟まって出力が汚れる。
      out.push(...children);
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

// ──────────────────────────────────────────────
// 単一ノートエクスポート用のメンション変換
// （一括エクスポートは sanitizeInlines 内の同じ変換を通る）
// ──────────────────────────────────────────────

/**
 * ライブエディタの document（フルスキーマ）のメンション text だけを
 * `[[タイトル]]` テキストに差し替えた新しいブロック配列を返す（元は変更しない）。
 * 単一ノートの Markdown エクスポートが blocksToMarkdownLossy に渡す前処理。
 */
export function convertMentionsToWikiLinks(blocks: unknown): AnyBlock[] {
  if (!Array.isArray(blocks)) return [];
  return blocks.map(convertBlockMentions);
}

function convertBlockMentions(block: AnyBlock): AnyBlock {
  if (!block || typeof block !== "object") return block;
  const next: AnyBlock = { ...block };
  if (block.type === "table") {
    next.content = convertTableContentMentions(block.content);
  } else if (Array.isArray(block.content)) {
    next.content = convertInlineMentions(block.content);
  }
  if (Array.isArray(block.children) && block.children.length > 0) {
    next.children = block.children.map(convertBlockMentions);
  }
  return next;
}

function convertInlineMentions(content: any[]): InlineItem[] {
  return content.map((item) => {
    if (!item || typeof item !== "object") return item;
    const wikiLink = mentionToWikiLinkText(item);
    if (wikiLink) return { type: "text", text: wikiLink, styles: {} };
    if (item.type === "link" && Array.isArray(item.content)) {
      return { ...item, content: convertInlineMentions(item.content) };
    }
    return item;
  });
}

function convertTableContentMentions(content: any): any {
  if (!content || typeof content !== "object" || !Array.isArray(content.rows)) return content;
  return {
    ...content,
    rows: content.rows.map((row: any) => ({
      ...row,
      cells: Array.isArray(row?.cells)
        ? row.cells.map((cell: any) => {
            // セルは inline 配列 or { type: "tableCell", content: [...] } の 2 形式
            if (Array.isArray(cell)) return convertInlineMentions(cell);
            if (cell && typeof cell === "object" && Array.isArray(cell.content)) {
              return { ...cell, content: convertInlineMentions(cell.content) };
            }
            return cell;
          })
        : row?.cells,
    })),
  };
}
