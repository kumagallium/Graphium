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
// - 線の操作（名前を付ける・外す・削除）は小窓の見出しの右に小さなアイコンボタンで置く（actions を渡されたときだけ）。
//   削除は 2 段階（1 回目で「削除する？」の確認表示、数秒で元に戻る、2 回目で実行して小窓を閉じる）
// - 小窓の起点は矩形（線は SVG なので要素ではなく矩形で持つ）。印を押したときは印の矩形、
//   押した位置の点（線を押して開くとき）。同じ線の小窓が開いている間に印を押すと閉じる

import { useCallback, useEffect, useId, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { Eraser, Pencil, Trash2 } from "lucide-react";
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
  type EdgePopoverActions,
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

const ICON_BUTTON =
  "inline-flex h-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-black/5 hover:text-foreground transition-colors";
/** 削除の確認表示が元に戻るまで（ミリ秒） */
export const EDGE_DELETE_CONFIRM_MS = 3000;

/** 線のメモの小窓。actions があれば見出しの右に線の操作を置く */
function EdgeMemoPopover({
  actions,
  ...popoverProps
}: Omit<ComponentProps<typeof MemoPopover>, "headerAction" | "children"> & {
  actions?: EdgePopoverActions;
}) {
  const t = useT();
  const { onClose } = popoverProps;
  // 名前の入力中の値（null = 入力欄を開いていない）
  const [draft, setDraft] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const listId = useId();
  useEffect(() => {
    if (!confirming) return;
    const id = setTimeout(() => setConfirming(false), EDGE_DELETE_CONFIRM_MS);
    return () => clearTimeout(id);
  }, [confirming]);

  const canLabel = Boolean(actions?.pair && actions.onSetLabel);
  const canRemove = Boolean(actions?.remove && actions.onRemove);
  const removeLabel = actions?.remove === "planned" ? t("planFlow.removePlanned") : t("activityGraph.deleteStep");
  const labelTitle = actions?.userLabel ? t("planFlow.renameEdgeLabel") : t("planFlow.addEdgeLabel");

  const headerAction =
    actions && (canLabel || canRemove) ? (
      <span className="inline-flex items-center gap-0.5 shrink-0">
        {canLabel && (
          <button
            type="button"
            onClick={() => setDraft(actions.userLabel)}
            data-tooltip={labelTitle}
            aria-label={labelTitle}
            data-test="edgePopoverLabel"
            className={`${ICON_BUTTON} w-6`}
          >
            <Pencil size={13} />
          </button>
        )}
        {canLabel && actions.userLabel && (
          <button
            type="button"
            onClick={() => {
              actions.onSetLabel?.("");
              onClose();
            }}
            data-tooltip={t("planFlow.clearEdgeLabel")}
            aria-label={t("planFlow.clearEdgeLabel")}
            data-test="edgePopoverClearLabel"
            className={`${ICON_BUTTON} w-6`}
          >
            <Eraser size={13} />
          </button>
        )}
        {canRemove && (
          <button
            type="button"
            onClick={() => {
              if (!confirming) {
                setConfirming(true);
                return;
              }
              actions.onRemove?.();
              onClose();
            }}
            data-tooltip={confirming ? t("memoEdge.confirmDelete") : removeLabel}
            aria-label={confirming ? t("memoEdge.confirmDelete") : removeLabel}
            data-test="edgePopoverRemove"
            className={`${ICON_BUTTON} ${confirming ? "px-1.5 gap-1 text-[11px] font-medium" : "w-6"}`}
            style={{ color: "var(--color-destructive)" }}
          >
            <Trash2 size={13} />
            {confirming && t("memoEdge.confirmDelete")}
          </button>
        )}
      </span>
    ) : undefined;

  return (
    <MemoPopover {...popoverProps} headerAction={headerAction}>
      {actions && canLabel && draft !== null && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            actions.onSetLabel?.(draft);
            onClose();
          }}
          className="flex gap-1 px-3 py-2 border-b border-border-subtle"
        >
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // 日本語入力の変換確定の Enter で保存しない（WebKit は keyCode 229 も見る）
              if (e.key === "Enter" && (e.nativeEvent.isComposing || e.keyCode === 229)) {
                e.preventDefault();
                return;
              }
              if (e.key === "Escape") {
                // 入力の取り消し（小窓は閉じない）
                e.stopPropagation();
                e.nativeEvent.stopImmediatePropagation();
                setDraft(null);
              }
            }}
            list={listId}
            placeholder={t("planFlow.edgeLabelPlaceholder")}
            aria-label={t("planFlow.addEdgeLabel")}
            maxLength={40}
            data-test="edgePopoverLabelInput"
            className="flex-1 min-w-0 text-xs rounded-md border border-border bg-background px-1.5 py-1 text-foreground"
          />
          <datalist id={listId}>
            {(actions.labelSuggestions ?? []).map((label) => (
              <option key={label} value={label} />
            ))}
          </datalist>
          <button type="submit" className="text-xs rounded-md border border-border px-2 text-foreground hover:bg-black/5">
            {t("planFlow.saveEdgeLabel")}
          </button>
        </form>
      )}
    </MemoPopover>
  );
}

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
  const [open, setOpen] = useState<{ edge: MemoSourceEdge; anchor: Rect; actions?: EdgePopoverActions } | null>(null);
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
      close,
      onOpen: (edge, anchor, actions) =>
        // 同じ線の小窓が開いていれば閉じる（印の開閉の切り替え）
        setOpen((prev) =>
          prev && edgeMemoKey(prev.edge) === edgeMemoKey(edge) ? null : { edge, anchor, actions },
        ),
    };
  }, [index, resolveTarget, canWrite, close]);

  const popover = open ? (
    <EdgeMemoPopover
      // 線が変わったら入力・確認の状態を持ち越さない
      key={edgeMemoKey(open.edge)}
      actions={canWrite ? open.actions : undefined}
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
