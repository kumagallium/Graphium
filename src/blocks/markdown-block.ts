// Markdown 書き出し用ブロックの型と組み立てヘルパー（純ロジック）
//
// Markdown 変換は BlockNote 標準スキーマのヘッドレスエディタに食わせるため、
// カスタムブロックは事前に標準ブロック（paragraph / heading / codeBlock 等）へ
// 落とし込む必要がある。その落とし込みを書くときの共通部品。
//
// このファイルは葉に保つ（ブロック実装を import しない）。各ブロックの
// to-markdown.ts がここを読み、markdown.ts が各 to-markdown.ts を集約する。

/** 標準スキーマで表現したブロック 1 個（構造だけ見るので any ベース） */
export type MarkdownBlock = Record<string, any>;

/** ブロック変換に渡す文脈 */
export type MarkdownBlockContext = {
  /** 変換済みの子ブロック。children に載せるか、持ち上げて使う */
  children: MarkdownBlock[];
  /**
   * ブロック本文の inline content をサニタイズしたもの
   * （content: "inline" のブロック用。未知 style やメンションは処理済み）
   */
  inlines: MarkdownBlock[];
};

/**
 * カスタムブロック 1 個を標準ブロックの配列に落とす。
 * 空配列を返せばそのブロックは Markdown に出ない。
 */
export type BlockToMarkdown = (
  block: MarkdownBlock,
  ctx: MarkdownBlockContext,
) => MarkdownBlock[];

/** プレーンテキスト 1 行の paragraph */
export function textParagraph(
  text: string,
  styles: Record<string, unknown> = {},
  children: MarkdownBlock[] = [],
): MarkdownBlock {
  return {
    type: "paragraph",
    props: {},
    content: text ? [{ type: "text", text, styles }] : [],
    children,
  };
}

/** サニタイズ済み inline をそのまま持つ paragraph */
export function inlineParagraph(
  inlines: MarkdownBlock[],
  children: MarkdownBlock[] = [],
): MarkdownBlock {
  return { type: "paragraph", props: {}, content: inlines, children };
}

/** テキスト + リンク 1 本のシンプルな paragraph（href が無ければただのテキスト） */
export function linkParagraph(
  text: string,
  href: string | undefined,
  children: MarkdownBlock[] = [],
): MarkdownBlock {
  const label = text.trim() || href || "";
  const content = href
    ? [{ type: "link", href, content: [{ type: "text", text: label, styles: {} }] }]
    : [{ type: "text", text: label, styles: {} }];
  return { type: "paragraph", props: {}, content, children };
}

/**
 * コードブロック。language は指定しない（標準スキーマの既定に任せる）。
 * propSchema に無いキーを渡すと BlockNote が変換時に throw するため、
 * 標準ブロックの props には触らないのが安全。
 */
export function codeBlock(code: string, children: MarkdownBlock[] = []): MarkdownBlock {
  return {
    type: "codeBlock",
    props: {},
    content: code ? [{ type: "text", text: code, styles: {} }] : [],
    children,
  };
}
