// ──────────────────────────────────────────────
// 計画ノートの「工程」タブ本体。
//
// 計画ノートのインデックステーブル（note-link 列を持つ表）の行 = 工程ノートを
// StepFlowView に流す。docs/internal/note-chain-plan.md §2.3 / PR 2。
//
// 編集系（ノード間の接続・step の中身の編集）は渡さない — 工程ノードは別ノートを
// 指すので、開いていないノートを書き換える事故を防ぐ（決定事項 D4）。ここで書ける
// のは「計画ノート自身の表」だけ（+ 工程を追加 / 未作成行からのノート作成）。
// ──────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { StepFlowView, type ConnectResult } from "./step-flow-view";
import type { FlowSelection, SectionKind, StepPanelData } from "./flow-attribute-table";
import type { FlowGraphData, FlowNoteRef, FlowStep } from "./activity-graph-adapter";
import {
  collectOperationRowsFromBlocks,
  nextDefaultOperationName,
  buildPlanFlowGraph,
  wouldCreatePlannedCycle,
  formatPlannedInputs,
  type OperationRow,
} from "./plan-flow";
import {
  getLatestProcessIndex,
  subscribeLatestProcessIndex,
  requestLatestProcessIndexRefresh,
} from "./process-index";
import { planFlowScope } from "./graph-layout";
import {
  addTableRow,
  addTableColumn,
  removeCellImageAt,
  removeTableColumn,
  renameTableColumn,
  setTableCellAt,
  readTable,
} from "./table-row-edit";
import { collectTableBlocks } from "../table-meta/table-cells";
import { useTableMetaStore, type TableMetaStoreValue } from "../table-meta/store";
import { getFirstCellText, createNoteFromRow } from "../index-table/create-note-from-row";
import { getIndexTableCallbacks, openEditorSidePeek } from "../index-table/context";
import { findColumnNameByType } from "../table-meta/types";
import { t } from "../../i18n";
import type { GraphiumIndex } from "../navigation/index-file";

/** 工程パネルに描くセクション。計画ノート自身のインデックステーブルだけを出す */
const PLAN_PANEL_SECTIONS: SectionKind[] = ["attribute"];

/** 表示名を正規化する（plan-flow.ts の normalizeOperationName と同じ規則。非公開関数なのでここで揃える） */
function normalizePlanName(name: string): string {
  const trimmed = name.trim();
  return (trimmed.startsWith("@") ? trimmed.slice(1) : trimmed).toLowerCase();
}

/** セルに書く行名を作る（先頭 "@" を外す。resolvePlannedRow / parsePlannedInputs は "@" 無しの名前で照合するため） */
function planNameToWrite(name: string): string {
  const trimmed = name.trim();
  return trimmed.startsWith("@") ? trimmed.slice(1).trim() : trimmed;
}

/** buildPlanFlowGraph の FlowStep.id と同じ規則（rows[].id を復元するのではなく、ここで揃えて計算する） */
function operationRowId(row: OperationRow): string {
  return row.noteId ? `note:${row.noteId}` : `row:${row.tableBlockId}:${row.rowIndex}`;
}

/**
 * 表の "planned-input" 列のヘッダ位置を探す。列を追加した直後でも editor.document を
 * 読み直せば即座に反映される（同ファイル内の他の書き込み経路と同じ前提）。
 */
function findPlannedInputColIndex(editor: any, tableBlockId: string, columnName: string): number {
  const table = readTable(editor, tableBlockId);
  if (!table) return -1;
  return table.headers.findIndex((h) => h === columnName);
}

/**
 * 計画ノートの本文に note-link 列を持つ表が無ければ、スラッシュメニューの
 * 「インデックステーブル」と同じ手順（表を挿入 → 先頭列に note-link を付ける）で
 * 1 つ作る。ヘッダ 1 列目は工程名（列名は t("panel.prov.operations")）。
 */
function ensureOperationsTable(editor: any, tableMetaStore: TableMetaStoreValue): string | null {
  const blocks: any[] = editor.document ?? [];
  const tableBlocks = collectTableBlocks(blocks);
  for (const [blockId] of tableBlocks) {
    if (tableMetaStore.hasColumnType(blockId, "note-link")) return blockId;
  }

  const headerName = t("panel.prov.operations");
  const reference = blocks[blocks.length - 1]?.id;
  if (!reference) return null; // 本文が空（実際には常に何かある想定）

  const inserted = editor.insertBlocks(
    [
      {
        type: "table",
        content: {
          type: "tableContent",
          rows: [{ cells: [[{ type: "text", text: headerName, styles: {} }]] }],
        },
      },
    ],
    reference,
    "after",
  );
  const newId = inserted?.[0]?.id;
  if (!newId) return null;
  tableMetaStore.addColumnType(newId, headerName, "note-link");
  // トースト等の既存の案内経路が無いため、ひとまず console に留める
  console.info(t("planFlow.tableCreatedHint"));
  return newId;
}

