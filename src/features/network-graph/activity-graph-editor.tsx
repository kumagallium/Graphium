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
import { StepFlowView } from "./step-flow-view";
import { provDocToStepGraph } from "./activity-graph-adapter";
import { useLinkStore } from "../block-link/store";
import { buildDefaultStepTitle, selectStepTitle } from "../../blocks/step/view";
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
}: {
  doc: ProvJsonLd | null;
  /** メインエディタ（BlockNote）への参照。無ければノード操作は出さない（接続のみ） */
  editorRef?: { current: any };
}) {
  const linkStore = useLinkStore();
  // コールバックを安定参照にするため、最新の store は ref 経由で読む
  const linkStoreRef = useRef(linkStore);
  linkStoreRef.current = linkStore;

  const { activities, steps } = useMemo(() => provDocToStepGraph(doc), [doc]);

  // 裏に informed_by リンク（source=consumer / target=producer）があるものだけ削除可能。
  // 本文のラベル由来の手順依存は対応リンクが無いので削除対象外にする。
  const editableSteps = useMemo(
    () =>
      steps.map((s) => ({
        ...s,
        deletable: linkStore.links.some(
          (l) => l.type === "informed_by" && l.sourceBlockId === s.to && l.targetBlockId === s.from,
        ),
      })),
    [steps, linkStore.links],
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

  const onRemoveStep = useCallback((stepId: string) => {
    // stepId は `step-<producer>-><consumer>` の合成 ID（adapter 参照）
    const m = /^step-(.+)->(.+)$/.exec(stepId);
    if (!m) return;
    const link = linkStoreRef.current.links.find(
      (l) => l.type === "informed_by" && l.sourceBlockId === m[2] && l.targetBlockId === m[1],
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

  const hasEditor = !!editorRef;

  return (
    <StepFlowView
      activities={activities}
      steps={editableSteps}
      onConnectSteps={onConnectSteps}
      onRemoveStep={onRemoveStep}
      onAddActivity={hasEditor ? onAddActivity : undefined}
      onRenameActivity={hasEditor ? onRenameActivity : undefined}
      onDeleteActivity={hasEditor ? onDeleteActivity : undefined}
      onJumpToBlock={hasEditor ? onJumpToBlock : undefined}
      getStepContentCount={hasEditor ? getStepContentCount : undefined}
    />
  );
}
