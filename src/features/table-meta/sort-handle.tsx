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
import { ArrowDown, ArrowUp, Calculator, CalendarClock, FileText, Lock } from "lucide-react";
import { t } from "../../i18n";
import { applyLogTableTimestamps, forgetLogTableTracking } from "../log-table/auto-timestamp";
import { sortTableBlock, type SortDir } from "./sort-table";
import { readCellText, writeCellText } from "./table-cells";
import { columnBehaviorMenuState, freeColumnName } from "./column-behavior";
import { computeTableDisplayNames } from "./auto-name";
import { useTableMetaStoreOptional } from "./store";
import { withProtectionBypass } from "./column-protection";

function SortColumnItems({ orientation }: { orientation: "row" | "column" }) {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor();
  const store = useTableMetaStoreOptional();
  const state = useExtensionState(TableHandlesExtension, {
    selector: (s: any) => ({ blockId: s?.block?.id as string | undefined, colIndex: s?.colIndex as number | undefined }),
  }) as { blockId?: string; colIndex?: number } | undefined;

  // 並べ替えは列の操作。行ハンドルには出さない
  if (orientation !== "column") return null;
  const blockId = state?.blockId;
  const colIndex = state?.colIndex;
  if (!blockId || colIndex === undefined) return null;

  const sort = (dir: SortDir) => sortTableBlock(editor, blockId, colIndex, dir);

  // 見出しは、その下に項目が 1 つでも出るときだけ出す（出し分けは各項目と同じ判定）
  const block: any = editor.getBlock(blockId);
  const headers: string[] = (block?.content?.rows?.[0]?.cells ?? []).map((c: any) => readCellText(c));
  const showCalc = Boolean(store) && (headers[colIndex] ?? "").trim() !== "";
  const behaviors = store ? columnBehaviorMenuState(headers, store.getSnapshot()[blockId], colIndex) : null;
  const showAttributes = Boolean(behaviors && (behaviors.dateTime || behaviors.noteLink || behaviors.protect));

  return (
    <>
      <Components.Generic.Menu.Label>{t("tableMeta.menuSection.sort")}</Components.Generic.Menu.Label>
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
      {showCalc && (
        <Components.Generic.Menu.Label>{t("tableMeta.menuSection.calc")}</Components.Generic.Menu.Label>
      )}
      <UseColumnInCalcItem blockId={blockId} colIndex={colIndex} />
      {showAttributes && (
        <Components.Generic.Menu.Label>{t("tableMeta.menuSection.attributes")}</Components.Generic.Menu.Label>
      )}
      <DateTimeColumnItem blockId={blockId} colIndex={colIndex} />
      <NoteLinkColumnItem blockId={blockId} colIndex={colIndex} />
      <ProtectColumnItem blockId={blockId} colIndex={colIndex} />
    </>
  );
}

/**
 * 「日時を自動で入れる」（オン/オフのトグル）— 日時が入る列（datetime-auto）を
 * 列ごとに付け外しする入口。日時の列は表に 1 つなので、別の列に付けると前の列からは外れる。
 * 列のふるまいは列名で持つため、見出しが重複する列には出さない（空の列は押したときに名前を入れる）。
 * 先頭列で「ノートへのリンク」がオンのときは薄く出して押せなくする（行の名前が日時になるため。
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
  const blocked = mode === "blocked";

  const toggle = () => {
    store.removeColumnType(blockId, "datetime-auto");
    if (active) return;
    // 列のふるまいは見出しの名前で持つので、見出しが空の列には先に名前を入れる
    let name = columnName;
    if (!name) {
      name = freeColumnName(headers, t("logTable.colDateTime"));
      withProtectionBypass(() => writeCellText(editor, blockId, 0, colIndex, name));
    }
    store.addColumnType(blockId, name, "datetime-auto");
    // 外していた間の記録を捨ててから、今の行を初見として記録する（既存の行には書かない）。
    // 列名はストアの更新（非同期）を待たず直接渡す
    forgetLogTableTracking(editor, blockId);
    applyLogTableTimestamps(editor, [blockId], new Date(), { columnNameOf: () => name });
  };

  return (
    <Components.Generic.Menu.Item icon={<CalendarClock size={14} />} checked={active} disabled={blocked} onClick={blocked ? undefined : toggle}>
      {t("logTable.columnAttribute")}
    </Components.Generic.Menu.Item>
  );
}

/**
 * 「ノートへのリンク」（オン/オフのトグル）— 行からノートを作れる
 * ふるまい（note-link）の入口。行の名前になる先頭列だけに出す。やめると行とノートの
 * 紐付け設定は消える（ノート本体は残る）。日時の列が先頭列のときは薄く出して押せなくする
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
  const blocked = mode === "blocked";

  const toggle = () => {
    if (active) {
      store.removeColumnType(blockId, "note-link");
      return;
    }
    // 列のふるまいは見出しの名前で持つ。見出しが空のままだと、空の見出しの列が他にもあるとき
    // どれがリンクの列か決まらず、左端に保つこともできないので、先に名前を入れる
    let name = headers[0] ?? "";
    if (!name) {
      name = freeColumnName(headers, t("indexTable.colName"));
      withProtectionBypass(() => writeCellText(editor, blockId, 0, 0, name));
    }
    store.addColumnType(blockId, name, "note-link");
  };

  return (
    <Components.Generic.Menu.Item icon={<FileText size={14} />} checked={active} disabled={blocked} onClick={blocked ? undefined : toggle}>
      {t("indexTable.columnAttribute")}
    </Components.Generic.Menu.Item>
  );
}

/**
 * 「保護」（オン/オフのトグル）— 列のセルの書き換え・見出しの改名・列の削除を止める印。
 * 見出しが空・重複の列には出さない（列のふるまいは列名で持つため）。計算が書いたセルは
 * 列の保護と別に自動で守られる（電卓の印のセル）ので、ここはふつうのトグルとして出す。
 * 外すときは確認を挟む（外すと、その列を編集できるようになる）
 */
