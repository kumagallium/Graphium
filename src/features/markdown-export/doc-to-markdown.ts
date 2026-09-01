// 保存済み GraphiumDocument → Markdown 変換（一括エクスポート用）
//
// ライブエディタを持たない一括変換では、markdown-import と同じパターンで
// default スキーマのヘッドレス BlockNoteEditor を一時生成して
// blocks-to-markdown.ts に渡す（カスタムブロックの落とし込みはそこで共通化）。
//
// ただし blockSpecs は素の defaultBlockSpecs ではなく、inert-media-elements.ts で
// 包んだものを使う。標準の image / video / audio は HTML 化のときに `<img>` を作って
// src に URL を代入する＝そこで取得が始まるため、全ノートを回すこの経路が
// 「ノートに書かれた外部 URL を、画面を出さずに全部叩く」ものになっていた。
// 包んだ spec は取得を持たない要素で同じ HTML を組み立てるので、書き出される
// Markdown の文字列は変わらない（URL はテキストとしてそのまま残る）。

import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs, defaultStyleSpecs } from "@blocknote/core";
import type { GraphiumDocument } from "../../lib/document-types";
import { inertMediaBlockSpecs } from "./inert-media-elements";
import { extractInlineText } from "./sanitize-blocks";
import { blocksToMarkdown } from "./blocks-to-markdown";

// ヘッドレスエディタは生成コストがあるため、一括変換中は 1 個を使い回す
let headlessEditor: { blocksToMarkdownLossy: (blocks: any[]) => Promise<string> } | null = null;

function getHeadlessEditor() {
  if (!headlessEditor) {
    const schema = BlockNoteSchema.create({
      blockSpecs: inertMediaBlockSpecs(defaultBlockSpecs),
      styleSpecs: defaultStyleSpecs,
    });
    headlessEditor = BlockNoteEditor.create({ schema }) as any;
  }
  return headlessEditor!;
}

/** タイトルを H1 として本文 Markdown の先頭に付ける（単一・一括で共通のファイル体裁） */
export function buildMarkdownFileContent(title: string, markdown: string): string {
  const heading = title.trim() ? `# ${title.trim()}` : "";
  const body = markdown.trim();
  if (!heading) return `${body}\n`;
  if (!body) return `${heading}\n`;
  return `${heading}\n\n${body}\n`;
}

/** ブロック配列からのプレーンテキスト抽出（変換失敗時の最終フォールバック） */
function blocksToPlainText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  const lines: string[] = [];
  const visit = (list: any[]) => {
    for (const b of list) {
      if (!b || typeof b !== "object") continue;
      const text = extractInlineText(b.content);
      if (text.trim()) lines.push(text);
      if (Array.isArray(b.children)) visit(b.children);
    }
  };
  visit(blocks);
  return lines.join("\n\n");
}

/**
 * 保存済みドキュメントを Markdown 本文（タイトル見出し無し）に変換する。
 * 複数ページのノートはページタイトルを H2 で区切って連結する。
 * ヘッドレス変換が失敗したノートはプレーンテキスト抽出にフォールバックする。
 */
export async function graphiumDocToMarkdown(doc: GraphiumDocument): Promise<string> {
  const pages = Array.isArray(doc.pages) ? doc.pages : [];
  const sections: string[] = [];

  for (const page of pages) {
    let body: string;
    try {
      body = await blocksToMarkdown(getHeadlessEditor(), page.blocks, {
        tableMeta: page.tableMeta,
      });
    } catch (e) {
      console.warn("[markdown-export] blocksToMarkdownLossy failed, falling back to plain text:", e);
      body = blocksToPlainText(page.blocks);
    }
    // 単一ページのノート（大多数）はページ見出しを付けない
    if (pages.length > 1) {
      const pageTitle = (page.title ?? "").trim();
      sections.push(pageTitle ? `## ${pageTitle}\n\n${body.trim()}` : body.trim());
    } else {
      sections.push(body.trim());
    }
  }

  return sections.filter((s) => s.length > 0).join("\n\n");
}
