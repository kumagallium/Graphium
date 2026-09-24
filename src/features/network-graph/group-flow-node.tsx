// 計画ノートの工程フロー専用: 表ごとの帯（グループ）ノード。
//
// 表が 2 つ以上ある計画ノートで、工程ノードを表単位の帯で束ねる
// （plan-flow-groups.proposal.stories.tsx ストーリー 1 で合意した見た目）。
// React Flow の compound layout（parentId 付きノード）の親として使う —
// 選択・ドラッグ・接続はできない、ただの背景の帯。
// ノード型名は "group" にしない — React Flow の既定 CSS（.react-flow__node-group）が
// 黒い枠と灰色の背景を当ててしまう。"band" として登録し、見た目はこの中で全部決める。

import type { Node, NodeProps } from "@xyflow/react";
import { t } from "../../i18n";

/** 色相は表の並び順で等間隔に振る（同じ計画の中で見分けがつくことを優先） */
export const GROUP_HUES = [150, 30, 275, 200, 340, 80];

export function groupNodeColors(index: number): { fill: string; stroke: string; ink: string } {
  const h = GROUP_HUES[index % GROUP_HUES.length];
  return { fill: `hsl(${h}, 45%, 95%)`, stroke: `hsl(${h}, 35%, 62%)`, ink: `hsl(${h}, 40%, 32%)` };
}

export type GroupNodeData = {
  label: string;
  index: number;
};

export type GroupFlowNode = Node<GroupNodeData, "band">;

export function GroupFlowNode({ data }: NodeProps<GroupFlowNode>) {
  const colors = groupNodeColors(data.index);
  const label = data.label.trim() || t("planFlow.tableN", { n: String(data.index + 1) });
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        borderRadius: 12,
        border: `1px dashed ${colors.stroke}`,
        background: colors.fill,
        boxSizing: "border-box",
        // 帯はただの背景。ポインタを通さないと帯の内側の余白クリックが
        // 「ノード上」扱いになり、onPaneClick（線のメニューを閉じる等）や
        // パン・矩形選択の起点が効かなくなる
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 14,
          fontSize: 12,
          fontWeight: 700,
          color: colors.ink,
          pointerEvents: "none",
        }}
      >
        {label}
      </div>
    </div>
  );
}
