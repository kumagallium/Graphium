// ──────────────────────────────────────────────
// blockAlignmentStore: ブロックの配置揃え（左 / 中央 / 右）サイドストア（2026-06）
//
// BlockNote の `textAlignment` プロパティを持たないブロック（table / audio /
// file）の配置を blockId → 値 の Map として独立に保持する。mediaInlineLabelStore
// と同じ「独立アノテーション層」方式。段落・見出し・画像・動画・Callout は標準の
// textAlignment プロパティで配置するため、このストアは使わない。
//
// 適用は AlignmentStyleLayer が blockId 指定の CSS を注入して行う（BlockNote の
// 再描画で属性が消える問題を避けるため、DOM 属性ではなく data-id セレクタで効かせる）。
// ──────────────────────────────────────────────

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useState,
} from "react";

export type BlockAlignment = "left" | "center" | "right";

export type BlockAlignmentStore = {
  /** blockId → 配置 */
  alignments: Map<string, BlockAlignment>;
  /** 配置を設定する。"left"（既定）を渡すとエントリを削除する */
  setAlignment: (blockId: string, alignment: BlockAlignment) => void;
  getAlignment: (blockId: string) => BlockAlignment | undefined;
  /** スナップショット（保存用） */
  getSnapshot: () => Record<string, BlockAlignment>;
  /** 復元（ロード用） */
  restoreSnapshot: (snapshot: Record<string, BlockAlignment> | undefined) => void;
};

const Ctx = createContext<BlockAlignmentStore | null>(null);

export function BlockAlignmentProvider({ children }: { children: ReactNode }) {
  const [alignments, setAlignments] = useState<Map<string, BlockAlignment>>(new Map());

  const setAlignment = useCallback((blockId: string, alignment: BlockAlignment) => {
    setAlignments((prev) => {
      const next = new Map(prev);
      // "left" は既定値なので保存しない（スナップショットを最小に保つ）
      if (alignment === "left") {
        next.delete(blockId);
      } else {
        next.set(blockId, alignment);
      }
      return next;
    });
  }, []);

  const getAlignment = useCallback(
    (blockId: string) => alignments.get(blockId),
    [alignments],
  );

  const getSnapshot = useCallback((): Record<string, BlockAlignment> => {
    const obj: Record<string, BlockAlignment> = {};
    for (const [k, v] of alignments) obj[k] = v;
    return obj;
  }, [alignments]);

  const restoreSnapshot = useCallback(
    (snapshot: Record<string, BlockAlignment> | undefined) => {
      const m = new Map<string, BlockAlignment>();
      if (snapshot) {
        for (const [k, v] of Object.entries(snapshot)) {
          if (v === "center" || v === "right") m.set(k, v);
        }
      }
      setAlignments(m);
    },
    [],
  );

  return (
    <Ctx.Provider
      value={{ alignments, setAlignment, getAlignment, getSnapshot, restoreSnapshot }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useBlockAlignmentStore(): BlockAlignmentStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("BlockAlignmentProvider が見つかりません");
  return ctx;
}

/** 非必須コンテキスト用フック。Provider が無い場合は null を返す（Storybook 等）。 */
export function useBlockAlignmentStoreOptional(): BlockAlignmentStore | null {
  return useContext(Ctx);
}
