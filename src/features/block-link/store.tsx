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
import type { BlockLink, CreatedBy, LinkType } from "./link-types";

let linkIdCounter = 0;
function generateLinkId() {
  return `link-${Date.now()}-${linkIdCounter++}`;
}

export type LinkStore = {
  links: BlockLink[];
  /** リンクを追加 */
  addLink: (params: {
    sourceBlockId: string;
    targetBlockId: string;
    type: LinkType;
    createdBy: CreatedBy;
    targetPageId?: string;
  }) => BlockLink;
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
    }): BlockLink => {
      const link: BlockLink = {
        id: generateLinkId(),
        ...params,
      };
      setLinks((prev) => [...prev, link]);
      return link;
    },
    [],
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
    setLinks(restored);
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
