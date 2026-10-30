// 線（つながり）のメモを、手順グラフ・工程グラフの編集に結びつけるフック。
//
// StepFlowView に渡す口（edgeMemos）と、線を押して開くメモの小窓（MemoPopover）を一緒に返す。
// 編集ラッパー（ActivityGraphEditor / PlanFlowEditor）が使う。captureIndex が無い・ノートの id が
// 無い文脈（ストーリーなど）では edgeMemos を返さず、StepFlowView は従来のまま動く。
//
// - 件数は captureIndex を 1 回走査して Map にする（buildEdgeMemoIndex）。描画のたびに線ごとに
//   全メモを舐めない
// - 小窓の見出しは「{渡す側} → {受け取る側}」。書く欄は onCreateMemo があるときだけ（読むだけの
//   アーカイブ・ゴミ箱のノートでは出さない）。保存した付け先は MemoSourceEdge ＋ 線を含むノート
// - 小窓の起点は矩形（線は SVG なので要素ではなく矩形で持つ）。印を押したときは印の矩形、
//   メニューから開くときは押した位置の点。同じ線の小窓が開いている間に印を押すと閉じる

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useT } from "../../i18n";
import type { Rect } from "../../ui/floating-position";
import { MemoPopover } from "../asset-browser/MemoPopover";
import { formatMemoEdgeLabel } from "../mobile-capture/memo-edge";
import type { CaptureIndex, MemoSourceEdge } from "../mobile-capture";
import type { FlowGraphData } from "./activity-graph-adapter";
import {
  buildEdgeMemoIndex,
  buildEdgeMemoResolver,
  edgeMemoKey,
  type EdgeMemoGraphKind,
  type EdgeMemos,
} from "./edge-memo";

export type UseEdgeMemosInput = {
  /** steps = 作業手順グラフ / plan = 工程グラフ */
  graphKind: EdgeMemoGraphKind;
  graph: FlowGraphData;
  /** 線を含むノートの fileId（メモの sourceNote.fileId と照合する） */
  noteFileId: string | null | undefined;
  captureIndex: CaptureIndex | null | undefined;
  /** メモを書く（保存に失敗したら reject する。書く欄が文を残す）。無ければ読むだけ */
  onCreateMemo?: (text: string, edge: MemoSourceEdge) => void | Promise<void>;
  /** 一覧の項目を押したとき（メモのピークを開く） */
  onOpenMemo?: (memoId: string) => void;
};

export function useEdgeMemos({
  graphKind,
  graph,
  noteFileId,
  captureIndex,
  onCreateMemo,
  onOpenMemo,
}: UseEdgeMemosInput): { edgeMemos: EdgeMemos | undefined; popover: ReactNode } {
  const t = useT();
  const enabled = Boolean(noteFileId) && Boolean(captureIndex);
  const index = useMemo(
    () => (enabled ? buildEdgeMemoIndex(captureIndex, noteFileId) : null),
    [enabled, captureIndex, noteFileId],
  );
  const [open, setOpen] = useState<{ edge: MemoSourceEdge; anchor: Rect } | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const canWrite = Boolean(onCreateMemo);

  // 線 → 付け先の判定器。graph ごとに 1 回だけ索引を組む（線ごとに手順・線の全件を舐めない）
  const resolveTarget = useMemo(() => buildEdgeMemoResolver(graphKind, graph), [graphKind, graph]);

  const edgeMemos = useMemo<EdgeMemos | undefined>(() => {
    if (!index) return undefined;
    return {
      target: resolveTarget,
      count: (edge) => index.get(edgeMemoKey(edge))?.length ?? 0,
      canWrite,
      onOpen: (edge, anchor) =>
        // 同じ線の小窓が開いていれば閉じる（印の開閉の切り替え）
        setOpen((prev) =>
          prev && edgeMemoKey(prev.edge) === edgeMemoKey(edge) ? null : { edge, anchor },
        ),
    };
  }, [index, resolveTarget, canWrite]);

  const popover = open ? (
    <MemoPopover
      anchor={open.anchor}
      title={formatMemoEdgeLabel(open.edge)}
      memos={index?.get(edgeMemoKey(open.edge)) ?? []}
      onCreate={onCreateMemo ? (text) => onCreateMemo(text, open.edge) : undefined}
      onOpenMemo={onOpenMemo}
      emptyText={canWrite ? t("memoEdge.emptyWritable") : t("memoEdge.empty")}
      onClose={close}
    />
  ) : null;

  return { edgeMemos, popover };
}
