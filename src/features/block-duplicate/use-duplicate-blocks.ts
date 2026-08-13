// ──────────────────────────────────────────────
// useDuplicateBlocks
//
// ブロックを直下に複製する操作のファサード。ブロックメニューの「複製」と
// ⌘D / Ctrl+D の両方がここを通る（導線が増えても引き継ぎ範囲がぶれないように）。
//
// 引き継ぐもの:
//   - 本文・props（BlockNote のブロックツリーごとコピー）
//   - ラベル / step 属性 / 複製範囲内で閉じたリンク（useBlockLifecycle 経由 = コピペと同じ）
//   - 配置揃え（blockAlignmentStore。テーブル・音声など textAlignment を持たないブロック用）
//   - テーブルの名前と、日時が自動で入る列（テンプレートとして複製する使い方が主なため）
//
// 引き継がないもの:
//   - 行からノートを作る列（note-link）と行の紐付け。行がノートに紐づくため、複製すると
//     同じノートを指す表が 2 つでき、どちらを編集したのか分からなくなる。
//   - OCR 結果。同じ画像なら複製先でも読み直せる（派生データを二重に持たない）。
// ──────────────────────────────────────────────

import { useCallback } from "react";
import { useBlockNoteEditor } from "@blocknote/react";
import { useBlockLifecycle } from "../block-lifecycle";
import { computeIdMap, flattenBlockIds } from "../block-lifecycle/clipboard";
import { useBlockAlignmentStoreOptional } from "../block-alignment";
import { useTableMetaStoreOptional } from "../table-meta/store";
import { findColumnNameByType } from "../table-meta/types";
import { stripBlockIds } from "./duplicate-blocks";

export type DuplicateBlocks = (blockIds: readonly string[]) => string[];

export function useDuplicateBlocks(): DuplicateBlocks {
  const editor = useBlockNoteEditor<any, any, any>();
  const { copyBlocksMetadata } = useBlockLifecycle();
  const alignStore = useBlockAlignmentStoreOptional();
  const tableMeta = useTableMetaStoreOptional();

  return useCallback(
    (blockIds: readonly string[]): string[] => {
      if (!blockIds.length) return [];
      if (editor.isEditable === false) return [];

      const source = blockIds
        .map((id) => editor.getBlock(id))
        .filter((b: any): b is any => Boolean(b));
      if (!source.length) return [];

      // 複製は「直下」に置く。複数渡された場合は最後のブロックの後ろにまとめて入れる。
      const reference = source[source.length - 1];
      const inserted = editor.insertBlocks(
        source.map(stripBlockIds),
        reference.id,
        "after",
      );
      if (!inserted?.length) return [];

      const idMap = computeIdMap(flattenBlockIds(source), flattenBlockIds(inserted));
      // ラベル / step 属性 / 内部リンク / メディアラベル（entityId は再発番）
      copyBlocksMetadata(idMap);

      for (const [oldId, newId] of idMap) {
        const alignment = alignStore?.getAlignment(oldId);
        if (alignment) alignStore!.setAlignment(newId, alignment);

        const meta = tableMeta?.metas.get(oldId);
        if (meta) {
          const datetimeColumn = findColumnNameByType(meta, "datetime-auto");
          if (datetimeColumn !== undefined) {
            tableMeta!.addColumnType(newId, datetimeColumn, "datetime-auto");
          }
          if (meta.caption) tableMeta!.setCaption(newId, meta.caption);
        }
      }

      // 複製直後は複製先にカーソルを移す（続けて編集する動線）。
      // テーブル・メディアなどテキストカーソルを置けないブロックでは失敗するので握りつぶす。
      try {
        editor.setTextCursorPosition(inserted[0], "end");
      } catch {
        /* カーソルを置けないブロック種別 */
      }

      return inserted.map((b: any) => b.id);
    },
    [editor, copyBlocksMetadata, alignStore, tableMeta],
  );
}
