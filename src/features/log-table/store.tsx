// 記録テーブルストア
// どのテーブルブロックが「記録テーブル」（時刻付きの繰り返し記録）であるかを追跡する。
// index-table の store と同じ「標準 table + 外部ストア」パターン。
//
// v1 の設定値は空オブジェクト（登録フラグのみ）。将来、列の自動入力
// （天気・センサー値など）の設定をここに持たせる想定で Record にしている。

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type LogTableConfig = Record<string, unknown>;

type LogTableState = Map<string, LogTableConfig>;

type LogTableStoreValue = {
  // 登録された記録テーブル一覧
  tables: LogTableState;
  // テーブルを記録テーブルとして登録
  register: (blockId: string) => void;
  // テーブルの登録を解除
  unregister: (blockId: string) => void;
  // ブロックが記録テーブルかどうか
  isLogTable: (blockId: string) => boolean;
  // テーブル名（キャプション）。未設定は空文字
  getName: (blockId: string) => string;
  setName: (blockId: string, name: string) => void;
  // 全データのスナップショット（保存用）
  getSnapshot: () => Record<string, LogTableConfig>;
  // データの復元（読み込み用）。undefined ならクリアとして扱う
  restore: (data: Record<string, LogTableConfig> | undefined) => void;
};

const LogTableContext = createContext<LogTableStoreValue | null>(null);

export function LogTableStoreProvider({ children }: { children: ReactNode }) {
  const [tables, setTables] = useState<LogTableState>(new Map());
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

  const isLogTable = useCallback(
    (blockId: string) => tablesRef.current.has(blockId),
    []
  );

  const getName = useCallback((blockId: string) => {
    const name = tablesRef.current.get(blockId)?.name;
    return typeof name === "string" ? name : "";
  }, []);

  const setName = useCallback((blockId: string, name: string) => {
    setTables((prev) => {
      if (!prev.has(blockId)) return prev;
      const next = new Map(prev);
      next.set(blockId, { ...prev.get(blockId), name: name.trim() });
      return next;
    });
  }, []);

  const getSnapshot = useCallback((): Record<string, LogTableConfig> => {
    const result: Record<string, LogTableConfig> = {};
    tablesRef.current.forEach((config, blockId) => {
      result[blockId] = config;
    });
    return result;
  }, []);

  const restore = useCallback(
    (data: Record<string, LogTableConfig> | undefined) => {
      const next = new Map<string, LogTableConfig>();
      for (const [blockId, config] of Object.entries(data ?? {})) {
        next.set(blockId, config ?? {});
      }
      setTables(next);
    },
    []
  );

  return (
    <LogTableContext.Provider
      value={{ tables, register, unregister, isLogTable, getName, setName, getSnapshot, restore }}
    >
      {children}
    </LogTableContext.Provider>
  );
}

export function useLogTableStore(): LogTableStoreValue {
  const ctx = useContext(LogTableContext);
  if (!ctx) {
    throw new Error("useLogTableStore must be used within LogTableStoreProvider");
  }
  return ctx;
}

/**
 * Provider が無い場所（Storybook の単体ストーリーや将来の mount 形態）でも
 * 落ちずに使うための optional 版。チャートブロックの「参照テーブル名の解決」の
 * ように、無ければ無いで動ける読み取りに使う。
 */
export function useLogTableStoreOptional(): LogTableStoreValue | null {
  return useContext(LogTableContext);
}