/**
 * 「未作成」ノードから工程ノートを作る。icon-layer.tsx の handleCreateNote と
 * 同じ手順: createNoteFromRow → セルを "@名前"（青文字）に書き換え →
 * setNoteLink 再キー → onAddNoteLink（createNoteFromRow 内） → onRefreshFiles →
 * onOpenSidePeek。名前が空なら何もしない。
 */
async function createOperationNoteFromRef(
  editor: any,
  ref: FlowNoteRef,
  tableMetaStore: TableMetaStoreValue,
): Promise<void> {
  const callbacks = getIndexTableCallbacks();
  if (!editor || !callbacks) return;

  const block = editor.getBlock(ref.tableBlockId);
  if (!block) return;
  const rawName = getFirstCellText(block, ref.rowIndex).trim();
  if (!rawName) return;

  const fileId = await createNoteFromRow(
    editor,
    ref.tableBlockId,
    ref.rowIndex,
    callbacks.files,
    tableMetaStore,
    callbacks.onAddNoteLink,
    callbacks.currentFileId,
  );
  if (!fileId) return;

  const freshBlock = editor.getBlock(ref.tableBlockId);
  const rows: any[] | undefined = freshBlock?.content?.rows;
  if (rows?.[ref.rowIndex]) {
    const newRows = rows.map((r: any, i: number) => {
      if (i !== ref.rowIndex) return r;
      return {
        ...r,
        cells: [
          [{ type: "text", text: `@${rawName}`, styles: { textColor: "blue" } }],
          ...r.cells.slice(1),
        ],
      };
    });
    editor.updateBlock(ref.tableBlockId, { content: { type: "tableContent", rows: newRows } });
    tableMetaStore.setNoteLink(ref.tableBlockId, `@${rawName}`, fileId);
  }

  callbacks.onRefreshFiles();
  callbacks.onOpenSidePeek(fileId);
}

