// ナレッジ一覧の列の幅と、狭いときに隠す順
//
// 隠す順: モデル → 作成日。タイトル・種別・生成元・参照先・被参照・世界照合・出典照合
// （中身と状態を識別する列）と更新日は隠さない。補助の列（どのモデルが作ったか・いつ作ったか）
// から先に隠す。なおナレッジ一覧は並べ替えの選択が列ヘッダにしか無いので、隠れた列の基準
// （既定は作成日）で並んでいても表示は出ない。幅を戻せば見える。
// 幅の数値は WikiListView の th の w-[…] と揃える（Tailwind は動的なクラス名を拾えない）。

import type { ColumnPlan } from "../../lib/responsive-columns";

export type WikiListHideableColumn = "model" | "createdAt";

/** タイトル列の最小幅（日本語で 1 行 12 字前後） */
export const WIKI_LIST_TITLE_MIN_WIDTH = 240;

export const WIKI_LIST_COLUMN_WIDTH = {
  checkbox: 36,
  type: 140,
  sources: 80,
  outgoing: 70,
  incoming: 70,
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
    (opts.hasWorldVerdict ? W.worldVerdict : 0) +
    (opts.hasSourceVerdict ? W.sourceVerdict : 0);
  return {
    baseWidth,
    hideable: [
      { key: "model", width: W.model },
      { key: "createdAt", width: W.createdAt },
    ],
  };
}
