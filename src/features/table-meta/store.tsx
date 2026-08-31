// テーブル注釈ストア
//
// 旧 log-table / index-table の 2 つのストアを 1 つに統合したもの。テーブルの
// ふるまいはすべてここから導出する（どの列に何のはたらきが付いているか）。
// 標準 table ブロック + 外部ストアという方式自体は従来どおりで、テーブル本体は
// Markdown 書き出しでそのまま残る。

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  hasColumnType as metaHasColumnType,
  isTableMetaEmpty,
  withColumnType,
  withoutColumnType,
  type ColumnType,
  type TableColumnsIndex,
  type TableMeta,
  type TableSource,
} from "./types";

type TableMetaState = Map<string, TableMeta>;

type TableMetaStoreValue = {
  /** テーブルブロック ID → 注釈 */
  metas: TableMetaState;
  // ── 列のふるまい ──
  /** そのふるまいを持つ列があるか */
  hasColumnType: (blockId: string, type: ColumnType) => boolean;
  /** 列にふるまいを付ける（適用位置が先頭列固定の間は、先頭列の名前を渡す） */
  addColumnType: (blockId: string, columnName: string, type: ColumnType) => void;
  /** そのふるまいをテーブルから外す。note-link は行の紐付けも一緒に消える */
  removeColumnType: (blockId: string, type: ColumnType) => void;
  /** そのふるまいを持つテーブルの blockId 一覧 */
  blockIdsWithColumnType: (type: ColumnType) => string[];
  // ── キャプション（テーブルの名前） ──
  getCaption: (blockId: string) => string;
  setCaption: (blockId: string, caption: string) => void;
  // ── 取り込み元（外部データから作られた表の出所） ──
  getSource: (blockId: string) => TableSource | undefined;
  setSource: (blockId: string, source: TableSource | undefined) => void;
  // ── note-link 列の行 → ノート紐付け ──
  getNoteLinks: (blockId: string) => Record<string, string>;
  setNoteLink: (blockId: string, rowValue: string, noteId: string) => void;
  // ── 表の中身（計算ブロックなど「表を読む側」への配布）──
  /**
   * 表示名 → { 列名 → 列データ }。ホスト（ノート）が本文の変更のたびに置き直す。
   * ブロックの render に渡る editor.document は描画時点のスナップショットで
   * 古くなる（実測）ため、生きた表の中身はここから読む。null は未配布
   * （ノート読込直後など）。読む側は自前のフォールバックを持つ
   */
  tableColumns: TableColumnsIndex | null;
  /** ホストが本文の変更のたびに表の中身を置き直す */
  setTableColumns: (columns: TableColumnsIndex) => void;
  // ── 保存・復元 ──
  getSnapshot: () => Record<string, TableMeta>;
  restore: (data: Record<string, TableMeta> | undefined) => void;
  // ── ⠿ メニューからキャプション層の編集を始めるための受け渡し ──
  captionEditRequest: string | null;
  requestCaptionEdit: (blockId: string) => void;
  clearCaptionEditRequest: () => void;
};

const TableMetaContext = createContext<TableMetaStoreValue | null>(null);

