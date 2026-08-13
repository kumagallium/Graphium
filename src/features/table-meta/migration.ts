// 旧テーブルサイドストア（logTables / indexTables）から tableMeta への読み込み時変換
//
// 保存は新形式（tableMeta）のみ。旧フィールドは型に @deprecated として残すが
// 書き出さないため、新形式で保存したノートを旧ビルドで開くと、記録テーブル・
// インデックステーブルのふるまいは失われる（カラム導入時と同じ既知の性質）。

import { collectTableBlocks, readFirstColumnName } from "./table-cells";
import { withColumnType, type TableMeta } from "./types";

type LegacyPage = {
  blocks?: any[];
  tableMeta?: Record<string, TableMeta>;
  /** @deprecated 旧・インデックステーブル */
  indexTables?: Record<string, Record<string, string>>;
  /** @deprecated 旧・記録テーブル */
  logTables?: Record<string, Record<string, unknown>>;
};

/**
 * ページの旧サイドストアを tableMeta に変換する。
 *
 * - すでに `tableMeta` を持つノート（新形式で保存済み）は、それを唯一の真実として
 *   そのまま返す。旧フィールドが残っていても混ぜない
 * - 旧ノートは `logTables` / `indexTables` から変換する。ふるまいは従来どおり
 *   先頭列に付いていたので、先頭列の名前をキーにして記録する
 * - 先頭列の名前が空のテーブル（ヘッダ未入力）は空文字キーになる。現時点で
 *   ふるまいの適用位置は先頭列固定のため、これで壊れることはない
 * - 同じテーブルに両方が付いていた場合は、同じ列に 2 つのふるまいが並ぶ
 */
export function migrateTableMeta(
  page: LegacyPage | undefined
): Record<string, TableMeta> | undefined {
  if (!page) return undefined;
  if (page.tableMeta && Object.keys(page.tableMeta).length > 0) {
    return page.tableMeta;
  }

  const hasLegacy =
    Object.keys(page.logTables ?? {}).length > 0 ||
    Object.keys(page.indexTables ?? {}).length > 0;
  if (!hasLegacy) return undefined;

  const tables = collectTableBlocks(page.blocks ?? []);
  const result: Record<string, TableMeta> = {};

  const columnNameOf = (blockId: string): string => {
    const block = tables.get(blockId);
    return block ? readFirstColumnName(block) : "";
  };

  // 記録テーブル → 先頭列が datetime-auto。config.name はキャプションへ
  for (const [blockId, config] of Object.entries(page.logTables ?? {})) {
    const meta: TableMeta = result[blockId] ?? {};
    meta.columns = withColumnType(meta.columns, columnNameOf(blockId), "datetime-auto");
    const name = (config as Record<string, unknown> | undefined)?.name;
    if (typeof name === "string" && name.trim().length > 0) {
      meta.caption = name.trim();
    }
    result[blockId] = meta;
  }

  // インデックステーブル → 先頭列が note-link。linkedNotes は noteLinks へ
  for (const [blockId, linkedNotes] of Object.entries(page.indexTables ?? {})) {
    const meta: TableMeta = result[blockId] ?? {};
    meta.columns = withColumnType(meta.columns, columnNameOf(blockId), "note-link");
    if (linkedNotes && Object.keys(linkedNotes).length > 0) {
      meta.noteLinks = { ...meta.noteLinks, ...linkedNotes };
    }
    result[blockId] = meta;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}
