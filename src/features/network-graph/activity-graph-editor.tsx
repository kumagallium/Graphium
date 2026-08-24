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

import {
  useCallback,
  useMemo,
  useReducer,
  useRef,
  useSyncExternalStore,
} from "react";
import { StepFlowView, type EntityKind } from "./step-flow-view";
import { provDocToFlowGraph, splitAttrLabel, type ActivityIoKind } from "./activity-graph-adapter";
import { useLinkStore } from "../block-link/store";
import { buildDefaultStepTitle, selectStepTitle } from "../../blocks/step/view";
import { appendEntitySpanToStep, findLabeledTableInStep } from "../../blocks/step/step-io";
import { useLabelStore } from "../context-label/store";
import { appendEntityRowToTable } from "./table-row-edit";
import { t } from "../../i18n";
import {
  renameInlineEntity,
  removeInlineEntity,
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
import type { ProvJsonLd } from "../prov-generator/generator";
import {
  getLatestProcessIndex,
  subscribeLatestProcessIndex,
} from "./process-index";
import { addCrossNoteOriginsToFlowGraph } from "./cross-note-flow";
import {
  getIndexTableCallbacks,
  openEditorSidePeek,
} from "../index-table/context";

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
  const processIndex = useSyncExternalStore(
    subscribeLatestProcessIndex,
    getLatestProcessIndex,
    getLatestProcessIndex,
  );

  const flowGraph = useMemo(() => provDocToFlowGraph(doc), [doc]);

  // orderOnly エッジのうち、裏に informed_by リンクがあるものだけ削除可能。
  // 本文のラベル由来の手順依存は対応リンクが無いので削除対象外にする。
  const graph = useMemo(() => {
    const withExternalOrigins = addCrossNoteOriginsToFlowGraph(
      flowGraph,
      linkStore.links,
      processIndex,
    );
    return {
      ...withExternalOrigins,
      edges: withExternalOrigins.edges.map((e) =>
        e.kind === "orderOnly"
          ? {
              ...e,
              deletable: linkStore.links.some(
                (l) =>
                  l.type === "informed_by" &&
                  !l.targetNoteId &&
                  l.sourceBlockId === e.target &&
                  l.targetBlockId === e.source,
              ),
            }
          : e,
      ),
    };
  }, [flowGraph, linkStore.links, processIndex]);
  // コールバックを安定参照に保つため、外部プロセスを含む最新グラフを ref でも読む。
  const flowGraphRef = useRef(graph);
  flowGraphRef.current = graph;

  const getEditor = useCallback(() => editorRef?.current ?? null, [editorRef]);

  // パネル経由の書き込み（表の作成・セル編集など）は PROV 出力を変えない
  // ことがある（例: 値が空のパラメータ表）。その場合 doc は変わらず再レンダー
  // が起きないので、パネルが古い表データ（ファントム）を映したまま固まる。
  // 書き込み系コールバックの最後に呼んで、getPanelFor を確実に再計算させる
  const [, bumpPanel] = useReducer((x: number) => x + 1, 0);

  // 直前に作ったラベル付きテーブル（`${stepId}:${kind}` → blockId）。
  // labelStore の反映は次のレンダーまで届かないので、連続で呼ばれると
  // 「まだ表が無い」と誤判定して表を作り直してしまう（実バグ: 連打で表が増えた）。
  // ラベル検索が空振りしたときの控えとして使う。
  const recentTablesRef = useRef<Map<string, string>>(new Map());
  /** step 内の kind ラベル付きテーブルを探す（直近作成分も込み） */
  const findSectionTable = useCallback(
    (editor: any, stepId: string, kind: string): string | null => {
      const labels = labelStoreRef.current.labels;
      const byLabel = findLabeledTableInStep(editor.document ?? [], labels, stepId, kind as any);
      if (byLabel) return byLabel;
      const recent = recentTablesRef.current.get(`${stepId}:${kind}`);
      // 消された表を掴み続けないよう、実在するときだけ返す
      if (recent && findBlockById(editor.document ?? [], recent)) return recent;
      return null;
    },
    [],
  );
  const rememberTable = useCallback((stepId: string, kind: string, blockId: string) => {
    recentTablesRef.current.set(`${stepId}:${kind}`, blockId);
  }, []);

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

  /** Entity がどの step のものか（生成元を優先、無ければ使用側） */
  const owningStepOf = useCallback((entityNodeId: string): string | null => {
    const g = flowGraphRef.current;
    const gen = g.edges.find((e) => e.kind === "generates" && e.target === entityNodeId);
    if (gen) return gen.source;
    const used = g.edges.find((e) => e.kind === "used" && e.source === entityNodeId);
    return used?.target ?? null;
  }, []);

  /**
   * 本文 span 由来の Entity を、所属 step の表へ移す。
   * 表が無ければ作ってラベルを付け、行を足したあと元の span のラベルを外す
   * （同じ名前の Entity が 2 つに割れないように）。
   */
  const onMoveEntityToTable = useCallback(
    (entityNodeId: string) => {
      const editor = getEditor();
      if (!editor) return;
      const g = flowGraphRef.current;
      const entity = g.entities.find((e) => e.id === entityNodeId);
      if (!entity || entity.tableRef) return;
      const stepId = owningStepOf(entityNodeId);
      if (!stepId) return;
      const labels = labelStoreRef.current;
      const result = appendEntityRowToTable(
        editor,
        stepId,
        entity.label,
        (id) => findSectionTable(editor, id, entity.kind),
        t("graphTable.nameColumn"),
      );
      if (!result) return;
      rememberTable(stepId, entity.kind, result.tableBlockId);
      if (result.created) labels.setLabel(result.tableBlockId, entity.kind);
      // ハイライトで紐付いていた属性は、列として一緒に連れて行く。
      // Entity 名の印（下で残す）と違い、属性は「値」そのものなので、
      // 列に書いたうえで印を残すと同じ事実が 2 回数えられてしまう。
      // キーが同名の列があればそこへ、無ければ列を足して書き、印は外す
      const attrs = entity.attrs.filter((a) => !!a.entityId);
      if (attrs.length > 0) {
        let table = readTable(editor, result.tableBlockId);
        const rowIdx = table ? table.rows.findIndex((r) => r[0] === entity.label) : -1;
        if (table && rowIdx >= 0) {
          for (const a of attrs) {
            const { key, value } = splitAttrLabel(a.label);
            const colKey = key ?? a.label;
            let colIdx = table.headers.indexOf(colKey);
            if (colIdx < 0) {
              addTableColumn(editor, result.tableBlockId, colKey);
              colIdx = table.headers.length; // 追加後の index（旧ヘッダ数）
              table = readTable(editor, result.tableBlockId) ?? table;
            }
            setTableCellAt(editor, result.tableBlockId, rowIdx, colIdx, value);
            removeInlineEntity(editor, a.entityId!);
          }
        }
      }
      // 本文の印はそのまま残す。「表に追加」は足すだけで、頼まれていない
      // 本文の書き換えはしない（読むときの色分けは本文側の情報）。
      // 表の行と本文の印は同名なので generator が 1 Entity に統合し、
      // パネルの薄い行はそれで消える。
      bumpPanel();
    },
    [getEditor, owningStepOf, bumpPanel],
  );

  // パネルは「選択の裏にある step の中身ぜんぶ」。step 選択でもその中の
  // Entity 選択でも同じデータを返し、Entity 側はハイライト情報だけ変わる
  const getPanelFor = useCallback(
    (selection: any) => {
      const editor = getEditor();
      if (!editor || !selection) return null;
      const g = flowGraphRef.current;
      const stepId =
        selection.kind === "step" ? selection.step.id : owningStepOf(selection.entity.id);
      if (!stepId) return null;
      const step = g.steps.find((s) => s.id === stepId);
      if (!step) return null;

      const labels = labelStoreRef.current.labels;
      const doc = editor.document ?? [];
      // findSectionTable = ラベル検索 + 直近作成分のフォールバック。
      // 作成直後は labelStore の反映が次レンダーまで届かないことがあり、
      // ラベル検索だけだと「まだ無い」と誤判定してファントムに戻ってしまう
      const tableOf = (kind: string) => {
        const id = findSectionTable(editor, stepId, kind);
        return id ? readTable(editor, id) : null;
      };
      const tables = {
        attribute: tableOf("attribute"),
        material: tableOf("material"),
        tool: tableOf("tool"),
        output: tableOf("output"),
      };

      // この step が実際につないでいる Entity（使う / 生む の両方向）。
      // 同名統合や共有で 1 つの Entity を複数 step が使うので、「所属」ではなく
      // 「つながっているか」で拾う — でないと片方の step からしか見えなくなる
      const connectedIds = new Set<string>();
      for (const e of g.edges) {
        if (e.kind === "used" && e.target === stepId) connectedIds.add(e.source);
        if (e.kind === "generates" && e.source === stepId) connectedIds.add(e.target);
      }
      const ownTableIds = new Set(
        Object.values(tables)
          .filter((t): t is NonNullable<typeof t> => !!t)
          .map((t) => t.blockId),
      );
      // この step の表に既にある行の名前（種類ごと）。同名統合で実体が
      // 他 step の表の行になっても、こちらの表にも同じ名前の行があるなら
      // それはもう「表にある」— 薄い行として二重に出さない
      const ownRowNames: Record<string, Set<string>> = {};
      for (const [kind, table] of Object.entries(tables)) {
        ownRowNames[kind] = new Set((table?.rows ?? []).map((r) => (r[0] ?? "").trim()));
      }
      // 共有行の実体がどの step の表にあるか（「◯◯ にあります」+ ジャンプ用）
      const homeStepOf = (tableBlockId: string): { id: string; name: string } | null => {
        for (const s of g.steps) {
          for (const kind of ["attribute", "material", "tool", "output"] as const) {
            if (findLabeledTableInStep(doc, labels, s.id, kind as any) === tableBlockId) {
              return { id: s.id, name: s.name };
            }
          }
        }
        return null;
      };

      // この step の表に載っていない Entity は、種類のセクションに薄い行として出す。
      // 本文ハイライト由来は表へ移せる。他 step の表にある行（共有）は移せないので
      // 「よそにある」ことだけ示す（勝手に複製すると同じものが 2 行になる）
      const prose = [
        ...step.params
          .filter((p) => !!p.entityId)
          .map((p) => ({ entityId: p.entityId!, kind: "attribute" as const, label: p.label })),
        ...g.entities
          .filter(
            (e): e is typeof e & { kind: ActivityIoKind } =>
              // "block" は derived エッジ専用の合成 Entity。used/generates で
              // つながることはないので connectedIds にも入らない実装上の不変条件だが、
              // ここでも明示して material/tool/output 専用セクションへの型を絞る
              e.kind !== "block" &&
              connectedIds.has(e.id) &&
              !ownTableIds.has(e.tableRef?.blockId ?? "") &&
              !ownRowNames[e.kind]?.has(e.label.trim()),
          )
          .map((e) => {
            const home = e.tableRef ? homeStepOf(e.tableRef.blockId) : null;
            return {
              entityId: e.entityId ?? e.id,
              // 移行できるのは本文ハイライト由来だけ（表の行はもう表にある）
              nodeId: e.tableRef ? undefined : e.id,
              external: !!e.tableRef,
              homeBlockId: e.tableRef?.blockId,
              homeStepName: home?.name,
              kind: e.kind,
              label: e.label,
              attrs: e.attrs,
            };
          }),
      ];

      // この step の表にある外部参照行（行名 → 由来）。参照元の現在の属性を
      // パネルに読み取り専用で並記するための情報
      const externalOrigins: Record<string, import("./activity-graph-adapter").ExternalFlowOrigin> = {};
      for (const e of g.entities) {
        if (!e.externalOrigin) continue;
        // 外部参照行は定義上この step の表に足したもの。リネーム後は
        // entity @id が旧行名のままになり tableRef が取れないことがあるため、
        // 「この step につながっているか」だけで拾う
        if (!connectedIds.has(e.id)) continue;
        externalOrigins[e.label.trim()] = e.externalOrigin;
      }

      const ref = selection.kind === "entity" ? selection.entity.tableRef : undefined;
      return {
        stepId,
        stepName: step.name,
        tables,
        highlight: ref ? { blockId: ref.blockId, rowName: ref.rowName } : undefined,
        proseHighlight:
          selection.kind === "entity" && !ref ? (selection.entity.entityId ?? undefined) : undefined,
        prose,
        externalOrigins,
      };
    },
    [getEditor, owningStepOf, findSectionTable],
  );

  const onSetCell = useCallback(
    (blockId: string, rowIndex: number, colIndex: number, value: string) => {
      const editor = getEditor();
      if (!editor) return;
      setTableCellAt(editor, blockId, rowIndex, colIndex, value);
      bumpPanel();
    },
    [getEditor, bumpPanel],
  );

  const onRenameColumn = useCallback(
    (blockId: string, colIndex: number, name: string) => {
      const editor = getEditor();
      if (!editor) return;
      renameTableColumn(editor, blockId, colIndex, name);
      bumpPanel();
    },
    [getEditor, bumpPanel],
  );

  const onAddColumn = useCallback(
    (blockId: string, name: string) => {
      const editor = getEditor();
      if (!editor) return;
      addTableColumn(editor, blockId, name);
      bumpPanel();
    },
    [getEditor, bumpPanel],
  );

  const onRemoveColumn = useCallback(
    (blockId: string, colIndex: number) => {
      const editor = getEditor();
      if (!editor) return;
      removeTableColumn(editor, blockId, colIndex);
      bumpPanel();
    },
    [getEditor, bumpPanel],
  );

  const onAddRow = useCallback(
    (blockId: string, name: string) => {
      const editor = getEditor();
      if (!editor) return;
      addTableRow(editor, blockId, name);
      bumpPanel();
    },
    [getEditor, bumpPanel],
  );

  /**
   * 本文ハイライト由来のパラメータ（attribute span）をパラメータ表の列へ移す。
   * 表が無ければ key を最初の列として作り、あれば列を足して 1 行目に値を書く。
   * 取り込んだら元の span のラベルを外す（Entity の表移行と同じ流儀）。
   */
  const onMoveParamToTable = useCallback(
    (stepBlockId: string, entityId: string, key: string, value: string) => {
      const editor = getEditor();
      if (!editor) return;
      const labels = labelStoreRef.current;
      const find = (id: string) => findSectionTable(editor, id, "attribute");
      const existing = find(stepBlockId);
      const colIndex = existing ? (readTable(editor, existing)?.headers.length ?? 0) : 0;
      const result = ensureParameterTable(editor, stepBlockId, key, find);
      if (!result) return;
      rememberTable(stepBlockId, "attribute", result.tableBlockId);
      if (result.created) {
        labels.setLabel(result.tableBlockId, "attribute");
      } else {
        addTableColumn(editor, result.tableBlockId, key);
      }
      setTableCellAt(editor, result.tableBlockId, 0, colIndex, value);
      removeInlineEntity(editor, entityId);
      bumpPanel();
    },
    [getEditor, bumpPanel],
  );

  // セクションの空の 1 マスに打ち込まれたら、その内容で表を作ってラベルを付ける。
  // 「表を追加」という前段は置かない — 打たなければノートには何も書かれず、
  // 打った瞬間に中身のある表ができる（空の表だけが残る状態を作らない）。
  const onCreateSectionTable = useCallback(
    (stepBlockId: string, kind: "attribute" | ActivityIoKind, name: string) => {
      const editor = getEditor();
      if (!editor) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      const labels = labelStoreRef.current;
      const find = (id: string) => findSectionTable(editor, id, kind);
      // パラメータは打った内容が「キー（列名）」、入出力・ツールは「行の名前」
      const result =
        kind === "attribute"
          ? ensureParameterTable(editor, stepBlockId, trimmed, find)
          : appendEntityRowToTable(editor, stepBlockId, trimmed, find, t("graphTable.nameColumn"));
      if (!result) return;
      rememberTable(stepBlockId, kind, result.tableBlockId);
      if (result.created) labels.setLabel(result.tableBlockId, kind);
      bumpPanel();
    },
    [getEditor, findSectionTable, rememberTable, bumpPanel],
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
  // 作って 1 行目に書き、ラベルを付ける。パラメータはここを通らない —
  // step のパラメータ表（attribute ラベル）の列として足す。
  const onAddEntity = useCallback(
    (stepBlockId: string, kind: EntityKind, text: string) => {
      const editor = getEditor();
      if (!editor) return;
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
      bumpPanel();
    },
    [getEditor, bumpPanel],
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
      // output と同様、block（derived エッジ専用の合成 Entity）も接続時は
      // 汎用の material として書く（block 自体を種類として本文に書く語彙は無い）
      const kind: ActivityIoKind =
        entity.kind === "output" || entity.kind === "block" ? "material" : entity.kind;
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
        entity.kind === "output" || entity.kind === "block" ? "material" : entity.kind,
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
  const onOpenExternalNote = useCallback((noteId: string) => {
    if (!openEditorSidePeek(getEditor(), noteId)) {
      getIndexTableCallbacks()?.onOpenSidePeek(noteId);
    }
  }, [getEditor]);

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
      onOpenExternalNote={onOpenExternalNote}
      onRenameTableRow={hasEditor ? onRenameTableRow : undefined}
      onRemoveTableRow={hasEditor ? onRemoveTableRow : undefined}
      tableLayout={tableLayout}
      getPanelFor={hasEditor ? getPanelFor : undefined}
      onSetCell={hasEditor ? onSetCell : undefined}
      onRenameColumn={hasEditor ? onRenameColumn : undefined}
      onAddColumn={hasEditor ? onAddColumn : undefined}
      onRemoveColumn={hasEditor ? onRemoveColumn : undefined}
      onAddRow={hasEditor ? onAddRow : undefined}
      onCreateSectionTable={hasEditor ? onCreateSectionTable : undefined}
      onMoveEntityToTable={hasEditor ? onMoveEntityToTable : undefined}
      onMoveParamToTable={hasEditor ? onMoveParamToTable : undefined}
    />
  );
}