function ProtectColumnItem({ blockId, colIndex }: { blockId: string; colIndex: number }) {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor();
  const store = useTableMetaStoreOptional();

  const block: any = editor.getBlock(blockId);
  const headers: string[] = (block?.content?.rows?.[0]?.cells ?? []).map((c: any) => readCellText(c));
  if (!store) return null;

  const mode = columnBehaviorMenuState(headers, store.getSnapshot()[blockId], colIndex).protect;
  if (!mode) return null;
  const active = mode === "disable";
  const columnName = headers[colIndex];

  const toggle = () => {
    if (active) {
      if (!window.confirm(t("tableMeta.unprotectConfirm"))) return;
      store.removeColumnTypeFrom(blockId, columnName, "protected");
      return;
    }
    // 列のふるまいは見出しの名前で持つので、見出しが空の列には先に名前（「列 2」等）を入れる
    let name = columnName ?? "";
    if (!name) {
      name = freeColumnName(headers, t("tableMeta.columnDefaultName", { n: String(colIndex + 1) }));
      withProtectionBypass(() => writeCellText(editor, blockId, 0, colIndex, name));
    }
    store.addColumnType(blockId, name, "protected");
  };

  return (
    <Components.Generic.Menu.Item icon={<Lock size={14} />} checked={active} onClick={toggle}>
      {t("tableMeta.columnProtected")}
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

/** メニュー先頭の見出し（「列」/「行」）。追加・削除の項目の上に出す */
function LineSectionLabel({ orientation }: { orientation: "row" | "column" }) {
  const Components = useComponentsContext()!;
  return (
    <Components.Generic.Menu.Label>
      {t(orientation === "row" ? "tableMeta.menuSection.row" : "tableMeta.menuSection.column")}
    </Components.Generic.Menu.Label>
  );
}

function SortTableHandleMenu(props: { orientation: "row" | "column" }) {
  return (
    <TableHandleMenu orientation={props.orientation}>
      <LineSectionLabel orientation={props.orientation} />
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
  const store = useTableMetaStoreOptional();
  const state = useExtensionState(TableHandlesExtension, {
    selector: (s: any) => ({ blockId: s?.block?.id as string | undefined, colIndex: s?.colIndex as number | undefined }),
  }) as { blockId?: string; colIndex?: number } | undefined;
  // ノートへのリンクの列（先頭列）は左端に固定する（pin-note-link-column.ts）。動かしても
  // 戻るので、ドラッグを始められないようにする — 青い挿入線が出てから戻ると、動かせるのに
  // 動かないように見えて戸惑う。メニューは開ける（ドラッグの開始だけを止める）
  const locked =
    props.orientation === "column" &&
    state?.colIndex === 0 &&
    Boolean(state?.blockId && store?.hasColumnType(state.blockId, "note-link"));
  // tableHandleMenu の型は FC（引数なし）だが、実行時は orientation が渡される
  // （dist の TableHandle 実装参照）。型だけ合わせてそのまま受け流す
  // 包む要素は常に置き、止めるかどうかだけを切り替える。固定の列でだけ包むと、列を移る
  // たびにハンドルが作り直されて位置の計算が崩れ、他の列のハンドルが出なくなる
  return (
    <span
      data-locked-column-handle={locked ? "" : undefined}
      style={{ display: "contents" }}
      onDragStartCapture={(e) => {
        if (!locked) return;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <TableHandle {...props} tableHandleMenu={SortTableHandleMenu as React.FC} />
    </span>
  );
}
