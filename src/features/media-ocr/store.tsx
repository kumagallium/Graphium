// ──────────────────────────────────────────────
// mediaOcrStore: 画像ブロックの OCR テキスト・サイドストア
//
// 標準の image ブロック（BlockNote 提供）は content="none" で、スキーマ拡張は
// 影響範囲が大きい。そこで mediaInlineLabels と同じ「独立アノテーション層」方式で
// blockId → OCR 結果の Map を独立に持つ。
//
// この方式にすることで、画像の入れ方（/image・ペースト・ドラッグ&ドロップ・
// 素材ギャラリーからの挿入）を問わず、どの画像でも後から文字を読める。
// 専用ブロックに貼り直す必要がない。
// ──────────────────────────────────────────────

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useState,
} from "react";
import type { MediaOcrEntry } from "../../lib/document-types";

export type MediaOcrStore = {
  /** blockId → OCR 結果 */
  entries: Map<string, MediaOcrEntry>;
  setEntry: (blockId: string, entry: MediaOcrEntry | null) => void;
  getEntry: (blockId: string) => MediaOcrEntry | undefined;
  /** スナップショット（保存用） */
  getSnapshot: () => Record<string, MediaOcrEntry>;
  /** 復元（ロード用） */
  restoreSnapshot: (snapshot: Record<string, MediaOcrEntry> | undefined) => void;
};

const Ctx = createContext<MediaOcrStore | null>(null);

export function MediaOcrProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Map<string, MediaOcrEntry>>(new Map());

  const setEntry = useCallback((blockId: string, entry: MediaOcrEntry | null) => {
    setEntries((prev) => {
      const next = new Map(prev);
      if (entry === null) {
        next.delete(blockId);
      } else {
        next.set(blockId, entry);
      }
      return next;
    });
  }, []);

  const getEntry = useCallback(
    (blockId: string) => entries.get(blockId),
    [entries],
  );

  const getSnapshot = useCallback((): Record<string, MediaOcrEntry> => {
    const obj: Record<string, MediaOcrEntry> = {};
    for (const [k, v] of entries) obj[k] = v;
    return obj;
  }, [entries]);

  const restoreSnapshot = useCallback(
    (snapshot: Record<string, MediaOcrEntry> | undefined) => {
      const m = new Map<string, MediaOcrEntry>();
      if (snapshot) {
        for (const [k, v] of Object.entries(snapshot)) m.set(k, v);
      }
      setEntries(m);
    },
    [],
  );

  return (
    <Ctx.Provider value={{ entries, setEntry, getEntry, getSnapshot, restoreSnapshot }}>
      {children}
    </Ctx.Provider>
  );
}

export function useMediaOcrStore(): MediaOcrStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("MediaOcrProvider が見つかりません");
  return ctx;
}

/**
 * 非必須コンテキスト用フック。Provider が無い場合は null を返す。
 * Storybook や Wiki ドキュメントなど、OCR 機能が不要な場面で使う。
 */
export function useMediaOcrStoreOptional(): MediaOcrStore | null {
  return useContext(Ctx);
}
