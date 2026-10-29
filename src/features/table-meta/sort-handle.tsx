// テーブルの列ハンドル（⋮⋮）メニューに「並べ替え」を足したカスタム TableHandle
//
// BlockNote の既定メニューを children 付きで再構成する（children を渡すと
// 既定ボタンは描画されないため、既定の並びを自前で並べ直す）。
// Graphium は tables のサブ機能（splitCells / cellBackgroundColor / headers）を
// 有効化していないので、既定メニューの実体は 削除 + 追加×2 の 3 項目。
// そこに、列ハンドルのときだけ 昇順 / 降順 の並べ替え・計算・日時の列の付け外しを足す。
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
import { TableHandlesExtension } from "@blocknote/core/extensions";
import { ArrowDown, ArrowUp, Calculator, CalendarClock, FileText } from "lucide-react";
import { t } from "../../i18n";
import { applyLogTableTimestamps, forgetLogTableTracking } from "../log-table/auto-timestamp";
import { sortTableBlock, type SortDir } from "./sort-table";
import { readCellText } from "./table-cells";
import { columnBehaviorMenuState } from "./column-behavior";
import { computeTableDisplayNames } from "./auto-name";
import { useTableMetaStoreOptional } from "./store";

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
      <UseColumnInCalcItem blockId={blockId} colIndex={colIndex} />
      <DateTimeColumnItem blockId={blockId} colIndex={colIndex} />
      <NoteLinkColumnItem blockId={blockId} colIndex={colIndex} />
    </>
  );
}

/**
 * 「この列に日時を入れる」/「日時を入れるのをやめる」— 日時が入る列（datetime-auto）を
 * 列ごとに付け外しする入口。日時の列は表に 1 つなので、別の列に付けると前の列からは外れる。
 * 列のふるまいは列名で持つため、見出しが空・重複の列には出さない。
 * 先頭列で「行ごとのノート」がオンのときは付けられない（行の名前が日時になるため。
 * 出し分けは columnBehaviorMenuState）
 */
function DateTimeColumnItem({ blockId, colIndex }: { blockId: string; colIndex: number }) {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor();
  const store = useTableMetaStoreOptional();

  const block: any = editor.getBlock(blockId);
  const headers: string[] = (block?.content?.rows?.[0]?.cells ?? []).map((c: any) => readCellText(c));
  const columnName = headers[colIndex] ?? "";
  if (!store) return null;

  const mode = columnBehaviorMenuState(headers, store.getSnapshot()[blockId], colIndex).dateTime;
  if (!mode) return null;
  const active = mode === "disable";

  const toggle = () => {
    store.removeColumnType(blockId, "datetime-auto");
    if (active) return;
    store.addColumnType(blockId, columnName, "datetime-auto");
    // 外していた間の記録を捨ててから、今の行を初見として記録する（既存の行には書かない）。
    // 列名はストアの更新（非同期）を待たず直接渡す
    forgetLogTableTracking(editor, blockId);
    applyLogTableTimestamps(editor, [blockId], new Date(), { columnNameOf: () => columnName });
  };

  return (
    <Components.Generic.Menu.Item icon={<CalendarClock size={14} />} onClick={toggle}>
      {t(active ? "logTable.columnDisable" : "logTable.columnEnable")}
    </Components.Generic.Menu.Item>
  );
}

/**
 * 「この列から行ごとのノートを作る」/「行ごとのノートをやめる」— 行からノートを作れる
 * ふるまい（note-link）の入口。行の名前になる先頭列だけに出す。やめると行とノートの
 * 紐付け設定は消える（ノート本体は残る）。日時の列が先頭列のときは「作る」を出さない
 */
function NoteLinkColumnItem({ blockId, colIndex }: { blockId: string; colIndex: number }) {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor();
  const store = useTableMetaStoreOptional();

  const block: any = editor.getBlock(blockId);
  const headers: string[] = (block?.content?.rows?.[0]?.cells ?? []).map((c: any) => readCellText(c));
  if (!store) return null;

  const mode = columnBehaviorMenuState(headers, store.getSnapshot()[blockId], colIndex).noteLink;
  if (!mode) return null;
  const active = mode === "disable";

  const toggle = () => {
    if (active) store.removeColumnType(blockId, "note-link");
    else store.addColumnType(blockId, headers[0] ?? "", "note-link");
  };

  return (
    <Components.Generic.Menu.Item icon={<FileText size={14} />} onClick={toggle}>
      {t(active ? "indexTable.columnDisable" : "indexTable.columnEnable")}
    </Components.Generic.Menu.Item>
  );
}

/** mathjs の文字列リテラルに入れる名前のエスケープ */
function quoteName(name: string): string {
  return '"' + name.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

/**
 * 「この列を計算に使う」— 表の直下に、この列の合計を求める計算ブロックを
 * ひな形付きで挿入する。表→計算の連携（table["表示名"]["列名"]）への入口。
 */
function UseColumnInCalcItem({ blockId, colIndex }: { blockId: string; colIndex: number }) {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor();
  const store = useTableMetaStoreOptional();

  const block: any = editor.getBlock(blockId);
  const columnName = readCellText(block?.content?.rows?.[0]?.cells?.[colIndex]).trim();
  // ヘッダが空の列は参照式が書けないので出さない（ストア無し = 単体表示も同様）
  if (!store || !columnName) return null;

  const insertCalc = () => {
    const displayNames = computeTableDisplayNames(
      (editor as any).document ?? [],
      store.getCaption
    );
    const tableName = displayNames.get(blockId);
    if (!tableName) return;
    // 無名の表は自動名「表 N」のままだと並べ替えで番号がずれ、参照が別の表を
    // 指してしまう。参照された瞬間に自動名をキャプションへ昇格して固定する
    if (!store.getCaption(blockId)) store.setCaption(blockId, tableName);
    (editor as any).insertBlocks(
      [
        {
          type: "calc",
          props: { source: `sum(table[${quoteName(tableName)}][${quoteName(columnName)}])` },
        },
      ],
      blockId,
      "after"
    );
  };

  return (
    <Components.Generic.Menu.Item icon={<Calculator size={14} />} onClick={insertCalc}>
      {t("tableMeta.useColumnInCalc")}
    </Components.Generic.Menu.Item>
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
