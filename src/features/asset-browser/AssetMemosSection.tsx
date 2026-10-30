// この素材から保存した Memo の一覧
// MaterialFullView の右パネル「Memos」タブで使う。
// PR3-a: 構造化された `sourceAsset.fileId` 一致を優先しつつ、
// 旧仕様（テキスト末尾の `— {filename}`）にも後方互換として対応する。

import { useMemo } from "react";
import type { CaptureIndex, CaptureEntry } from "../mobile-capture";
import type { MediaIndexEntry } from "./media-index";
import { MemoComposer } from "./MemoComposer";
import { MemoList } from "./MemoList";
import { useT } from "../../i18n";

export type AssetMemosSectionProps = {
  entry: MediaIndexEntry;
  captureIndex?: CaptureIndex | null;
  /** メモ削除（オプション）。渡されない場合は削除ボタン非表示。 */
  onDeleteMemo?: (memoId: string) => void;
  /**
   * 入力欄から直接メモを追加（オプション）。渡されると上部に textarea が出る。
   * 親が sourceAsset の付与・トースト表示・state 反映を担当する想定。
   */
  onCreateMemo?: (text: string) => void | Promise<void>;
};

/**
 * 素材 `entry` から派生したメモを抽出する。
 *
 * 判定は OR 条件:
 * 1. 構造化された `sourceAsset.fileId` が一致する（PR3-a 以降の Quote→Memo）
 * 2. テキスト内に出典ラベル `— {entry.name}` が含まれる（旧仕様の後方互換）
 *
 * テキスト一致を残しているのは、PR3-a 以前に保存された既存メモや、
 * ユーザーが手で書いた出典行を取り逃さないため。
 */
export function filterMemosByAsset(
  captureIndex: CaptureIndex | null | undefined,
  entry: MediaIndexEntry,
): CaptureEntry[] {
  if (!captureIndex) return [];
  const needle = `— ${entry.name}`;
  return captureIndex.captures
    .filter((c) => !c.archivedAt && !c.deletedAt)
    .filter((c) => c.sourceAsset?.fileId === entry.fileId || c.text.includes(needle))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function AssetMemosSection({
  entry,
  captureIndex,
  onDeleteMemo,
  onCreateMemo,
}: AssetMemosSectionProps) {
  const t = useT();
  const memos = useMemo(() => filterMemosByAsset(captureIndex, entry), [captureIndex, entry]);

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {onCreateMemo && <MemoComposer onSubmit={onCreateMemo} />}

      {/* 一覧の描画はノート上の素材ブロックの小窓（MemoPopover）と共通（MemoList） */}
      <MemoList
        memos={memos}
        onDeleteMemo={onDeleteMemo}
        emptyContent={
          <>
            {t("memo.emptyForAsset")}
            <br />
            {onCreateMemo ? t("memo.assetWriteHint") : t("memo.assetPdfHint")}
          </>
        }
      />
    </div>
  );
}
