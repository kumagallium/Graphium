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

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { StepFlowView } from "./step-flow-view";
import type { FlowGraphData, FlowNoteRef, FlowStep } from "./activity-graph-adapter";
import {
  collectOperationRowsFromBlocks,
  nextDefaultOperationName,
  buildPlanFlowGraph,
} from "./plan-flow";
import {
  getLatestProcessIndex,
  subscribeLatestProcessIndex,
  requestLatestProcessIndexRefresh,
} from "./process-index";
import { planFlowScope } from "./graph-layout";
import { addTableRow } from "./table-row-edit";
import { collectTableBlocks } from "../table-meta/table-cells";
import { useTableMetaStore, type TableMetaStoreValue } from "../table-meta/store";
import { getFirstCellText, createNoteFromRow } from "../index-table/create-note-from-row";
import { getIndexTableCallbacks, openEditorSidePeek } from "../index-table/context";
import { t } from "../../i18n";
import type { GraphiumIndex } from "../navigation/index-file";

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
  onGraphChange?: (info: { graph: FlowGraphData; truncated: boolean; brokenCount: number }) => void;
}) {
  const tableMetaStore = useTableMetaStore();
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
    onGraphChange?.({ graph: result.graph, truncated: result.truncated, brokenCount: result.brokenCount });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const onAddActivity = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const tableBlockId = ensureOperationsTable(editor, tableMetaStore);
    if (!tableBlockId) return;

    const blocks: any[] = editor.document ?? [];
    const currentRows = collectOperationRowsFromBlocks(blocks, tableMetaStore.getSnapshot(), index).filter(
      (r) => r.tableBlockId === tableBlockId,
    );
    const name = nextDefaultOperationName(currentRows.map((r) => r.name));
    addTableRow(editor, tableBlockId, name);
  }, [editorRef, tableMetaStore, index]);

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
      void createOperationNoteFromRef(editor, ref, tableMetaStore);
    },
    [editorRef, tableMetaStore],
  );

  return (
    <StepFlowView
      graph={result.graph}
      variant={variant}
      tableLayout={tableLayout}
      layoutScope={noteId ? planFlowScope(noteId) : null}
      onAddActivity={onAddActivity}
      addActivityLabel={t("planFlow.addOperation")}
      emptyTitle={t("planFlow.emptyTitle")}
      emptyHint={t("planFlow.emptyHint")}
      onOpenNoteRef={onOpenNoteRef}
    />
  );
}
