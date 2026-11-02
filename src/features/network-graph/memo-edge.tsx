// メモのある線（つながり）の描画
//
// 標準の線（BezierEdge）に、メモの印（付箋＋件数）を添えるだけの線の種類。
// メモのある線にだけ使う（メモの無い線・edgeMemos を渡さない画面は標準のまま）。
// 線の名前（userLabel）や「順序のみ」の文字は標準どおり線の中央に出るので、
// 印はその右に並べる（名前が無いときは中央）。手順は上から下へ並ぶので、手順の間（縦）は
// 詰まりやすく、下へずらすと受け取る側の手順の接続点に重なる。印を押すと、メモの小窓が開く。

import { BezierEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import { useT } from "../../i18n";
import type { Rect } from "../../ui/floating-position";
import { MemoChip } from "../asset-browser/MemoChip";

/** 線の中央の文字と印の間（px） */
export const MEMO_EDGE_CHIP_GAP = 4;
/** 線の中央の文字の背景の左右の余白（px。React Flow の labelBgPadding の既定に合わせる） */
const LABEL_BG_PAD_X = 2;

export type MemoEdgeData = {
  /** メモの件数（1 以上のときだけこの種類の線になる） */
  memoCount: number;
  /** 線の中央に文字（線の名前・「順序のみ」など）が出ているか */
  hasLabel: boolean;
  /** 線の中央の文字（幅の見積もりに使う） */
  labelText?: string;
  /** 線の中央の文字の大きさ（px） */
  labelFontSize?: number | string;
  /** 書ける画面か（false = 読むだけ。印の案内文を「読める」だけにする） */
  canWrite: boolean;
  /** 印の矩形（画面座標）を起点に小窓を開く。同じ線の小窓が開いていれば閉じる */
  onOpenMemo: (anchor: Rect) => void;
};

/**
 * 線の中央の文字の幅の見積もり（px）。SVG の文字は描くまで幅が分からないので、
 * 全角（CJK）は文字の大きさ 1 つ分、半角は 0.6 つ分で数える（太字の分を少し多めに見る）
 */
export function estimateLabelWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) {
    w += (ch.codePointAt(0) ?? 0) >= 0x2e80 ? fontSize : fontSize * 0.6;
  }
  return Math.ceil(w);
}

/**
 * 印の横位置のずらし量（px。線の中央から印の左端まで）。文字が無いときは null（中央に置く）
 */
export function memoChipOffsetX(labelText: string | undefined, fontSize: number | string | undefined): number | null {
  if (!labelText) return null;
  const size = typeof fontSize === "number" ? fontSize : Number.parseFloat(String(fontSize ?? "")) || 10;
  return estimateLabelWidth(labelText, size) / 2 + LABEL_BG_PAD_X + MEMO_EDGE_CHIP_GAP;
}

export function MemoEdge(props: EdgeProps) {
  const t = useT();
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props;
  const data = props.data as Partial<MemoEdgeData> | undefined;
  const [, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const count = data?.memoCount ?? 0;
  // 文字があればその右（印の左端を文字の右端に合わせる）、無ければ線の中央
  const offsetX = data?.hasLabel ? memoChipOffsetX(data.labelText, data.labelFontSize) : null;
  const transform =
    offsetX == null
      ? `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`
      : `translate(0, -50%) translate(${labelX + offsetX}px, ${labelY}px)`;
  return (
    <>
      <BezierEdge {...props} />
      {count > 0 && (
        <EdgeLabelRenderer>
          <div
            // nodrag / nopan: 印の上でグラフを動かさない。pointerEvents: 線のラベル層は既定で押せない
            className="nodrag nopan"
            style={{
              position: "absolute",
              transform,
              pointerEvents: "all",
            }}
          >
            <MemoChip
              count={count}
              visible
              label={t("memoEdge.chipCount", { count: String(count) })}
              usage={t(data?.canWrite === false ? "memoEdge.chipUsageReadOnly" : "memoEdge.chipUsage")}
              chipId={`edge:${props.id}`}
              onClick={(e) => {
                // EdgeLabelRenderer はポータルだが、React のイベントは描画上の親（線の <g> の onClick
                // = onEdgeClick）へ伝わる。止めないと線を押した扱いも走り、小窓が開いてすぐ閉じる
                e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                data?.onOpenMemo?.({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
              }}
            />
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/** ReactFlow の edgeTypes。メモのある線だけ type: "memo" にする */
export const MEMO_EDGE_TYPE = "memo";
export const edgeTypes = { [MEMO_EDGE_TYPE]: MemoEdge };
