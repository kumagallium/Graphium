// ──────────────────────────────────────────────
// memoQuoteStore: 「メモの引用」ブロックと元のメモの紐づけ・サイドストア
//
// 引用の本文は BlockNote 標準の quote ブロックのまま（新しいブロック型は作らない。
// 旧版は未知のブロックを読み込み時に落とし、保存で本文が消えるため）。どの quote が
// どのメモの写しかは、mediaOcr / blockAlignments と同じ「独立アノテーション層」方式で
// blockId → MemoQuoteRef の Map として独立に持つ。保存時は page.memoQuotes に書き、
// 読み込み時に restoreSnapshot で戻す。
// ──────────────────────────────────────────────

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { MemoQuoteRef } from "../../lib/document-types";

export type MemoQuoteStore = {
  /** blockId → 紐づけ */
  quotes: Map<string, MemoQuoteRef>;
  /** 紐づけを設定する。null で外す（本文は残る） */
  setQuote: (blockId: string, ref: MemoQuoteRef | null) => void;
  getQuote: (blockId: string) => MemoQuoteRef | undefined;
  /** スナップショット（保存用） */
  getSnapshot: () => Record<string, MemoQuoteRef>;
  /** 復元（ロード用）。undefined ならクリア */
  restoreSnapshot: (snapshot: Record<string, MemoQuoteRef> | undefined) => void;
};

const Ctx = createContext<MemoQuoteStore | null>(null);

/**
 * 保存データから壊れた値を除く（旧版・手編集のノートに備える）。
 * quotedText が無い項目も捨てる — 残すと「元のメモと同じか」を比べられず、開くたびに
 * 「更新あり」になり続ける（本文は残り、紐づけだけが外れる）。
 */
function isMemoQuoteRef(v: unknown): v is MemoQuoteRef {
  if (!v || typeof v !== "object") return false;
  const r = v as Partial<MemoQuoteRef>;
  return typeof r.captureId === "string" && r.captureId.length > 0 && typeof r.quotedText === "string";
}

export function MemoQuoteProvider({ children }: { children: ReactNode }) {
  const [quotes, setQuotes] = useState<Map<string, MemoQuoteRef>>(new Map());

  const setQuote = useCallback((blockId: string, ref: MemoQuoteRef | null) => {
    setQuotes((prev) => {
      if (ref === null && !prev.has(blockId)) return prev;
      const next = new Map(prev);
      if (ref === null) next.delete(blockId);
      else next.set(blockId, ref);
      return next;
    });
  }, []);

  const getQuote = useCallback((blockId: string) => quotes.get(blockId), [quotes]);

  const getSnapshot = useCallback((): Record<string, MemoQuoteRef> => {
    const obj: Record<string, MemoQuoteRef> = {};
    for (const [k, v] of quotes) obj[k] = v;
    return obj;
  }, [quotes]);

  const restoreSnapshot = useCallback(
    (snapshot: Record<string, MemoQuoteRef> | undefined) => {
      const m = new Map<string, MemoQuoteRef>();
      if (snapshot) {
        for (const [k, v] of Object.entries(snapshot)) {
          if (isMemoQuoteRef(v)) m.set(k, v);
        }
      }
      setQuotes(m);
    },
    [],
  );

  // 値が変わらない限り同じ参照を返す（消費者の useEffect / useMemo の依存が無駄に動かないように）
  const value = useMemo<MemoQuoteStore>(
    () => ({ quotes, setQuote, getQuote, getSnapshot, restoreSnapshot }),
    [quotes, setQuote, getQuote, getSnapshot, restoreSnapshot],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMemoQuoteStore(): MemoQuoteStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("MemoQuoteProvider が見つかりません");
  return ctx;
}

/**
 * 非必須コンテキスト用フック。Provider が無い場合は null を返す。
 * Storybook・共有ノート・Wiki ドキュメントなど、メモの引用が不要な場面で使う。
 */
export function useMemoQuoteStoreOptional(): MemoQuoteStore | null {
  return useContext(Ctx);
}
