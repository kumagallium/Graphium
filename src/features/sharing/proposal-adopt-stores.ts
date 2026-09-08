// 取り込み後のページ注釈（ラベル・PROV リンク）を編集画面のストアへ反映する。仕様 §25b B-3。
//
// なぜ独立させたか:
//   applyProposalChanges が返すのは「新しい GraphiumDocument」で、ラベルと
//   provLinks はその中に確定値として入っている。ところが編集画面の保存経路
//   （buildDocument → buildSavedPageFields）はドキュメントではなく labelStore /
//   linkStore を読む。取り込んだ結果をストアへ移し替えないと、次の保存で
//   取り込む前のラベルに戻る（＝取り込みが半分だけ消える）。
//
// 守っていること:
//   - ラベルは差分だけ動かす。全消し → 全入れ直しにすると、ラベルに紐づく
//     連動属性（step の実行者・状態）が既定値へ落ちる（setLabel の副作用）
//   - リンクは prov 層だけ入れ替える。knowledge 層（@メンション・引用）は
//     取り込みの対象外なので、そのまま残す
//   - React に依存しない。ストアは最小のインターフェースで受ける（テスト可能に）

import type { BlockLink } from "../../lib/block-link-types";
import type { GraphiumPage } from "../../lib/document-types";

/** labelStore のうち、ここで使う分だけ */
export interface AdoptLabelStore {
  labels: ReadonlyMap<string, string>;
  setLabel(blockId: string, label: string | null): void;
}

/** linkStore のうち、ここで使う分だけ */
export interface AdoptLinkStore {
  getAllLinks(): BlockLink[];
  restoreLinks(links: BlockLink[]): void;
}

/**
 * 取り込み後のページ（applyProposalChanges の結果の pages[0]）を、
 * 編集画面のラベル / リンクのストアへ反映する。
 */
export function applyAdoptedPageAnnotations(params: {
  labelStore: AdoptLabelStore;
  linkStore: AdoptLinkStore;
  page: Pick<GraphiumPage, "labels" | "provLinks">;
}): void {
  const { labelStore, linkStore, page } = params;
  const next = page.labels ?? {};

  // 取り込みで消えた / 変わったラベルだけを動かす
  for (const blockId of [...labelStore.labels.keys()]) {
    if (!(blockId in next)) labelStore.setLabel(blockId, null);
  }
  for (const [blockId, label] of Object.entries(next)) {
    if (labelStore.labels.get(blockId) !== label) labelStore.setLabel(blockId, label);
  }

  // prov 層だけ確定値で置き換える（knowledge 層はそのまま）
  const keep = linkStore.getAllLinks().filter((link) => link.layer !== "prov");
  const adopted = (page.provLinks ?? []).map((link) =>
    link.layer === "prov" ? link : ({ ...link, layer: "prov" } as BlockLink),
  );
  linkStore.restoreLinks([...keep, ...adopted]);
}
