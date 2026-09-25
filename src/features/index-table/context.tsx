// インデックステーブル用の React Context
// ノート作成・遷移に必要な情報をカスタムブロック render に提供する

import { createContext, useContext, type ReactNode } from "react";
import type { GraphiumFile } from "../../lib/document-types";

type IndexTableContextValue = {
  // Google Drive 上のファイル一覧
  files: GraphiumFile[];
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
// グローバルコールバックも提供する。メインエディタのノートに固定の経路（グラフパネル・
// インライン画像など）が引く。行アイコンとスラッシュ挿入はエディタ単位の受け口（下）を引く
let _indexTableCallbacks: IndexTableContextValue | null = null;

export function setIndexTableCallbacks(
  callbacks: IndexTableContextValue | null
) {
  _indexTableCallbacks = callbacks;
}

export function getIndexTableCallbacks(): IndexTableContextValue | null {
  return _indexTableCallbacks;
}

const editorSidePeekCallbacks = new WeakMap<object, (noteId: string) => boolean>();

/**
 * カスタムブロックが属するエディタ自身の Side Peek を開く。
 * メインエディタと複数の Side Peek が同時に存在できるため、グローバル値ではなく
 * editor 実体をキーにして遷移先を分離する。
 */
export function setEditorSidePeekCallback(
  editor: object,
  callback: ((noteId: string) => boolean) | null,
) {
  if (callback) editorSidePeekCallbacks.set(editor, callback);
  else editorSidePeekCallbacks.delete(editor);
}

export function openEditorSidePeek(editor: unknown, noteId: string): boolean {
  if (
    editor === null ||
    (typeof editor !== "object" && typeof editor !== "function")
  ) {
    return false;
  }
  return editorSidePeekCallbacks.get(editor)?.(noteId) ?? false;
}

// ── エディタ単位の受け口（行アイコン・スラッシュ挿入） ──
// メインエディタと SidePeek は別のノートを開いている。受け口をグローバル 1 つにすると、
// ピークで押した結果（表の注釈・noteLinks）がメインのノートに書き込まれる。
// setEditorSidePeekCallback と同じく editor 実体をキーにして分ける。
// 登録の無いエディタはグローバルに倒さない（倒すとメインのノートに書き込む）。

/** 行アイコン（行からノートを作る・つながった行を開く）が、描いているエディタから引く受け口 */
export type EditorIndexTableCallbacks = {
  /** 同名ノートの確認に使うノートのファイル一覧 */
  files: GraphiumFile[];
  /** このエディタで開いているノート。行から作ったノートの派生元になる */
  currentFileId: string | null;
  /** 作ったノートをファイル一覧に載せる */
  onRefreshFiles: () => void;
  /** つながった行のノートを開く */
  onOpenSidePeek: (noteId: string) => void;
  /** このエディタのノートの doc に noteLink（derived_from）を足す */
  onAddNoteLink: (targetNoteId: string, sourceBlockId: string) => void;
  /**
   * 作った直後にそのノートを開く。メインは表の横のサイドピークに開く。
   * SidePeek は渡さない — 開くとピークの中身が差し替わり、表が見えなくなる（戻る導線も無い）
   */
  onNoteCreated?: (noteId: string) => void;
};

function editorKey(editor: unknown): object | null {
  if (editor === null || (typeof editor !== "object" && typeof editor !== "function")) {
    return null;
  }
  return editor;
}

const editorIndexTableCallbacks = new WeakMap<object, EditorIndexTableCallbacks>();

export function setEditorIndexTableCallbacks(
  editor: object | null | undefined,
  callbacks: EditorIndexTableCallbacks | null,
): void {
  if (!editor) return;
  if (callbacks) editorIndexTableCallbacks.set(editor, callbacks);
  else editorIndexTableCallbacks.delete(editor);
}

export function getEditorIndexTableCallbacks(editor: unknown): EditorIndexTableCallbacks | null {
  const key = editorKey(editor);
  return key ? editorIndexTableCallbacks.get(key) ?? null : null;
}

const registerIndexTableCallbacks = new WeakMap<object, (blockId: string) => void>();

/** スラッシュメニューで挿入した表をインデックステーブルにする（先頭列に note-link を付ける）受け口 */
export function setRegisterIndexTableCallback(
  editor: object | null | undefined,
  fn: ((blockId: string) => void) | null,
): void {
  if (!editor) return;
  if (fn) registerIndexTableCallbacks.set(editor, fn);
  else registerIndexTableCallbacks.delete(editor);
}

/** 挿入した表を、押されたエディタの受け口で登録する。受け口が無ければ false */
export function registerIndexTable(editor: unknown, blockId: string): boolean {
  const key = editorKey(editor);
  const fn = key ? registerIndexTableCallbacks.get(key) : undefined;
  if (!fn) return false;
  fn(blockId);
  return true;
}
