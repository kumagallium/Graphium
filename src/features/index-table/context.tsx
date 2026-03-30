// インデックステーブル用の React Context
// ノート作成・遷移に必要な情報をカスタムブロック render に提供する

import { createContext, useContext, type ReactNode } from "react";
import type { ProvNoteFile } from "../../lib/google-drive";

type IndexTableContextValue = {
  // Google Drive 上のファイル一覧
  files: ProvNoteFile[];
  // 現在開いているファイル ID
  currentFileId: string | null;
  // ノートに遷移するコールバック
  onNavigateNote: (noteId: string) => void;
  // ファイル一覧を再取得するコールバック
  onRefreshFiles: () => void;
  // サイドピークを開くコールバック
  onOpenSidePeek: (noteId: string) => void;
  // 親ドキュメントに noteLink を追加するコールバック
  onAddNoteLink: (targetNoteId: string, sourceBlockId: string) => void;
};

const IndexTableContext = createContext<IndexTableContextValue | null>(null);

export function IndexTableProvider({
  children,
  files,
  currentFileId,
  onNavigateNote,
  onRefreshFiles,
  onOpenSidePeek,
  onAddNoteLink,
}: IndexTableContextValue & { children: ReactNode }) {
  return (
    <IndexTableContext.Provider
      value={{ files, currentFileId, onNavigateNote, onRefreshFiles, onOpenSidePeek, onAddNoteLink }}
    >
      {children}
    </IndexTableContext.Provider>
  );
}

export function useIndexTable(): IndexTableContextValue {
  const ctx = useContext(IndexTableContext);
  if (!ctx) {
    throw new Error("useIndexTable must be used within IndexTableProvider");
  }
  return ctx;
}

// カスタムブロック render 内では Context が利用できない場合があるため、
// グローバルコールバックも提供する
let _indexTableCallbacks: IndexTableContextValue | null = null;

export function setIndexTableCallbacks(
  callbacks: IndexTableContextValue | null
) {
  _indexTableCallbacks = callbacks;
}

export function getIndexTableCallbacks(): IndexTableContextValue | null {
  return _indexTableCallbacks;
}
