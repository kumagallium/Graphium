// ──────────────────────────────────────────────
// 手順フローグラフを実データに接続する編集ラッパー。
//
// - 描画: provDoc を手順フロー用データ（手順 + 手順依存）に変換して渡す
// - 接続: ドラッグ A(産)→B(使) を informed_by リンクとして書き込む
//   （source=今の手順 B / target=前の手順 A の規約。生成側が PROV 側で output 経由に desugar）
// - ノード操作: 追加・リネーム・削除はエディタの step ブロック操作へ翻訳する。
//   グラフは常に blocks+links からの投影であり、ここで書くのはドキュメント側だけ
//   （デバウンス後の PROV 再生成でグラフに反映される）。
//
// コールバックはすべて ref 経由 + useCallback で参照安定にしてある —
// StepFlowView は data 変化でノードを作り直すため、不安定な関数を渡すと
// 毎レンダーでグラフ全体が再構築されてしまう。
// ──────────────────────────────────────────────

import { useCallback, useMemo, useRef } from "react";
import { StepFlowView, type EntityKind } from "./step-flow-view";
import { provDocToFlowGraph, type ActivityIoKind } from "./activity-graph-adapter";
import { useLinkStore } from "../block-link/store";
import { buildDefaultStepTitle, selectStepTitle } from "../../blocks/step/view";
import { appendEntitySpanToStep, findLabeledTableInStep } from "../../blocks/step/step-io";
import { useLabelStore } from "../context-label/store";
import { appendEntityRowToTable } from "./table-row-edit";
import { t } from "../../i18n";
import { makeEntityId } from "../../features/inline-label/shortcuts";
import {
  renameInlineEntity,
  removeInlineEntity,
  addDependentAttribute,
} from "../../features/inline-label/entity-edit";
import {
  renameTableRow,
  removeTableRow,
  readTable,
  renameTableColumn,
  setTableCellAt,
  addTableColumn,
  removeTableColumn,
  addTableRow,
  ensureParameterTable,
} from "./table-row-edit";
import { PARENT_ACTIVITY_MARKER } from "../../features/inline-label/attribute-binding";
import type { ProvJsonLd } from "../prov-generator/generator";

/** 文書順で最後の step ブロック id（ネスト含む）。新しい手順の挿入位置に使う */
function findLastStepId(blocks: any[]): string | null {
  let last: string | null = null;
  const walk = (list: any[]) => {
    for (const b of list ?? []) {
      if (!b || typeof b !== "object") continue;
      if (b.type === "step" && b.id) last = b.id;
      if (Array.isArray(b.children)) walk(b.children);
    }
  };
  walk(blocks);
  return last;
}

/** blockId のブロックをツリーから探す */
function findBlockById(blocks: any[], blockId: string): any | null {
  for (const b of blocks ?? []) {
    if (!b || typeof b !== "object") continue;
    if (b.id === blockId) return b;
    if (Array.isArray(b.children)) {
      const hit = findBlockById(b.children, blockId);
      if (hit) return hit;
    }
  }
  return null;
}

/** サブツリー内の総ブロック数 */
function countBlocks(blocks: any[]): number {
  let n = 0;
  for (const b of blocks ?? []) {
    if (!b || typeof b !== "object") continue;
    n += 1 + countBlocks(b.children ?? []);
  }
  return n;
}

/** ブロック（自身含む）に含まれる step の id。削除時のリンク掃除用 */
function collectStepIds(block: any): string[] {
  const out: string[] = [];
  const walk = (b: any) => {
    if (!b || typeof b !== "object") return;
    if (b.type === "step" && b.id) out.push(b.id);
    for (const c of b.children ?? []) walk(c);
  };
  walk(block);
  return out;
}

