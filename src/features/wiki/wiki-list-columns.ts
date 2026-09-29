// ナレッジ一覧の列の幅と、狭いときに隠す順
//
// 隠す順: モデル → 作成日 → 世界照合（世界照合の列があるときだけ）。タイトル・種別・生成元・
// 参照先・被参照・出典照合（中身と状態を識別する列）と更新日は隠さない。補助の列（どのモデルが
// 作ったか・いつ作ったか）から先に隠し、それでも足りない知見・洞察の一覧では世界照合の列も
// 隠す（Windows 既定 150% の表の内側 976px に収めるため。境目は wiki-list-columns.test.ts で確かめる）。
// ナレッジ一覧は並べ替えの選択が列ヘッダにしか無いので、並べ替えの基準の列が隠れたときは
// WikiListView がツールバーに「並び順: …」を出す（何で並んでいるかが画面から消えないように）。
// 幅の数値は WikiListView の th の w-[…] と揃える（Tailwind は動的なクラス名を拾えない）。

import type { ColumnPlan, HideableColumn } from "../../lib/responsive-columns";

export type WikiListHideableColumn = "model" | "createdAt" | "worldVerdict";

/** タイトル列の最小幅（日本語で 1 行 12 字前後） */
export const WIKI_LIST_TITLE_MIN_WIDTH = 240;

export const WIKI_LIST_COLUMN_WIDTH = {
  checkbox: 36,
  type: 140,
  sources: 80,
  /** 参照先・被参照。英語の "Refs out ↓"（nowrap）が収まる幅 */
  outgoing: 76,
  incoming: 76,
  worldVerdict: 110,
  sourceVerdict: 120,
  modifiedAt: 126,
  delete: 40,
  model: 122,
  /** 「YYYY-MM-DD HH:MM」が nowrap で収まる実幅（w-[100px] は実測 126px に広がっていた） */
  createdAt: 126,
} as const;

export interface WikiListColumnOptions {
  /** 世界照合の列が出ているか */
  hasWorldVerdict: boolean;
  /** 出典照合の列が出ているか */
  hasSourceVerdict: boolean;
}

export function buildWikiListColumnPlan(
  opts: WikiListColumnOptions,
): ColumnPlan<WikiListHideableColumn> {
  const W = WIKI_LIST_COLUMN_WIDTH;
  const baseWidth =
    WIKI_LIST_TITLE_MIN_WIDTH +
    W.checkbox +
    W.type +
    W.sources +
    W.outgoing +
    W.incoming +
    W.modifiedAt +
    W.delete +
    (opts.hasSourceVerdict ? W.sourceVerdict : 0);
  const hideable: HideableColumn<WikiListHideableColumn>[] = [
    { key: "model", width: W.model },
    { key: "createdAt", width: W.createdAt },
  ];
  if (opts.hasWorldVerdict) hideable.push({ key: "worldVerdict", width: W.worldVerdict });
  return { baseWidth, hideable };
}
