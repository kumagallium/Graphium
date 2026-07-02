// @ 参照リンクメニュー用のカスタム描画コンポーネント。
//
// なぜ必要か:
//   BlockNote 0.47 のデフォルト SuggestionMenu は、各アイテムの React key を
//   `item.title` にハードコードしている。@ メニューの候補には「同じタイトルの
//   ノート」が複数並びうる（例: 「新しいノート」を 2 件以上作った場合）。
//   すると key が重複し、React が "Encountered two children with the same key"
//   警告を出してメニュー描画が壊れる（項目の重複・欠落）。
//
//   このコンポーネントはデフォルトの描画をそのまま踏襲しつつ、React key を
//   一意なインデックスに差し替える。title は表示・フィルタ・挿入値としてそのまま
//   使い続けるので、同名ノートが並んでも描画が壊れない。

import { useComponentsContext, useBlockNoteEditor } from "@blocknote/react";
import type { DefaultReactSuggestionItem, SuggestionMenuProps } from "@blocknote/react";
import type { ReactNode } from "react";

/**
 * SuggestionMenuController の `suggestionMenuComponent` に渡すカスタムメニュー。
 * デフォルト実装（@blocknote/react の内蔵 SuggestionMenu）と描画・スタイルを揃え、
 * 差分は「アイテムの key を title ではなくインデックスにする」点のみ。
 */
export function MentionSuggestionMenu(
  props: SuggestionMenuProps<DefaultReactSuggestionItem>,
) {
  const { items, loadingState, selectedIndex, onItemClick } = props;
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor();

  const loader =
    loadingState === "loading-initial" || loadingState === "loading" ? (
      <Components.SuggestionMenu.Loader className="bn-suggestion-menu-loader" />
    ) : null;

  // デフォルト実装と同じく、グループが切り替わったところで Label を差し込む。
  const rows: ReactNode[] = [];
  let lastGroup: string | undefined;
  items.forEach((item, index) => {
    if (item.group !== lastGroup) {
      lastGroup = item.group;
      rows.push(
        <Components.SuggestionMenu.Label
          key={`label-${index}`}
          className="bn-suggestion-menu-label"
        >
          {item.group}
        </Components.SuggestionMenu.Label>,
      );
    }
    rows.push(
      <Components.SuggestionMenu.Item
        // ここが唯一の差分: title ではなくインデックスを key にする。
        key={`item-${index}`}
        className={
          "bn-suggestion-menu-item" +
          (item.size === "small" ? " bn-suggestion-menu-item-small" : "")
        }
        id={`bn-suggestion-menu-item-${index}`}
        isSelected={index === selectedIndex}
        item={item}
        onClick={() => onItemClick?.(item)}
      />,
    );
  });

  return (
    <Components.SuggestionMenu.Root
      id="bn-suggestion-menu"
      className="bn-suggestion-menu"
    >
      {rows}
      {rows.length === 0 &&
        (loadingState === "loading" || loadingState === "loaded") && (
          <Components.SuggestionMenu.EmptyItem className="bn-suggestion-menu-item">
            {editor.dictionary.suggestion_menu.no_items_title}
          </Components.SuggestionMenu.EmptyItem>
        )}
      {loader}
    </Components.SuggestionMenu.Root>
  );
}
