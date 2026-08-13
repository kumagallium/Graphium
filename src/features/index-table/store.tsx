// インデックステーブルストア
// どのテーブルブロックが「インデックステーブル」であるかを追跡し、
// linkedNotes の状態を管理する

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { LinkedNotesMap } from "./types";
import { parseLinkedNotes } from "./types";

// テーブルブロック ID → linkedNotes のマッピング
type IndexTableState = Map<string, LinkedNotesMap>;

type IndexTableStoreValue = {
  // 登録されたインデックステーブル一覧
  tables: IndexTableState;
  // テーブルをインデックステーブルとして登録
  register: (blockId: string) => void;
  // テーブルの登録を解除
  unregister: (blockId: string) => void;
  // ブロックがインデックステーブルかどうか
  isIndexTable: (blockId: string) => boolean;
  // linkedNotes を取得
  getLinkedNotes: (blockId: string) => LinkedNotesMap;
  // linkedNotes を更新
  setLinkedNote: (blockId: string, sampleName: string, noteId: string) => void;
  // 全データのスナップショット（保存用）
  getSnapshot: () => Record<string, LinkedNotesMap>;
  // データの復元（読み込み用）
  restore: (data: Record<string, LinkedNotesMap>) => void;
};

const IndexTableContext = createContext<IndexTableStoreValue | null>(null);

export function IndexTableStoreProvider({ children }: { children: ReactNode }) {
  const [tables, setTables] = useState<IndexTableState>(new Map());
  const tablesRef = useRef(tables);
  tablesRef.current = tables;

  const register = useCallback((blockId: string) => {
    setTables((prev) => {
      if (prev.has(blockId)) return prev;
      const next = new Map(prev);
      next.set(blockId, {});
      return next;
    });
  }, []);

  const unregister = useCallback((blockId: string) => {
    setTables((prev) => {
      if (!prev.has(blockId)) return prev;
      const next = new Map(prev);
      next.delete(blockId);
      return next;
    });
  }, []);

  const isIndexTable = useCallback(
    (blockId: string) => tablesRef.current.has(blockId),
    []
  );

  const getLinkedNotes = useCallback(
    (blockId: string) => tablesRef.current.get(blockId) ?? {},
    []
  );

  const setLinkedNote = useCallback(
    (blockId: string, sampleName: string, noteId: string) => {
      setTables((prev) => {
        const current = prev.get(blockId) ?? {};
        const next = new Map(prev);
        next.set(blockId, { ...current, [sampleName]: noteId });
        return next;
      });
    },
    []
  );

  const getSnapshot = useCallback((): Record<string, LinkedNotesMap> => {
    const result: Record<string, LinkedNotesMap> = {};
    tablesRef.current.forEach((linkedNotes, blockId) => {
      result[blockId] = linkedNotes;
    });
    return result;
  }, []);

  const restore = useCallback((data: Record<string, LinkedNotesMap>) => {
    const next = new Map<string, LinkedNotesMap>();
    for (const [blockId, linkedNotes] of Object.entries(data)) {
      next.set(blockId, linkedNotes);
    }
    setTables(next);
  }, []);

  return (
    <IndexTableContext.Provider
      value={{
        tables,
        register,
        unregister,
        isIndexTable,
        getLinkedNotes,
        setLinkedNote,
        getSnapshot,
        restore,
      }}
    >
      {children}
    </IndexTableContext.Provider>
  );
}

export function useIndexTableStore(): IndexTableStoreValue {
  const ctx = useContext(IndexTableContext);
  if (!ctx) {
    throw new Error(
      "useIndexTableStore must be used within IndexTableStoreProvider"
    );
  }
  return ctx;
}

/**
 * Provider が無い場所（Storybook の単体ストーリー等）でも落ちずに使うための
 * optional 版。ドラッグハンドルメニューのトグルのように、無ければ項目を
 * 出さないだけでよい読み書きに使う。
 */
export function useIndexTableStoreOptional(): IndexTableStoreValue | null {
  return useContext(IndexTableContext);
}
