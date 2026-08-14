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
import type { TableMeta } from "../../lib/document-types";
import { computeTableDisplayNames } from "../table-meta/auto-name";
import { hasColumnType } from "../table-meta/types";
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
 * table ブロック id → 表示名を作る。
 * チャートが参照先を名前で書けるようにするためで、名前の付き方（キャプション、
 * 日時列を持つテーブルの「表 N」自動名）は画面の参照表示と同じ規則に揃える。
 */
function buildTableNames(
  blocks: unknown,
  tableMeta: Record<string, TableMeta> | undefined,
): ReadonlyMap<string, string> | undefined {
  if (!tableMeta || !Array.isArray(blocks)) return undefined;
  return computeTableDisplayNames(
    blocks,
    (blockId) => hasColumnType(tableMeta[blockId], "datetime-auto"),
    (blockId) => tableMeta[blockId]?.caption ?? "",
  );
}

/**
 * ブロック配列を Markdown にする。
 * エディタはフルスキーマ（ライブ）でもヘッドレス default スキーマでもよい
 * — 渡す前に標準ブロックへ落とすので、どちらでも同じ出力になる。
 *
 * tableMeta を渡すとチャートが参照先テーブルを名前で書ける。テーブルの名前は
 * ブロックの外（ページのサイドストア）にあるため、ブロック配列だけでは解決
 * できない。渡さない場合はチャートが列名で代替する。
 *
 * ページの一部だけを変換するとき（ブロックのコピー・AI への引用）は
 * documentBlocks にページ全体を渡す。「表 N」の自動名は文書順で決まるので、
 * 選択範囲だけで数えると画面と違う番号になる。
 */
export async function blocksToMarkdown(
  editor: Pick<MarkdownCapableEditor, "blocksToMarkdownLossy">,
  blocks: unknown,
  options?: { tableMeta?: Record<string, TableMeta>; documentBlocks?: unknown },
): Promise<string> {
  const sanitized = sanitizeBlocksForMarkdown(
    blocks,
    DEFAULT_SCHEMA_INFO,
    buildTableNames(options?.documentBlocks ?? blocks, options?.tableMeta),
  );
  if (sanitized.length === 0) return "";
  return await editor.blocksToMarkdownLossy(sanitized);
}