/** step の中身のブロック数。「空の paragraph 1 個」だけなら 0（実質空）扱い */
function stepContentCount(step: any): number {
  const children: any[] = step?.children ?? [];
  if (
    children.length === 1 &&
    children[0]?.type === "paragraph" &&
    !(children[0].content ?? []).some(
      (c: any) => typeof c?.text === "string" && c.text.trim() !== "",
    )
  ) {
    return 0;
  }
  return countBlocks(children);
}

export function ActivityGraphEditor({
  doc,
  editorRef,
  tableLayout,
}: {
  doc: ProvJsonLd | null;
  /** メインエディタ（BlockNote）への参照。無ければノード操作は出さない（接続のみ） */
  editorRef?: { current: any };
  /** 属性テーブルの置き場所（全画面では右横） */
  tableLayout?: "below" | "side";
}) {
  const linkStore = useLinkStore();
  const labelStore = useLabelStore();
  // コールバックを安定参照にするため、最新の store は ref 経由で読む
  const linkStoreRef = useRef(linkStore);
  linkStoreRef.current = linkStore;
  const labelStoreRef = useRef(labelStore);
  labelStoreRef.current = labelStore;

  const flowGraph = useMemo(() => provDocToFlowGraph(doc), [doc]);
  // コールバックを安定参照に保つため、最新のグラフは ref 経由でも読めるようにする
  const flowGraphRef = useRef(flowGraph);
  flowGraphRef.current = flowGraph;

  // orderOnly エッジのうち、裏に informed_by リンクがあるものだけ削除可能。
  // 本文のラベル由来の手順依存は対応リンクが無いので削除対象外にする。
  const graph = useMemo(
    () => ({
      ...flowGraph,
      edges: flowGraph.edges.map((e) =>
        e.kind === "orderOnly"
          ? {
              ...e,
              deletable: linkStore.links.some(
                (l) =>
                  l.type === "informed_by" &&
                  l.sourceBlockId === e.target &&
                  l.targetBlockId === e.source,
              ),
            }
          : e,
      ),
    }),
    [flowGraph, linkStore.links],
  );

  const getEditor = useCallback(() => editorRef?.current ?? null, [editorRef]);

  const onConnectSteps = useCallback(
    (producer: string, consumer: string) =>
      // 「A が産み B が使う」= B wasInformedBy A → addLink(source=B, target=A)
      // 循環は store が拒否する（{ error: "cycle_detected" }）。表示はグラフ側が行う。
      linkStoreRef.current.addLink({
        sourceBlockId: consumer,
        targetBlockId: producer,
        type: "informed_by",
        createdBy: "human",
      }),
    [],
  );

  const onRemoveOrderEdge = useCallback((producer: string, consumer: string) => {
    const link = linkStoreRef.current.links.find(
      (l) => l.type === "informed_by" && l.sourceBlockId === consumer && l.targetBlockId === producer,
    );
    if (link) linkStoreRef.current.removeLink(link.id);
  }, []);

  const onAddActivity = useCallback(() => {
    const editor = getEditor();
    if (!editor) return;
    const blocks: any[] = editor.document ?? [];
    // 最後の手順の直後（兄弟）に足す。手順がまだ無ければ文書末尾に足す。
    const reference = findLastStepId(blocks) ?? blocks[blocks.length - 1]?.id;
    if (!reference) return;
    // stepSlashItem と同じ形: タイトルは実テキスト（空だとグラフにノードが立たない）
    const inserted = editor.insertBlocks(
      [
        {
          type: "step",
          content: [{ type: "text", text: buildDefaultStepTitle(blocks), styles: {} }],
          children: [{ type: "paragraph" }],
        },
      ],
      reference,
      "after",
    );
    const newId = inserted?.[0]?.id;
    if (newId) selectStepTitle(editor, newId);
  }, [getEditor]);

  const onRenameActivity = useCallback(
    (blockId: string, title: string) => {
      const editor = getEditor();
      if (!editor) return;
      try {
        // step のタイトルは content（inline）。タイトル行はインラインラベルの
        // 付与対象外なのでプレーンテキストで置き換えてよい。
        editor.updateBlock(blockId, {
          content: [{ type: "text", text: title, styles: {} }],
        });
      } catch {
        // 既に消えたブロックなどは無視（次の再生成でノードも消える）
      }
    },
    [getEditor],
  );

  const onDeleteActivity = useCallback(
    (blockId: string) => {
      const editor = getEditor();
      if (!editor) return;
      // 掃除対象のリンクを削除前に確定する（ネスト step のリンクも道連れになるため）
      const step = findBlockById(editor.document ?? [], blockId);
      const stepIds = step ? collectStepIds(step) : [blockId];
      try {
        editor.removeBlocks([blockId]);
      } catch {
        return;
      }
      for (const l of linkStoreRef.current.links) {
        if (
          l.type === "informed_by" &&
          (stepIds.includes(l.sourceBlockId) || stepIds.includes(l.targetBlockId))
        ) {
          linkStoreRef.current.removeLink(l.id);
        }
      }
    },
    [getEditor],
  );

  const onJumpToBlock = useCallback((blockId: string) => {
    const el = document.querySelector(
      `[data-id="${blockId}"][data-node-type="blockOuter"]`,
    );
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // ハイライトは要素の style ではなく <style> の data-id セレクタで当てる。
    // フォーカス移動で step ブロックの DOM が再マウントされ、要素に直接
    // 付けた outline は数百 ms で消えてしまう（実測）ため。
    const styleEl = document.createElement("style");
    styleEl.textContent = `[data-id="${blockId}"][data-node-type="blockOuter"] { outline: 2px solid #5b8fb9; border-radius: 4px; }`;
    document.head.appendChild(styleEl);
    setTimeout(() => styleEl.remove(), 1500);
  }, []);

  const getStepContentCount = useCallback(
    (blockId: string): number => {
      const step = findBlockById(getEditor()?.document ?? [], blockId);
      return step ? stepContentCount(step) : 0;
    },
    [getEditor],
  );

  const onAddAttrToEntity = useCallback(
    (parentEntityId: string, text: string) => {
      const editor = getEditor();
      if (!editor) return;
      addDependentAttribute(editor, parentEntityId, text, () => makeEntityId("attribute"));
    },
    [getEditor],
  );

  // ── テーブル行 Entity（構造化テーブルの行）の編集: ノート側のセルを書き換える ──

  const onRenameTableRow = useCallback(
    (blockId: string, rowName: string, newName: string) => {
      const editor = getEditor();
      if (!editor) return;
      renameTableRow(editor, blockId, rowName, newName);
    },
    [getEditor],
  );

  // ── 右パネルのグリッド編集: ノート側テーブルを直接読み書きする ──

  const getTableFor = useCallback(
    (selection: any) => {
      const editor = getEditor();
      if (!editor || !selection) return { table: null };
      const labels = labelStoreRef.current.labels;
      if (selection.kind === "entity") {
        const ref = selection.entity.tableRef;
        if (!ref) return { table: null };
        const table = readTable(editor, ref.blockId);
        const highlightRow = table?.rows.findIndex((r) => r[0] === ref.rowName);
        return { table, highlightRow: highlightRow != null && highlightRow >= 0 ? highlightRow : undefined };
      }
      // step: パラメータ表（attribute ラベル付きテーブル）
      const id = findLabeledTableInStep(editor.document ?? [], labels, selection.step.id, "attribute" as any);
      return { table: id ? readTable(editor, id) : null };
    },
    [getEditor],
  );

  const onSetCell = useCallback(
    (blockId: string, rowIndex: number, colIndex: number, value: string) => {
      const editor = getEditor();
      if (editor) setTableCellAt(editor, blockId, rowIndex, colIndex, value);
    },
    [getEditor],
  );

  const onRenameColumn = useCallback(
    (blockId: string, colIndex: number, name: string) => {
      const editor = getEditor();
      if (editor) renameTableColumn(editor, blockId, colIndex, name);
    },
    [getEditor],
  );

  const onAddColumn = useCallback(
    (blockId: string, name: string) => {
      const editor = getEditor();
      if (editor) addTableColumn(editor, blockId, name);
    },
    [getEditor],
  );

  const onRemoveColumn = useCallback(
    (blockId: string, colIndex: number) => {
      const editor = getEditor();
      if (editor) removeTableColumn(editor, blockId, colIndex);
    },
    [getEditor],
  );

  const onAddRow = useCallback(
    (blockId: string, name: string) => {
      const editor = getEditor();
      if (editor) addTableRow(editor, blockId, name);
    },
    [getEditor],
  );

  // step にパラメータ表がまだ無いとき: 作ってラベルを付け、最初の列をキーにする
  const onCreateParamColumn = useCallback(
    (stepBlockId: string, key: string) => {
      const editor = getEditor();
      if (!editor) return;
      const labels = labelStoreRef.current;
      const result = ensureParameterTable(editor, stepBlockId, key, (id) =>
        findLabeledTableInStep(editor.document ?? [], labels.labels, id, "attribute" as any),
      );
      if (result?.created) labels.setLabel(result.tableBlockId, "attribute");
    },
    [getEditor],
  );

  const onRemoveTableRow = useCallback(
    (blockId: string, rowName: string) => {
      const editor = getEditor();
      if (!editor) return;
      removeTableRow(editor, blockId, rowName);
    },
    [getEditor],
  );

  // ── Entity / パラメータの CRUD（本文 span への翻訳） ──

  // グラフからの入出力の追加は、まず step 内の該当ラベル付きテーブルに行を足す
  // （F 案: ノート側には単語の羅列ではなく試料表が育つ）。テーブルが無ければ
  // 作って 1 行目に書き、ラベルを付ける。パラメータだけは Activity 直結の
  // インライン span のまま（表にすると 1 行 1 Entity の意味とズレる）。
  const onAddEntity = useCallback(
    (stepBlockId: string, kind: EntityKind, text: string) => {
      const editor = getEditor();
      if (!editor) return;
      if (kind === "attribute") {
        appendEntitySpanToStep(editor, stepBlockId, kind, text);
        return;
      }
      const labels = labelStoreRef.current;
      const result = appendEntityRowToTable(
        editor,
        stepBlockId,
        text,
        (id) => findLabeledTableInStep(editor.document ?? [], labels.labels, id, kind),
        t("graphTable.nameColumn"),
      );
      if (!result) {
        // 表を作れない状況（step が見つからない等）は従来どおり span で書く
        appendEntitySpanToStep(editor, stepBlockId, kind, text);
        return;
      }
      if (result.created) {
        // 新規テーブルは generator に Entity として読ませるためラベルが要る
        labels.setLabel(result.tableBlockId, kind);
      }
    },
    [getEditor],
  );

  // Entity ノード → step の接続: その Entity と同名の入力 span を対象 step に合成する。
  // 出力を繋いだ場合は「次の手順の材料になる」ので material として書き、さらに
  // 生成元 step との informed_by も張る — これが generator の Entity unification を
  // 発火させ、出力ノードと入力 span が 1 つの Entity に merge されて受け渡しの
  // 実線になる（informed_by が無いと同名でも別 Entity のまま分裂する）。
  const onConnectEntityToStep = useCallback(
    (entityNodeId: string, stepBlockId: string) => {
      const g = flowGraphRef.current;
      const entity = g.entities.find((e) => e.id === entityNodeId);
      if (!entity) return;
      const kind: ActivityIoKind = entity.kind === "output" ? "material" : entity.kind;
      onAddEntity(stepBlockId, kind, entity.label);
      const gen = g.edges.find((e) => e.kind === "generates" && e.target === entityNodeId);
      if (gen && gen.source !== stepBlockId) {
        // 循環は store が拒否する（結果は次の再生成で見える）
        linkStoreRef.current.addLink({
          sourceBlockId: stepBlockId,
          targetBlockId: gen.source,
          type: "informed_by",
          createdBy: "human",
        });
      }
    },
    [onAddEntity],
  );

  // Entity の下ポートを空白へドロップ → その Entity を受け取る新しい手順を作る。
  // 生成元 step の直後に置き、入力 span + informed_by まで張って
  // 「引き出したら次の工程が生まれる」を 1 操作で完結させる。
  const onCreateStepFromEntity = useCallback(
    (entityNodeId: string) => {
      const editor = getEditor();
      if (!editor) return;
      const g = flowGraphRef.current;
      const entity = g.entities.find((e) => e.id === entityNodeId);
      if (!entity) return;
      const blocks: any[] = editor.document ?? [];
      const producer = g.edges.find((e) => e.kind === "generates" && e.target === entityNodeId)?.source;
      const reference =
        (producer && findBlockById(blocks, producer) ? producer : null) ??
        findLastStepId(blocks) ??
        blocks[blocks.length - 1]?.id;
      if (!reference) return;
      const inserted = editor.insertBlocks(
        [
          {
            type: "step",
            content: [{ type: "text", text: buildDefaultStepTitle(blocks), styles: {} }],
            children: [{ type: "paragraph" }],
          },
        ],
        reference,
        "after",
      );
      const newId = inserted?.[0]?.id;
      if (!newId) return;
      appendEntitySpanToStep(
        editor,
        newId,
        entity.kind === "output" ? "material" : entity.kind,
        entity.label,
      );
      if (producer) {
        linkStoreRef.current.addLink({
          sourceBlockId: newId,
          targetBlockId: producer,
          type: "informed_by",
          createdBy: "human",
        });
      }
      selectStepTitle(editor, newId);
    },
    [getEditor],
  );

  const onRenameEntity = useCallback(
    (entityId: string, newText: string) => {
      const editor = getEditor();
      if (!editor) return;
      renameInlineEntity(editor, entityId, newText);
    },
    [getEditor],
  );

  const onRemoveEntity = useCallback(
    (entityId: string) => {
      const editor = getEditor();
      if (!editor) return;
      removeInlineEntity(editor, entityId);
    },
    [getEditor],
  );

  const hasEditor = !!editorRef;

  return (
    <StepFlowView
      graph={graph}
      onConnectSteps={onConnectSteps}
      onRemoveOrderEdge={onRemoveOrderEdge}
      onConnectEntityToStep={hasEditor ? onConnectEntityToStep : undefined}
      onCreateStepFromEntity={hasEditor ? onCreateStepFromEntity : undefined}
      onAddActivity={hasEditor ? onAddActivity : undefined}
      onRenameActivity={hasEditor ? onRenameActivity : undefined}
      onDeleteActivity={hasEditor ? onDeleteActivity : undefined}
      onJumpToBlock={hasEditor ? onJumpToBlock : undefined}
      getStepContentCount={hasEditor ? getStepContentCount : undefined}
      onAddEntity={hasEditor ? onAddEntity : undefined}
      onRenameEntity={hasEditor ? onRenameEntity : undefined}
      onRemoveEntity={hasEditor ? onRemoveEntity : undefined}
      onAddAttrToEntity={hasEditor ? onAddAttrToEntity : undefined}
      onRenameTableRow={hasEditor ? onRenameTableRow : undefined}
      onRemoveTableRow={hasEditor ? onRemoveTableRow : undefined}
      tableLayout={tableLayout}
      getTableFor={hasEditor ? getTableFor : undefined}
      onSetCell={hasEditor ? onSetCell : undefined}
      onRenameColumn={hasEditor ? onRenameColumn : undefined}
      onAddColumn={hasEditor ? onAddColumn : undefined}
      onRemoveColumn={hasEditor ? onRemoveColumn : undefined}
      onAddRow={hasEditor ? onAddRow : undefined}
      onCreateParamColumn={hasEditor ? onCreateParamColumn : undefined}
    />
  );
}
