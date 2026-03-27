// ──────────────────────────────────────────────
// linkMap ストア: ブロック間リンクの一元管理
//
// サンドボックス実装方式: React Context + Map
// 本番移行時はブロックprops（正参照・逆参照）方式に変換する
// ──────────────────────────────────────────────

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useState,
} from "react";
import type { BlockLink, CreatedBy, LinkLayer, LinkType } from "./link-types";
import { isProvLink } from "./link-types";

let linkIdCounter = 0;
function generateLinkId() {
  return `link-${Date.now()}-${linkIdCounter++}`;
}

export type AddLinkResult = { error: null; link: BlockLink } | { error: "cycle_detected"; link: null };

export type LinkStore = {
  links: BlockLink[];
  /** リンクを追加（PROV 層は循環検出あり） */
  addLink: (params: {
    sourceBlockId: string;
    targetBlockId: string;
    type: LinkType;
    createdBy: CreatedBy;
    targetPageId?: string;
    targetNoteId?: string;
    layer?: LinkLayer;
  }) => AddLinkResult;
  /** リンクを削除 */
  removeLink: (linkId: string) => void;
  /** 特定ブロックから出るリンク（正参照） */
  getOutgoing: (blockId: string) => BlockLink[];
  /** 特定ブロックへ来るリンク（逆参照） */
  getIncoming: (blockId: string) => BlockLink[];
  /** 全リンク取得（テンプレート保存用） */
  getAllLinks: () => BlockLink[];
  /** リンク一括復元（テンプレート読み込み用） */
  restoreLinks: (links: BlockLink[]) => void;
};

const LinkStoreContext = createContext<LinkStore | null>(null);

export function LinkStoreProvider({ children }: { children: ReactNode }) {
  const [links, setLinks] = useState<BlockLink[]>([]);

  const addLink = useCallback(
    (params: {
      sourceBlockId: string;
      targetBlockId: string;
      type: LinkType;
      createdBy: CreatedBy;
      targetPageId?: string;
      targetNoteId?: string;
      layer?: LinkLayer;
    }): AddLinkResult => {
      const layer = params.layer ?? (isProvLink(params.type) ? "prov" : "knowledge");

      // PROV 層は DAG 制約: 循環検出
      if (layer === "prov") {
        const wouldCycle = detectCycle(links, params.sourceBlockId, params.targetBlockId);
        if (wouldCycle) {
          return { error: "cycle_detected", link: null };
        }
      }

      const link: BlockLink = {
        id: generateLinkId(),
        sourceBlockId: params.sourceBlockId,
        targetBlockId: params.targetBlockId,
        type: params.type,
        layer,
        createdBy: params.createdBy,
        targetPageId: params.targetPageId,
        targetNoteId: params.targetNoteId,
      };
      setLinks((prev) => [...prev, link]);
      return { error: null, link };
    },
    [links],
  );

  const removeLink = useCallback((linkId: string) => {
    setLinks((prev) => prev.filter((l) => l.id !== linkId));
  }, []);

  const getOutgoing = useCallback(
    (blockId: string) => links.filter((l) => l.sourceBlockId === blockId),
    [links],
  );

  const getIncoming = useCallback(
    (blockId: string) => links.filter((l) => l.targetBlockId === blockId),
    [links],
  );

  const getAllLinks = useCallback(() => [...links], [links]);

  const restoreLinks = useCallback((restored: BlockLink[]) => {
    // v1 → v2 マイグレーション: layer フィールドがない場合は自動付与
    const migrated = restored.map((link) => {
      if (!link.layer) {
        return { ...link, layer: (isProvLink(link.type) ? "prov" : "knowledge") as LinkLayer };
      }
      return link;
    });
    setLinks(migrated);
  }, []);

  return (
    <LinkStoreContext.Provider
      value={{ links, addLink, removeLink, getOutgoing, getIncoming, getAllLinks, restoreLinks }}
    >
      {children}
    </LinkStoreContext.Provider>
  );
}

export function useLinkStore(): LinkStore {
  const ctx = useContext(LinkStoreContext);
  if (!ctx) throw new Error("LinkStoreProvider が見つかりません");
  return ctx;
}

/**
 * PROV 層の DAG 循環検出。
 * source → target の辺を追加した場合に、target から source への経路が存在するかチェック。
 */
function detectCycle(
  links: BlockLink[],
  sourceBlockId: string,
  targetBlockId: string,
): boolean {
  // target から BFS で source に到達可能か？
  const provLinks = links.filter((l) => l.layer === "prov");
  const adjacency = new Map<string, string[]>();
  for (const link of provLinks) {
    const targets = adjacency.get(link.sourceBlockId) ?? [];
    targets.push(link.targetBlockId);
    adjacency.set(link.sourceBlockId, targets);
  }

  // 新しい辺を仮追加
  const fromSource = adjacency.get(sourceBlockId) ?? [];
  fromSource.push(targetBlockId);
  adjacency.set(sourceBlockId, fromSource);

  // target から BFS で source に到達可能か
  const visited = new Set<string>();
  const queue = [targetBlockId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === sourceBlockId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const neighbors = adjacency.get(current) ?? [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) queue.push(neighbor);
    }
  }
  return false;
}
