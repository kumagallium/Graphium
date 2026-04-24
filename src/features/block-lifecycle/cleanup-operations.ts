// ──────────────────────────────────────────────
// cleanup-operations
//
// useBlockLifecycle の純粋関数コア。
// store への副作用は持つが、React/BlockNote に依存しない。
// ユニットテスト用の分離。
// ──────────────────────────────────────────────

import type { LabelStore } from "../context-label/store";
import type { LinkStore } from "../block-link/store";

type LabelStoreLike = Pick<
  LabelStore,
  "labels" | "setLabel" | "getLabel" | "getAttributes" | "setAttributes"
>;

type LinkStoreLike = Pick<
  LinkStore,
  "getAllLinks" | "addLink" | "removeLinksForBlock"
>;

/**
 * 指定ブロック群の labels / provLinks を store から除去する。
 * 存在しないブロック ID は no-op。
 */
export function cleanupBlockMetadata(
  blockIds: readonly string[],
  labelStore: LabelStoreLike,
  linkStore: LinkStoreLike,
): void {
  if (blockIds.length === 0) return;
  for (const id of blockIds) {
    if (labelStore.labels.has(id)) {
      labelStore.setLabel(id, null);
    }
    linkStore.removeLinksForBlock(id);
  }
}

/**
 * 旧 ID → 新 ID のマップに従って labels を複製する。
 * 連動属性（procedure 等）も併せて複製される。
 */
export function copyLabelsByIdMap(
  idMap: ReadonlyMap<string, string>,
  labelStore: LabelStoreLike,
): void {
  for (const [fromId, toId] of idMap) {
    if (fromId === toId) continue;
    const label = labelStore.getLabel(fromId);
    if (!label) continue;
    labelStore.setLabel(toId, label);
    const attrs = labelStore.getAttributes(fromId);
    if (attrs) {
      labelStore.setAttributes(toId, attrs);
    }
  }
}

/**
 * 旧 ID → 新 ID のマップに従って provLinks を複製する。
 * コピー対象集合の内側で閉じたリンクのみ運ぶ。
 * 片端しか含まれないリンクは意味論が曖昧なので運ばない。
 */
export function copyLinksByIdMap(
  idMap: ReadonlyMap<string, string>,
  linkStore: LinkStoreLike,
): void {
  const existing = linkStore.getAllLinks();
  for (const link of existing) {
    const newSource = idMap.get(link.sourceBlockId);
    const newTarget = idMap.get(link.targetBlockId);
    if (!newSource || !newTarget) continue;
    linkStore.addLink({
      sourceBlockId: newSource,
      targetBlockId: newTarget,
      type: link.type,
      createdBy: link.createdBy,
      targetPageId: link.targetPageId,
      targetNoteId: link.targetNoteId,
      layer: link.layer,
    });
  }
}
