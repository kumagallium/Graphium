// グラフ下中央に薄く出す、範囲選択の手ほどき。
//
// 手順フローが「まだエッジが 1 本も無いときだけ、つなぎ方を下中央に薄く出す」の
// と同じ形。数秒で消える通知にしないのは、ノードを動かすことに集中している最中に
// 出ても目に入らないため。出す・出さないの条件は useGraphLayout が持つ
// （手で並べたことがあり、まだ範囲選択を使っていない人にだけ）。

import { useT } from "../../i18n";

export function GraphSelectionHint({ show }: { show: boolean }) {
  const t = useT();
  if (!show) return null;
  return (
    <div
      // グラフ本体の操作を邪魔しない（クリックは下のキャンバスへ抜ける）
      style={{
        position: "absolute",
        bottom: 10,
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
