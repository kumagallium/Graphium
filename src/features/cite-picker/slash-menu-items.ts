// スラッシュメニュー: 既存の claim / Insight ノートから引用挿入
// /claims, /Insights で複数選択ピッカーモーダルを開く
//
// 用語マッピング:
// - UI 上の "claims" = データモデル上の wikiKind === "atom"
// - UI 上の "Insights" = データモデル上の wikiKind === "synthesis"
//
// PR3 の Citation block が乗ったら挿入形式を差し替える前提。MVP では
// 選択されたノートのタイトルを青色テキストの paragraph として並べる。

import { t } from "../../i18n";

/** ピッカーの種別。コードと wikiKind の対応はモーダル側でマップする。 */
export type CitePickerKind = "claims" | "insights";

// ピッカーを開くコールバック。エディタ単位で登録する
// （main editor / SidePeek の各々が自分用のピッカーを持つ）。
const _citePickerCallbacks = new WeakMap<object, (kind: CitePickerKind) => void>();

export function setCitePickerCallback(
  editor: any,
  fn: ((kind: CitePickerKind) => void) | null,
) {
  if (!editor) return;
  if (fn) _citePickerCallbacks.set(editor, fn);
  else _citePickerCallbacks.delete(editor);
}

type SlashMenuItem = {
  title: string;
  subtext?: string;
  group: string;
  aliases?: string[];
  onItemClick: (editor: any) => void;
};

function createCiteSlashItem(
  titleKey: string,
  subtextKey: string,
  kind: CitePickerKind,
  aliases: string[],
): SlashMenuItem {
  return {
    title: t(titleKey),
    subtext: t(subtextKey),
    group: t("cite.slashGroup"),
    aliases,
    onItemClick: (editor: any) => {
      _citePickerCallbacks.get(editor)?.(kind);
    },
  };
}

/** スラッシュメニューに追加する引用挿入アイテム */
export function getCiteSlashMenuItems(): SlashMenuItem[] {
  return [
    createCiteSlashItem(
      "cite.slashClaim",
      "cite.slashClaimSub",
      "claims",
      ["claim", "claims", "知見", "ちけん", "atom"],
    ),
    createCiteSlashItem(
      "cite.slashInsight",
      "cite.slashInsightSub",
      "insights",
      ["insight", "insights", "洞察", "どうさつ", "synthesis"],
    ),
  ];
}
