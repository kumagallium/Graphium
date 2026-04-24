import { describe, it, expect, vi } from "vitest";
import {
  cleanupBlockMetadata,
  copyLabelsByIdMap,
  copyLinksByIdMap,
} from "./cleanup-operations";
import type { BlockLink, CreatedBy, LinkLayer, LinkType } from "../block-link/link-types";
import type { StepAttributes } from "../context-label/label-attributes";

// ── LabelStore のスタブ ──────────────────────────────
function makeLabelStoreStub(initial: Record<string, string> = {}) {
  const labels = new Map<string, string>(Object.entries(initial));
  const attributes = new Map<string, StepAttributes>();
  return {
    labels,
    attributes,
    setLabel: vi.fn((blockId: string, label: string | null) => {
      if (label === null) labels.delete(blockId);
      else labels.set(blockId, label);
    }),
    getLabel: (blockId: string) => labels.get(blockId),
    getAttributes: (blockId: string) => attributes.get(blockId),
    setAttributes: vi.fn((blockId: string, partial: Partial<StepAttributes>) => {
      const current = attributes.get(blockId);
      if (current) {
        attributes.set(blockId, { ...current, ...partial });
      } else {
        // partial only; テスト用に最低限マージ
        attributes.set(blockId, partial as StepAttributes);
      }
    }),
  };
}

// ── LinkStore のスタブ ──────────────────────────────
function makeLinkStoreStub(initial: BlockLink[] = []) {
  const links = [...initial];
  return {
    links,
    getAllLinks: () => [...links],
    addLink: vi.fn((params: {
      sourceBlockId: string;
      targetBlockId: string;
      type: LinkType;
      createdBy: CreatedBy;
      targetPageId?: string;
      targetNoteId?: string;
      layer?: LinkLayer;
    }) => {
      const link: BlockLink = {
        id: `link-${links.length}`,
        sourceBlockId: params.sourceBlockId,
        targetBlockId: params.targetBlockId,
        type: params.type,
        createdBy: params.createdBy,
        targetPageId: params.targetPageId,
        targetNoteId: params.targetNoteId,
        layer: params.layer ?? "prov",
      };
      links.push(link);
      return { error: null as null, link };
    }),
    removeLinksForBlock: vi.fn((blockId: string) => {
      for (let i = links.length - 1; i >= 0; i--) {
        const l = links[i];
        if (l.sourceBlockId === blockId || l.targetBlockId === blockId) {
          links.splice(i, 1);
        }
      }
    }),
  };
}

describe("cleanupBlockMetadata", () => {
  it("指定ブロックの labels を削除する", () => {
    const labelStore = makeLabelStoreStub({ "b1": "procedure", "b2": "material" });
    const linkStore = makeLinkStoreStub();

    cleanupBlockMetadata(["b1"], labelStore, linkStore);

    expect(labelStore.labels.has("b1")).toBe(false);
    expect(labelStore.labels.get("b2")).toBe("material");
    expect(labelStore.setLabel).toHaveBeenCalledWith("b1", null);
  });

  it("指定ブロックの provLinks を削除する", () => {
    const labelStore = makeLabelStoreStub();
    const linkStore = makeLinkStoreStub([
      {
        id: "l1",
        sourceBlockId: "b1",
        targetBlockId: "b2",
        type: "derived_from",
        layer: "prov",
        createdBy: "human",
      },
    ]);

    cleanupBlockMetadata(["b1"], labelStore, linkStore);

    expect(linkStore.removeLinksForBlock).toHaveBeenCalledWith("b1");
    expect(linkStore.links).toHaveLength(0);
  });

  it("空配列の場合は何もしない", () => {
    const labelStore = makeLabelStoreStub({ "b1": "procedure" });
    const linkStore = makeLinkStoreStub();

    cleanupBlockMetadata([], labelStore, linkStore);

    expect(labelStore.setLabel).not.toHaveBeenCalled();
    expect(linkStore.removeLinksForBlock).not.toHaveBeenCalled();
    expect(labelStore.labels.get("b1")).toBe("procedure");
  });

  it("ラベル未付与ブロックでも linkStore はクリーンアップを試行する（safety）", () => {
    const labelStore = makeLabelStoreStub();
    const linkStore = makeLinkStoreStub();

    cleanupBlockMetadata(["b1"], labelStore, linkStore);

    expect(labelStore.setLabel).not.toHaveBeenCalled();
    expect(linkStore.removeLinksForBlock).toHaveBeenCalledWith("b1");
  });

  it("二重呼び出ししても idempotent", () => {
    const labelStore = makeLabelStoreStub({ "b1": "procedure" });
    const linkStore = makeLinkStoreStub([
      {
        id: "l1",
        sourceBlockId: "b1",
        targetBlockId: "b2",
        type: "derived_from",
        layer: "prov",
        createdBy: "human",
      },
    ]);

    cleanupBlockMetadata(["b1"], labelStore, linkStore);
    cleanupBlockMetadata(["b1"], labelStore, linkStore);

    expect(labelStore.labels.has("b1")).toBe(false);
    expect(linkStore.links).toHaveLength(0);
  });
});

