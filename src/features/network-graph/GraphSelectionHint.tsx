// グラフ下中央に薄く出す、範囲選択の手ほどき。
//
// 手順フローが「まだエッジが 1 本も無いときだけ、つなぎ方を下中央に薄く出す」の
// と同じ形。数秒で消える通知にしないのは、ノードを動かすことに集中している最中に
// 出ても目に入らないため。出す・出さないの条件は useGraphLayout が持つ
// （手で並べたことがあり、まだ範囲選択を使っていない人にだけ）。
// 手順フローではつなぎ方と同じ場所に来るので、つなぎ方が出ている間は呼び出し側が出さない。

import { useT } from "../../i18n";

/** 下端の案内（範囲選択・手順フローのつなぎ方）を置く、グラフの下端からの距離（px） */
export const GRAPH_HINT_BOTTOM = 10;

export function GraphSelectionHint({
  show,
  hintRef,
}: {
  show: boolean;
  /** 案内の要素（高さを測って fit で避けるため。手順フローが使う） */
  hintRef?: (el: HTMLDivElement | null) => void;
}) {
  const t = useT();
  if (!show) return null;
  return (
    <div
      ref={hintRef}
      // グラフ本体の操作を邪魔しない（クリックは下のキャンバスへ抜ける）
      style={{
        position: "absolute",
        bottom: GRAPH_HINT_BOTTOM,
        left: 0,
        right: 0,
        textAlign: "center",
        fontSize: 11,
        color: "var(--color-text-tertiary)",
        pointerEvents: "none",
        zIndex: 5,
      }}
    >
      {t("graph.layout.selectHint")}
    </div>
  );
}
