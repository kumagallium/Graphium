// テーブルの列ハンドル（⋮⋮）メニューに「並べ替え」を足したカスタム TableHandle
//
// BlockNote の既定メニューを children 付きで再構成する（children を渡すと
// 既定ボタンは描画されないため、既定の並びを自前で並べ直す）。
// Graphium は tables のサブ機能（splitCells / cellBackgroundColor / headers）を
// 有効化していないので、既定メニューの実体は 削除 + 追加×2 の 3 項目。
// そこに、列ハンドルのときだけ 昇順 / 降順 の並べ替えを足す。
//
// 並べ替えの実体は sortTableBlock（ふつうの編集。Undo で戻せる）。
// 拡大ビューの見出しクリックと同じ操作の別入口で、どちらも表そのものを変える。

import {
  AddButton,
  DeleteButton,
  TableHandle,
  TableHandleMenu,
  useBlockNoteEditor,
  useComponentsContext,
  useExtensionState,
  type TableHandleProps,
} from "@blocknote/react";
import { TableHandlesExtension } from "@blocknote/core";
import { ArrowDown, ArrowUp } from "lucide-react";
import { t } from "../../i18n";
import { sortTableBlock, type SortDir } from "./sort-table";

function SortColumnItems({ orientation }: { orientation: "row" | "column" }) {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor();
  const state = useExtensionState(TableHandlesExtension, {
    selector: (s: any) => ({ blockId: s?.block?.id as string | undefined, colIndex: s?.colIndex as number | undefined }),
  }) as { blockId?: string; colIndex?: number } | undefined;

  // 並べ替えは列の操作。行ハンドルには出さない
  if (orientation !== "column") return null;
  const blockId = state?.blockId;
  const colIndex = state?.colIndex;
  if (!blockId || colIndex === undefined) return null;

  const sort = (dir: SortDir) => sortTableBlock(editor, blockId, colIndex, dir);
  return (
    <>
      <Components.Generic.Menu.Item
        icon={<ArrowUp size={14} />}
        onClick={() => sort("asc")}
      >
        {t("tableMeta.sortAsc")}
      </Components.Generic.Menu.Item>
      <Components.Generic.Menu.Item
        icon={<ArrowDown size={14} />}
        onClick={() => sort("desc")}
      >
        {t("tableMeta.sortDesc")}
      </Components.Generic.Menu.Item>
    </>
  );
}

function SortTableHandleMenu(props: { orientation: "row" | "column" }) {
  return (
    <TableHandleMenu orientation={props.orientation}>
      <DeleteButton orientation={props.orientation} />
      {props.orientation === "row" ? (
        <>
          <AddButton orientation="row" side="above" />
          <AddButton orientation="row" side="below" />
        </>
      ) : (
        <>
          <AddButton orientation="column" side="left" />
          <AddButton orientation="column" side="right" />
          <SortColumnItems orientation={props.orientation} />
        </>
      )}
    </TableHandleMenu>
  );
}

/** BlockNoteView の TableHandlesController に渡すカスタムハンドル */
export function SortableTableHandle(props: TableHandleProps) {
  // tableHandleMenu の型は FC（引数なし）だが、実行時は orientation が渡される
  // （dist の TableHandle 実装参照）。型だけ合わせてそのまま受け流す
  return <TableHandle {...props} tableHandleMenu={SortTableHandleMenu as React.FC} />;
}
