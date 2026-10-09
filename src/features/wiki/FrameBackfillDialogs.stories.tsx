// 判断・規則の構造の補完ダイアログ — 確認 / 結果（スキップあり）/ 対象 0 件

import type { Meta, StoryObj } from "@storybook/react-vite";
import { FrameBackfillConfirmDialog, FrameBackfillResultDialog } from "./FrameBackfillDialogs";

const meta: Meta = {
  title: "Molecules/FrameBackfillDialogs",
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

const noop = () => {};

/** 確認: 件数・本文は変えない旨・使うモデル */
export const Confirm: Story = {
  render: () => <FrameBackfillConfirmDialog count={12} modelName="example-model" onStart={noop} onCancel={noop} />,
};

/** 結果: 完了・スキップ（理由つき）・失敗・切り詰めた出典・破棄した構造 */
export const ResultWithSkipped: Story = {
  render: () => (
    <FrameBackfillResultDialog
      onClose={noop}
      result={{
        summary: {
          done: [
            { id: "w1", title: "採用する手法を決めた" },
            { id: "w2", title: "条件を満たすと結果が変わる" },
          ],
          skipped: [
            { id: "w3", title: "出典が消えた知見", reason: "deleted" },
            { id: "w4", title: "原文から構造が確認できない知見", reason: "no-frame" },
            { id: "w5", title: "出典が無い知見", reason: "no-sources" },
          ],
          failed: [{ id: "w6", title: "保存に失敗した知見", error: "save failed" }],
          droppedFrames: 3,
          truncatedSources: ["s1"],
        },
        truncatedSources: [{ id: "s1", title: "とても長い資料" }],
      }}
    />
  ),
};

/** 対象 0 件: 開始ボタンを出さず、その旨だけ見せる */
export const NoTargets: Story = {
  render: () => <FrameBackfillConfirmDialog count={0} onStart={noop} onCancel={noop} />,
};
