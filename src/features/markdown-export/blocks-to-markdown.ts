// ブロック配列 → Markdown の共通入口
//
// Markdown を作る経路は複数ある（単一ノートのエクスポート・一括エクスポート・
// AI への引用・ブロックのコピー）。BlockNote の blocksToMarkdownLossy を直接
// 呼ぶと、カスタムブロックは画面の DOM がそのまま Markdown 化され、ボタンの
// ラベルや読み込み中表示（"Settings" / "Loading chart…"）や、Context を辿れない
// 場所で解決に失敗した i18n キーが本文に混ざる。数式に至っては LaTeX ソース
// ではなく KaTeX の描画結果（"E=mc2"）になり、内容そのものが壊れる。
//
// そのため全経路がこの関数を通り、カスタムブロックを標準ブロックへ落として
// から変換する。経路ごとに出力が食い違わないための単一の絞り口。

import { defaultBlockSpecs, defaultStyleSpecs } from "@blocknote/core";
import { sanitizeBlocksForMarkdown, type SanitizeSchemaInfo } from "./sanitize-blocks";

// default スキーマが知っている type / style を実行時に導出する
// （ハードコードすると BlockNote のバージョンアップで漏れるため）
export const DEFAULT_SCHEMA_INFO: SanitizeSchemaInfo = {
  knownBlockTypes: new Set(Object.keys(defaultBlockSpecs)),
  knownStyles: new Set(Object.keys(defaultStyleSpecs)),
};

/**
 * Markdown 変換に必要な最小インターフェース（BlockNoteEditor 互換）。
 * blocksToMarkdownLossy の戻りは BlockNote のバージョンで同期・非同期が変わるため
 * どちらも受ける（呼び出し側は await で吸収する）。
 */
export type MarkdownCapableEditor = {
  document: any[];
  blocksToMarkdownLossy(blocks?: any[]): string | Promise<string>;
};

/**
 * ブロック配列を Markdown にする。
 * エディタはフルスキーマ（ライブ）でもヘッドレス default スキーマでもよい
 * — 渡す前に標準ブロックへ落とすので、どちらでも同じ出力になる。
 */
export async function blocksToMarkdown(
  editor: Pick<MarkdownCapableEditor, "blocksToMarkdownLossy">,
  blocks: unknown,
): Promise<string> {
  const sanitized = sanitizeBlocksForMarkdown(blocks, DEFAULT_SCHEMA_INFO);
  if (sanitized.length === 0) return "";
  return await editor.blocksToMarkdownLossy(sanitized);
}