export function TableMetaStoreProvider({ children }: { children: ReactNode }) {
  const [metas, setMetas] = useState<TableMetaState>(new Map());
  // 表の中身（表示名 → 列名 → 数値）。ホストが編集のたびに置き直す
  const [tableColumns, setTableColumnsState] = useState<TableColumnsIndex | null>(null);
  const setTableColumns = useCallback(
    (columns: TableColumnsIndex) => {
      // 中身が同じなら参照も変えない（calc の再評価を無駄に起こさない）
      setTableColumnsState((prev) =>
        prev && JSON.stringify(prev) === JSON.stringify(columns) ? prev : columns
      );
    },
    []
  );
  const metasRef = useRef(metas);
  metasRef.current = metas;
  const [captionEditRequest, setCaptionEditRequest] = useState<string | null>(null);

  /** 1 テーブル分を書き換える。中身が空になったらエントリごと落とす */
  const updateMeta = useCallback(
    (blockId: string, mutate: (current: TableMeta) => TableMeta) => {
      setMetas((prev) => {
        const next = new Map(prev);
        const updated = mutate(prev.get(blockId) ?? {});
        if (isTableMetaEmpty(updated)) {
          if (!prev.has(blockId)) return prev;
          next.delete(blockId);
        } else {
          next.set(blockId, updated);
        }
        return next;
      });
    },
    []
  );

  const hasColumnType = useCallback(
    (blockId: string, type: ColumnType) =>
      metaHasColumnType(metasRef.current.get(blockId), type),
    []
  );

  const addColumnType = useCallback(
    (blockId: string, columnName: string, type: ColumnType) => {
      updateMeta(blockId, (current) => ({
        ...current,
        columns: withColumnType(current.columns, columnName, type),
      }));
    },
    [updateMeta]
  );

  const removeColumnType = useCallback(
    (blockId: string, type: ColumnType) => {
      updateMeta(blockId, (current) => {
        const columns = withoutColumnType(current.columns, type);
        const next: TableMeta = { ...current, columns };
        // 行とノートの紐付けは note-link 列のデータなので、外すときに一緒に消す
        // （ノート本体は残る）
        if (type === "note-link") delete next.noteLinks;
        if (Object.keys(columns).length === 0) delete next.columns;
        return next;
      });
    },
    [updateMeta]
  );

  const blockIdsWithColumnType = useCallback((type: ColumnType) => {
    const ids: string[] = [];
    metasRef.current.forEach((meta, blockId) => {
      if (metaHasColumnType(meta, type)) ids.push(blockId);
    });
    return ids;
  }, []);

  const getCaption = useCallback(
    (blockId: string) => metasRef.current.get(blockId)?.caption ?? "",
    []
  );

  const setCaption = useCallback(
    (blockId: string, caption: string) => {
      const trimmed = caption.trim();
      updateMeta(blockId, (current) => {
        const next: TableMeta = { ...current };
        if (trimmed.length > 0) next.caption = trimmed;
        else delete next.caption;
        return next;
      });
    },
    [updateMeta]
  );

  const getSource = useCallback(
    (blockId: string) => metasRef.current.get(blockId)?.source,
    []
  );

  const setSource = useCallback(
    (blockId: string, source: TableSource | undefined) => {
      updateMeta(blockId, (current) => {
        const next: TableMeta = { ...current };
        if (source) next.source = source;
        else delete next.source;
        return next;
      });
    },
    [updateMeta]
  );

  const getNoteLinks = useCallback(
    (blockId: string) => metasRef.current.get(blockId)?.noteLinks ?? {},
    []
  );

  const setNoteLink = useCallback(
    (blockId: string, rowValue: string, noteId: string) => {
      updateMeta(blockId, (current) => ({
        ...current,
        noteLinks: { ...current.noteLinks, [rowValue]: noteId },
      }));
    },
    [updateMeta]
  );

  const getSnapshot = useCallback((): Record<string, TableMeta> => {
    const result: Record<string, TableMeta> = {};
    metasRef.current.forEach((meta, blockId) => {
      if (!isTableMetaEmpty(meta)) result[blockId] = meta;
    });
    return result;
  }, []);

  const restore = useCallback((data: Record<string, TableMeta> | undefined) => {
    const next = new Map<string, TableMeta>();
    for (const [blockId, meta] of Object.entries(data ?? {})) {
      if (!isTableMetaEmpty(meta)) next.set(blockId, meta);
    }
    setMetas(next);
  }, []);

  const requestCaptionEdit = useCallback((blockId: string) => {
    setCaptionEditRequest(blockId);
  }, []);

  const clearCaptionEditRequest = useCallback(() => {
    setCaptionEditRequest(null);
  }, []);

  return (
    <TableMetaContext.Provider
      value={{
        metas,
        hasColumnType,
        addColumnType,
        removeColumnType,
        blockIdsWithColumnType,
        getCaption,
        setCaption,
        getSource,
        setSource,
        getNoteLinks,
        setNoteLink,
        tableColumns,
        setTableColumns,
        getSnapshot,
        restore,
        captionEditRequest,
        requestCaptionEdit,
        clearCaptionEditRequest,
      }}
    >
      {children}
    </TableMetaContext.Provider>
  );
}

export function useTableMetaStore(): TableMetaStoreValue {
  const ctx = useContext(TableMetaContext);
  if (!ctx) {
    throw new Error("useTableMetaStore must be used within TableMetaStoreProvider");
  }
  return ctx;
}

/**
 * Provider が無い場所（Storybook の単体ストーリーや将来の mount 形態）でも
 * 落ちずに使うための optional 版。チャートブロックの「参照テーブル名の解決」や
 * ドラッグハンドルメニューのように、無ければ無いで動ける読み書きに使う。
 */
export function useTableMetaStoreOptional(): TableMetaStoreValue | null {
  return useContext(TableMetaContext);
}

export type { TableMetaStoreValue };
