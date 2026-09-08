// ドキュメント内検索バー（Cmd+F の UI）。
//
// 見た目と入力ハンドリングは共通の SearchBar が持ち、ここは
// useDocumentSearch（Cmd+F の購読・ハイライト制御）との接続だけを担う。
// エディタ未準備（editor=null）や非オープン時は何も描画しない。

import { useT } from "@/i18n";
import { SearchBar } from "./SearchBar";
import { useDocumentSearch } from "./use-document-search";

interface DocumentSearchBarProps {
  /** 検索対象の BlockNote editor インスタンス（未準備なら null）。 */
  editor: any;
}

export function DocumentSearchBar({ editor }: DocumentSearchBarProps) {
  const t = useT();
  const { state, close, setQuery, toggleCaseSensitive, next, prev } =
    useDocumentSearch(editor);

  if (!editor || !state.open) return null;

  return (
    <SearchBar
      query={state.query}
      total={state.total}
      current={state.current}
      caseSensitive={state.caseSensitive}
      onQueryChange={setQuery}
      onToggleCaseSensitive={toggleCaseSensitive}
      onNext={next}
      onPrev={prev}
      onClose={close}
      placeholder={t("docSearch.placeholder")}
    />
  );
}