export function PlanFlowEditor({
  noteId,
  editorRef,
  docVersion,
  index,
  variant,
  tableLayout,
  onGraphChange,
}: {
  /** 手動配置の保存キー planFlowScope(noteId) に使う */
  noteId: string | null;
  /** 計画ノート本体の BlockNote エディタ */
  editorRef: { current: any };
  /** 本文が変わった合図（provDoc の identity 等）。行の再読込トリガ */
  docVersion: unknown;
  /**
   * ナビゲーション index。**deletedAt / archivedAt を含む未フィルタのもの**（note-app の
   * rawNoteIndex）を渡すこと。フィルタ済み（noteIndex）を渡すと、ゴミ箱・アーカイブ済みの
   * 工程ノートが index に無いので「ゴミ箱にあります」の判定が一切効かない
   */
  index: GraphiumIndex | null;
  variant?: "editor" | "preview";
  tableLayout?: "below" | "side";
  /** 親の統計行用。graph が変わるたびに呼ぶ */
  onGraphChange?: (info: { graph: FlowGraphData; truncated: boolean; brokenCount: number; unresolvedPlanned: number }) => void;
}) {
  const tableMetaStore = useTableMetaStore();
  // TableMetaStoreProvider の value は毎レンダーで新しいオブジェクトになる。コールバックの
  // 依存に入れると参照が毎回変わり、StepFlowView がノードを作り直し続けて（React Flow が
  // 未計測扱いで隠す）工程ノードが消える。store と index は ref で読み、コールバックは固定する
  const storeRef = useRef(tableMetaStore);
  storeRef.current = tableMetaStore;
  const indexRef = useRef(index);
  indexRef.current = index;
  const processIndex = useSyncExternalStore(
    subscribeLatestProcessIndex,
    getLatestProcessIndex,
    getLatestProcessIndex,
  );

  // 工程タブを開いたら ProcessIndex を最新化する（遅延投影。前手順ピッカーと同じ作法）
  useEffect(() => {
    requestLatestProcessIndexRefresh();
  }, []);

  const rows = useMemo(() => {
    const editor = editorRef.current;
    const blocks: any[] = editor?.document ?? [];
    return collectOperationRowsFromBlocks(blocks, tableMetaStore.getSnapshot(), index);
    // tableMetaStore.metas の参照が変わるたびに（表の列構成・noteLinks が変わるたびに）
    // 再計算する。docVersion は本文（ブロック）そのものが変わった合図
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docVersion, tableMetaStore.metas, index]);

  const result = useMemo(
    () => buildPlanFlowGraph({ rows, index, processIndex }),
    [rows, index, processIndex],
  );

  useEffect(() => {
    onGraphChange?.({
      graph: result.graph,
      truncated: result.truncated,
      brokenCount: result.brokenCount,
      unresolvedPlanned: result.unresolvedPlanned.length,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const onAddActivity = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const store = storeRef.current;
    const tableBlockId = ensureOperationsTable(editor, store);
    if (!tableBlockId) return;

    const blocks: any[] = editor.document ?? [];
    const currentRows = collectOperationRowsFromBlocks(blocks, store.getSnapshot(), indexRef.current).filter(
      (r) => r.tableBlockId === tableBlockId,
    );
    const name = nextDefaultOperationName(currentRows.map((r) => r.name));
    addTableRow(editor, tableBlockId, name);
  }, [editorRef]);

  /**
   * 工程フローでポートを引いたときの「予定の線」を張る。相手のノートには何も書かず、
   * consumer 側の行がある表の "planned-input" 列（無ければ作る）に producer の行名を足す。
   * D4: 開いていないノートへ書く経路は作らない（消費側テーブルは今開いている計画ノート自身）。
   */
  const onConnectSteps = useCallback(
    (producerId: string, consumerId: string): ConnectResult | void => {
      const editor = editorRef.current;
      if (!editor) return;
      const store = storeRef.current;
      const blocks: any[] = editor.document ?? [];
      const currentRows = collectOperationRowsFromBlocks(blocks, store.getSnapshot(), indexRef.current);
      const producer = currentRows.find((r) => operationRowId(r) === producerId);
      const consumer = currentRows.find((r) => operationRowId(r) === consumerId);
      if (!producer || !consumer) return; // 両方が noteRef の工程行でなければ無視

      if (wouldCreatePlannedCycle(currentRows, producer.name, consumer.name)) {
        return { error: t("planFlow.plannedCycle") };
      }

      const producerName = planNameToWrite(producer.name);
      const alreadyPlanned = consumer.plannedFrom.some(
        (n) => normalizePlanName(n) === normalizePlanName(producerName),
      );
      if (alreadyPlanned) return;

      // 列名は tableMeta に付いた名前が正（ユーザーが改名していてもそれに従う）。
      // タグの無い表では、同名のヘッダが既にあればその列にタグを付けるだけにし、
      // 2 本目の「入力元」を足さない（同名ヘッダが並ぶと列の解決が先勝ちでズレる）
      let columnName =
        findColumnNameByType(store.getSnapshot()[consumer.tableBlockId], "planned-input") ??
        t("planFlow.inputSourceColumn");
      if (!store.hasColumnType(consumer.tableBlockId, "planned-input")) {
        const existing = readTable(editor, consumer.tableBlockId)?.headers ?? [];
        if (!existing.includes(columnName)) {
          if (!addTableColumn(editor, consumer.tableBlockId, columnName)) return;
        }
        store.addColumnType(consumer.tableBlockId, columnName, "planned-input");
      }

      const colIndex = findPlannedInputColIndex(editor, consumer.tableBlockId, columnName);
      if (colIndex < 0) return;
      const nextValue = formatPlannedInputs([...consumer.plannedFrom, producerName]);
      setTableCellAt(editor, consumer.tableBlockId, consumer.rowIndex - 1, colIndex, nextValue);
    },
    [editorRef],
  );

  /** 予定の線を外す。consumer 側セルから producer の行名を除いて書き戻す（空なら空文字） */
  const onRemovePlannedEdge = useCallback(
    (producerId: string, consumerId: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      const store = storeRef.current;
      const blocks: any[] = editor.document ?? [];
      const currentRows = collectOperationRowsFromBlocks(blocks, store.getSnapshot(), indexRef.current);
      const producer = currentRows.find((r) => operationRowId(r) === producerId);
      const consumer = currentRows.find((r) => operationRowId(r) === consumerId);
      if (!producer || !consumer) return;
      if (!store.hasColumnType(consumer.tableBlockId, "planned-input")) return;

      const producerKey = normalizePlanName(producer.name);
      const nextNames = consumer.plannedFrom.filter((n) => normalizePlanName(n) !== producerKey);
      if (nextNames.length === consumer.plannedFrom.length) return; // 元々無かった

      const columnName = findColumnNameByType(store.getSnapshot()[consumer.tableBlockId], "planned-input");
      if (!columnName) return;
      const colIndex = findPlannedInputColIndex(editor, consumer.tableBlockId, columnName);
      if (colIndex < 0) return;
      setTableCellAt(editor, consumer.tableBlockId, consumer.rowIndex - 1, colIndex, formatPlannedInputs(nextNames));
    },
    [editorRef],
  );

  const onOpenNoteRef = useCallback(
    (ref: FlowNoteRef, _step: FlowStep) => {
      const editor = editorRef.current;
      if (ref.noteId) {
        // activity-graph-editor.tsx の onOpenExternalNote と同じ順（同じエディタの
        // SidePeek を優先、無ければグローバルコールバック）
        if (!openEditorSidePeek(editor, ref.noteId)) {
          getIndexTableCallbacks()?.onOpenSidePeek(ref.noteId);
        }
        return;
      }
      if (ref.state !== "unlinked") return; // duplicateName 等は何もしない
      void createOperationNoteFromRef(editor, ref, storeRef.current);
    },
    [editorRef],
  );

  /**
   * 工程ノードを選んだときに下のパネルへ出す表。
   *
   * 出すのは相手ノートの中身ではなく、**計画ノート自身のインデックステーブル**。
   * カードに並ぶ条件はこの表の列（plan-flow.ts が 2 列目以降を attrs にしている）
   * なので、ここで直せば本文と往復する。D4（開いていないノートは書き換えない）にも
   * 触れない — 書き換え先はいま開いているノートだから。
   *
   * 行とノートの紐づけを持つ列（note-link）だけは読み取り専用にする。ここを書き換えると
   * noteLinks のキー（＝行名）から外れて、行が「未作成」に落ちてしまう。
   */
  const getPanelFor = useCallback(
    (selection: FlowSelection): StepPanelData | null => {
      const editor = editorRef.current;
      if (!editor || !selection || selection.kind !== "step") return null;
      const store = storeRef.current;
      const rows = collectOperationRowsFromBlocks(
        editor.document ?? [],
        store.getSnapshot(),
        indexRef.current,
      );
      const row = rows.find((r) => operationRowId(r) === selection.step.id);
      if (!row) return null;
      const table = readTable(editor, row.tableBlockId);
      if (!table) return null;
      const noteLinkName = findColumnNameByType(
        store.getSnapshot()[row.tableBlockId],
        "note-link",
      );
      const noteLinkCol = noteLinkName ? table.headers.indexOf(noteLinkName) : -1;
      return {
        stepId: selection.step.id,
        stepName: row.name,
        tables: {
          attribute: { ...table, readonlyColumns: noteLinkCol >= 0 ? [noteLinkCol] : [0] },
          // 入出力・ツールは工程ノート（相手のノート）の中の話で、ここからは書けない。
          // panelSections で attribute だけを描くので、空セクションも出ない
          material: null,
          tool: null,
          output: null,
        },
        // 選んだ工程の行を強調する。表そのものは全行出す（本文と同じものを見る）
        highlight: { blockId: row.tableBlockId, rowName: row.name },
        prose: [],
      };
    },
    [editorRef],
  );

  // パネルの編集はすべて「いま開いている計画ノートの表」への書き込み。
  // 参照が毎レンダー変わると StepFlowView がノードを作り直して工程ノードが消えるため、
  // ファイル内の他のコールバックと同じく editorRef だけを依存にして固定する
  const onSetCell = useCallback(
    (blockId: string, rowIndex: number, colIndex: number, value: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      setTableCellAt(editor, blockId, rowIndex, colIndex, value);
    },
    [editorRef],
  );

  const onRemoveCellImage = useCallback(
    (blockId: string, rowIndex: number, colIndex: number) => {
      const editor = editorRef.current;
      if (!editor) return;
      removeCellImageAt(editor, blockId, rowIndex, colIndex);
    },
    [editorRef],
  );

  const onRenameColumn = useCallback(
    (blockId: string, colIndex: number, name: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      renameTableColumn(editor, blockId, colIndex, name);
    },
    [editorRef],
  );

  const onAddColumn = useCallback(
    (blockId: string, name: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      addTableColumn(editor, blockId, name);
    },
    [editorRef],
  );

  const onRemoveColumn = useCallback(
    (blockId: string, colIndex: number) => {
      const editor = editorRef.current;
      if (!editor) return;
      removeTableColumn(editor, blockId, colIndex);
    },
    [editorRef],
  );

  return (
    <StepFlowView
      graph={result.graph}
      getPanelFor={getPanelFor}
      panelSections={PLAN_PANEL_SECTIONS}
      onSetCell={onSetCell}
      onRemoveCellImage={onRemoveCellImage}
      onRenameColumn={onRenameColumn}
      onAddColumn={onAddColumn}
      onRemoveColumn={onRemoveColumn}
      variant={variant}
      tableLayout={tableLayout}
      layoutScope={noteId ? planFlowScope(noteId) : null}
      onAddActivity={onAddActivity}
      addActivityLabel={t("planFlow.addOperation")}
      emptyTitle={t("planFlow.emptyTitle")}
      emptyHint={t("planFlow.emptyHint")}
      staticHint={t("planFlow.connectHint")}
      onOpenNoteRef={onOpenNoteRef}
      connectNoteRefs
      onConnectSteps={onConnectSteps}
      onRemovePlannedEdge={onRemovePlannedEdge}
    />
  );
}
