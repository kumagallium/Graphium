// ──────────────────────────────────────────────
// labelStore: blockId → ラベル文字列 + 連動属性 の Map 管理
//
// 実装方式: 独立アノテーション層（A 方式）を恒久採用。
// ブロックの props には寝かせず、外部 Map として管理する。
// 詳細は docs/internal/design-registry.md L-001 を参照。
//
// 呼び出し側の同期責任を露出させないため、ブロック削除・コピー・
// 派生継承などブロック ID が動く局面では useBlockLifecycle
// (features/block-lifecycle) を経由させる。
// ──────────────────────────────────────────────

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useState,
} from "react";
import {
  DEFAULT_STEP_ATTRIBUTES,
  hasLabelAttributes,
  type StepAttributes,
} from "./label-attributes";

export type LabelStore = {
  labels: Map<string, string>;
  /** blockId → 連動属性（現在は procedure のみ） */
  attributes: Map<string, StepAttributes>;
  /** 現在ドロップダウンが開いているブロックID（null = 閉じている） */
  openBlockId: string | null;
  setLabel: (blockId: string, label: string | null) => void;
  getLabel: (blockId: string) => string | undefined;
  setAttributes: (blockId: string, attrs: Partial<StepAttributes>) => void;
  getAttributes: (blockId: string) => StepAttributes | undefined;
  openDropdown: (blockId: string) => void;
  closeDropdown: () => void;
  /** ストア全体のスナップショット（テンプレート保存用） */
  getSnapshot: () => { labels: [string, string][]; attributes: [string, StepAttributes][] };
  /** スナップショットからストアを復元（テンプレート読み込み用） */
  restoreSnapshot: (snapshot: { labels: [string, string][]; attributes: [string, StepAttributes][] }) => void;
};

const LabelStoreContext = createContext<LabelStore | null>(null);

export function LabelStoreProvider({ children }: { children: ReactNode }) {
  const [labels, setLabels] = useState<Map<string, string>>(new Map());
  const [attributes, setAttributes] = useState<Map<string, StepAttributes>>(new Map());
  const [openBlockId, setOpenBlockId] = useState<string | null>(null);

  const setLabel = useCallback((blockId: string, label: string | null) => {
    setLabels((prev) => {
      const next = new Map(prev);
      if (label === null) {
        next.delete(blockId);
      } else {
        next.set(blockId, label);
      }
      return next;
    });

    // ラベル変更時に連動属性を管理
    setAttributes((prev) => {
      const next = new Map(prev);
      if (label === null || !hasLabelAttributes(label)) {
        // ラベル解除 or 連動属性なしラベル → 属性を削除
        next.delete(blockId);
      } else if (!prev.has(blockId)) {
        // 新たに procedure が付いた → デフォルト属性を設定
        next.set(blockId, { ...DEFAULT_STEP_ATTRIBUTES });
      }
      return next;
    });
  }, []);

  const getLabel = useCallback(
    (blockId: string) => labels.get(blockId),
    [labels],
  );

  const setAttrs = useCallback(
    (blockId: string, partial: Partial<StepAttributes>) => {
      setAttributes((prev) => {
        const current = prev.get(blockId);
        if (!current) return prev;
        const next = new Map(prev);
        next.set(blockId, { ...current, ...partial });
        return next;
      });
    },
    [],
  );

  const getAttrs = useCallback(
    (blockId: string) => attributes.get(blockId),
    [attributes],
  );

  const openDropdown = useCallback((blockId: string) => {
    setOpenBlockId(blockId);
  }, []);

  const closeDropdown = useCallback(() => {
    setOpenBlockId(null);
  }, []);

  const getSnapshot = useCallback(() => ({
    labels: Array.from(labels.entries()),
    attributes: Array.from(attributes.entries()),
  }), [labels, attributes]);

  const restoreSnapshot = useCallback(
    (snapshot: { labels: [string, string][]; attributes: [string, StepAttributes][] }) => {
      setLabels(new Map(snapshot.labels));
      setAttributes(new Map(snapshot.attributes));
    },
    [],
  );

  return (
    <LabelStoreContext.Provider
      value={{
        labels,
        attributes,
        openBlockId,
        setLabel,
        getLabel,
        setAttributes: setAttrs,
        getAttributes: getAttrs,
        openDropdown,
        closeDropdown,
        getSnapshot,
        restoreSnapshot,
      }}
    >
      {children}
    </LabelStoreContext.Provider>
  );
}

export function useLabelStore(): LabelStore {
  const ctx = useContext(LabelStoreContext);
  if (!ctx) throw new Error("LabelStoreProvider が見つかりません");
  return ctx;
}