describe("copyLabelsByIdMap", () => {
  it("旧 ID のラベルを新 ID に複製する", () => {
    const labelStore = makeLabelStoreStub({ "old1": "material" });

    copyLabelsByIdMap(new Map([["old1", "new1"]]), labelStore);

    expect(labelStore.labels.get("new1")).toBe("material");
    expect(labelStore.labels.get("old1")).toBe("material"); // 旧側は残る
  });

  it("ラベルのないブロックはスキップ", () => {
    const labelStore = makeLabelStoreStub();

    copyLabelsByIdMap(new Map([["old1", "new1"]]), labelStore);

    expect(labelStore.setLabel).not.toHaveBeenCalled();
  });

  it("同一 ID のペアはスキップ", () => {
    const labelStore = makeLabelStoreStub({ "b1": "procedure" });

    copyLabelsByIdMap(new Map([["b1", "b1"]]), labelStore);

    expect(labelStore.setLabel).not.toHaveBeenCalled();
  });
});

describe("copyLinksByIdMap", () => {
  it("コピー対象内で閉じたリンクを複製する", () => {
    const linkStore = makeLinkStoreStub([
      {
        id: "l1",
        sourceBlockId: "old1",
        targetBlockId: "old2",
        type: "derived_from",
        layer: "prov",
        createdBy: "human",
      },
    ]);

    copyLinksByIdMap(
      new Map([
        ["old1", "new1"],
        ["old2", "new2"],
      ]),
      linkStore,
    );

    expect(linkStore.addLink).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceBlockId: "new1",
        targetBlockId: "new2",
        type: "derived_from",
        layer: "prov",
      }),
    );
  });

  it("片端しかコピー対象に含まれないリンクは複製しない", () => {
    const linkStore = makeLinkStoreStub([
      {
        id: "l1",
        sourceBlockId: "old1",
        targetBlockId: "outside",
        type: "derived_from",
        layer: "prov",
        createdBy: "human",
      },
    ]);

    copyLinksByIdMap(new Map([["old1", "new1"]]), linkStore);

    expect(linkStore.addLink).not.toHaveBeenCalled();
  });

  it("複数リンクの部分複製", () => {
    const linkStore = makeLinkStoreStub([
      {
        id: "l1",
        sourceBlockId: "a",
        targetBlockId: "b",
        type: "derived_from",
        layer: "prov",
        createdBy: "human",
      },
      {
        id: "l2",
        sourceBlockId: "a",
        targetBlockId: "outside",
        type: "used",
        layer: "prov",
        createdBy: "human",
      },
    ]);

    copyLinksByIdMap(
      new Map([
        ["a", "a2"],
        ["b", "b2"],
      ]),
      linkStore,
    );

    expect(linkStore.addLink).toHaveBeenCalledTimes(1);
    expect(linkStore.addLink).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceBlockId: "a2",
        targetBlockId: "b2",
      }),
    );
  });
});
