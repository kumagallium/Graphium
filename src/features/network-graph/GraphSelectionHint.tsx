// グラフ下中央に一度だけ出す、範囲選択の手ほどき。
//
// 「shift + 背景ドラッグでまとめて動かせる」は知らなければ見つからない操作だが、
// 常設の説明文を置くとグラフの邪魔になる（手順フロービューの方針）。初めて
// ノードを動かした直後だけ出す — そのとき人は「並べ替えたい人」なので、
// ちょうど必要な情報が必要な場面で届く。表示条件は useGraphLayout が持つ。

import { useT } from "../../i18n";

export function GraphSelectionHint({ show }: { show: boolean }) {
  const t = useT();
  if (!show) return null;
  return (
    <div
      // グラフ本体の操作を邪魔しない（クリックは下のキャンバスへ抜ける）
      style={{
        position: "absolute",
        bottom: 12,
        left: "50%",
        transform: "translateX(-50%)",
        maxWidth: "min(90%, 420px)",
        padding: "5px 12px",
        fontSize: 11,
        lineHeight: 1.5,
        textAlign: "center",
        color: "var(--color-muted-foreground)",
        background: "var(--color-card)",
        // ブランドグリーンの細い縁で「読むもの」だと分かる程度に持ち上げる。
        // 背景まで塗ると通知のように見えて、探索の邪魔になる
        border: "1px solid var(--color-primary)",
        borderRadius: 999,
        boxShadow: "0 1px 3px rgba(30, 20, 10, 0.08)",
        pointerEvents: "none",
        zIndex: 5,
      }}
    >
      <span aria-hidden style={{ marginRight: 6, opacity: 0.7 }}>⇧</span>
      {t("graph.layout.selectHint")}
    </div>
  );
}
