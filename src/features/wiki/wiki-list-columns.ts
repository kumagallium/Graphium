// ナレッジ一覧の列の幅と、狭いときに隠す順
//
// 隠す順: モデル → 作成日 → 世界照合（列があるときだけ）→ 参照先 → 被参照（どちらも列が
// あるときだけ）→ 出典数。タイトル・種別・派生・出典照合（中身と状態を識別する列）と更新日は
// 隠さない。補助の列（どのモデルが作ったか・いつ作ったか）から先に隠し、それでも足りない
// 知見・洞察の一覧では世界照合の列も隠す（Windows 既定 150% の表の内側 976px に収めるため。
// 境目は note-list-columns.test.ts で確かめる）。出典数（sources）は最後に隠す。全部隠しても
// なお枠が足りないときは、最後の手段としてタイトルの最小幅を 240 → 200 に詰める。
// ナレッジ一覧は並べ替えの選択が列ヘッダにしか無いので、並べ替えの基準の列が隠れたときは
// WikiListView がツールバーに「並び順: …」を出す（何で並んでいるかが画面から消えないように）。
// 幅の数値は WikiListView の th の w-[…] と揃える（Tailwind は動的なクラス名を拾えない）。

import type { ColumnPlan, HideableColumn } from "../../lib/responsive-columns";

export type WikiListHideableColumn = "model" | "createdAt" | "worldVerdict" | "outgoing" | "incoming" | "sources";

/** タイトル列の最小幅（日本語で 1 行 12 字前後） */
export const WIKI_LIST_TITLE_MIN_WIDTH = 240;

/** 隠せる列を全部隠した後だけ使うタイトル列の最小幅（日本語で 1 行 10 字前後） */
export const WIKI_LIST_TITLE_COMPACT_MIN_WIDTH = 200;

export const WIKI_LIST_COLUMN_WIDTH = {
  checkbox: 36,
  type: 140,
  sources: 80,
  /** 派生・参照先・被参照。英語の "Outgoing ↓" "Incoming ↓"（nowrap）が収まる幅 */
  derived: 76,
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
  /** 派生の列が出ているか（その種類に値が 1 件も無いときは出さない）。省略時は出ていない扱い */
  hasDerived?: boolean;
  /** 参照先の列が出ているか（その種類に値が 1 件も無いときは出さない）。省略時は出ている扱い */
  hasOutgoing?: boolean;
  /** 被参照の列が出ているか（同上）。省略時は出ている扱い */
  hasIncoming?: boolean;
}

export function buildWikiListColumnPlan(
  opts: WikiListColumnOptions,
): ColumnPlan<WikiListHideableColumn> {
  const W = WIKI_LIST_COLUMN_WIDTH;
  const baseWidth =
    WIKI_LIST_TITLE_MIN_WIDTH +
    W.checkbox +
    W.type +
    (opts.hasDerived ? W.derived : 0) +
    W.modifiedAt +
    W.delete +
    (opts.hasSourceVerdict ? W.sourceVerdict : 0);
  const hideable: HideableColumn<WikiListHideableColumn>[] = [
    { key: "model", width: W.model },
    { key: "createdAt", width: W.createdAt },
  ];
  if (opts.hasWorldVerdict) hideable.push({ key: "worldVerdict", width: W.worldVerdict });
  // 参照先・被参照は世界照合の次に隠す。ナレッジの本文のリンクはほとんどが出典（生成元）で、
  // それ以外へのリンクを持つページは少ない。もと・派生（生成元・派生）のほうを残す
  if (opts.hasOutgoing !== false) hideable.push({ key: "outgoing", width: W.outgoing });
  if (opts.hasIncoming !== false) hideable.push({ key: "incoming", width: W.incoming });
  hideable.push({ key: "sources", width: W.sources });
  return {
    baseWidth,
    hideable,
    floorWidth: baseWidth - (WIKI_LIST_TITLE_MIN_WIDTH - WIKI_LIST_TITLE_COMPACT_MIN_WIDTH),
  };
}
