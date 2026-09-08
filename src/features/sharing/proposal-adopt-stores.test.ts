// 取り込み後のページ注釈をストアへ反映する（proposal-adopt-stores）のテスト。
//
// ここで守りたいこと:
//   1. ラベルは差分だけ動かす（全消し → 入れ直しは step の連動属性を既定値に落とす）
//   2. 取り込みで消えたブロックのラベルは外れる
//   3. prov 層だけ入れ替え、knowledge 層（@メンション・引用）は残る

import { describe, it, expect } from "vitest";
import { applyAdoptedPageAnnotations } from "./proposal-adopt-stores";
import type { BlockLink } from "../../lib/block-link-types";

function labelStoreOf(initial: Record<string, string>) {
  const labels = new Map(Object.entries(initial));
  const calls: [string, string | null][] = [];
  return {
    labels,
    setLabel(blockId: string, label: string | null) {
      calls.push([blockId, label]);
      if (label === null) labels.delete(blockId);
      else labels.set(blockId, label);
    },
    calls,
  };
}

function link(over: Partial<BlockLink> & { id: string }): BlockLink {
  return {
    sourceBlockId: "b1",
    targetBlockId: "b2",
    type: "reference",
    layer: "knowledge",
    createdBy: "human",
    ...over,
  } as BlockLink;
}

function linkStoreOf(links: BlockLink[]) {
  let current = links;
  return {
    getAllLinks: () => current,
    restoreLinks: (next: BlockLink[]) => {
      current = next;
    },
    get links() {
      return current;
    },
  };
}

describe("applyAdoptedPageAnnotations", () => {
  it("変わったラベルだけを動かす", () => {
    const labelStore = labelStoreOf({ b1: "procedure", b2: "material" });
    const linkStore = linkStoreOf([]);
    applyAdoptedPageAnnotations({
      labelStore,
      linkStore,
      page: { labels: { b1: "procedure", b2: "result" }, provLinks: [] },
    });
    // b1 は同じ値なので触らない（触ると step の連動属性が初期化されうる）
    expect(labelStore.calls).toEqual([["b2", "result"]]);
  });

  it("取り込みで消えたブロックのラベルは外す", () => {
    const labelStore = labelStoreOf({ b1: "procedure", gone: "material" });
    const linkStore = linkStoreOf([]);
    applyAdoptedPageAnnotations({
      labelStore,
      linkStore,
      page: { labels: { b1: "procedure" }, provLinks: [] },
    });
    expect(labelStore.calls).toEqual([["gone", null]]);
    expect(labelStore.labels.has("gone")).toBe(false);
  });

  it("prov 層だけ入れ替え、knowledge 層は残す", () => {
    const labelStore = labelStoreOf({});
    const linkStore = linkStoreOf([
      link({ id: "k1", layer: "knowledge" }),
      link({ id: "p-old", layer: "prov", type: "informed_by" }),
    ]);
    applyAdoptedPageAnnotations({
      labelStore,
      linkStore,
      page: {
        labels: {},
        provLinks: [link({ id: "p-new", layer: "prov", type: "informed_by" })],
      },
    });
    expect(linkStore.links.map((l) => l.id)).toEqual(["k1", "p-new"]);
  });

  it("layer が抜けている provLinks は prov として入れる", () => {
    const labelStore = labelStoreOf({});
    const linkStore = linkStoreOf([]);
    const noLayer = { ...link({ id: "p1", type: "informed_by" }) } as Partial<BlockLink>;
    delete noLayer.layer;
    applyAdoptedPageAnnotations({
      labelStore,
      linkStore,
      page: { labels: {}, provLinks: [noLayer as BlockLink] },
    });
    expect(linkStore.links[0].layer).toBe("prov");
  });
});
