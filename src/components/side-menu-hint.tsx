// ブロック左の ＋ / ⠿ に出すツールチップ
//
// BlockNote のサイドメニューのボタンは aria-label しか持たず、見た目のヒントが無い。
// Notion 系のエディタを知らない人は「⠿ を掴むと動く」「押すとメニューが出る」に
// 気付けないので、ホバーで名前と使い方を出す。
//
// 表示は共通ツールチップ（src/ui/tooltip.ts）に任せる。BlockNote の AddBlockButton /
// DragHandleButton は自前でボタンを描くので、display: contents の span に属性を付けて包む
// （並びのレイアウトは変わらない。ツールチップは最初の子＝ボタンの矩形に合わせて出る）。
// 使い方の行は ＋ と ⠿ でそれぞれ 5 回使ったら出さない（data-tooltip-graduate）。

import type { ReactNode } from "react";
import { useT } from "../i18n";

export type SideMenuHintKind = "add" | "drag";

/** ツールチップの見た目だけ（Storybook 用。本物は src/ui/tooltip.ts が同じクラスで描く） */
export function HintBubble({ title, usage }: { title: string; usage?: string }) {
  return (
    <div className="graphium-hint-bubble" role="tooltip">
      <div className="graphium-hint-title">{title}</div>
      {usage && <div className="graphium-hint-usage">{usage}</div>}
    </div>
  );
}

export function SideMenuHint({ kind, children }: { kind: SideMenuHintKind; children: ReactNode }) {
  const t = useT();
  const title = kind === "add" ? t("sideMenuHint.addTitle") : t("sideMenuHint.dragTitle");
  const usage = kind === "add" ? t("sideMenuHint.addUsage") : t("sideMenuHint.dragUsage");
  return (
    <span
      style={{ display: "contents" }}
      data-tooltip={title}
      data-tooltip-usage={usage}
      data-tooltip-graduate={kind}
    >
      {children}
    </span>
  );
}
