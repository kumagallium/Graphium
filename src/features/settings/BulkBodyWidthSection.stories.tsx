// BulkBodyWidthSection — 設定「表示」の「新しいノートを A4 の幅で始める」の下に出す、
// これまでのノートの幅をまとめて変える 2 つのボタン。
// 押すと確認（ブラウザの確認ダイアログ）→ 1 件ずつ進み、進み具合と「止める」→ 終わったら結果を 1 行。
// 実際の読み書きはせず、擬似的に進める（Storybook 用）。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { BulkBodyWidthSection } from "./BulkBodyWidthSection";
import type { BulkWidthMode, BulkWidthResult } from "../paper-mode/bulk-body-width";

const meta: Meta<typeof BulkBodyWidthSection> = {
  title: "Molecules/BulkBodyWidthSection",
  component: BulkBodyWidthSection,
  decorators: [
    (Story) => (
      <div className="max-w-md p-4">
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof BulkBodyWidthSection>;

const TOTAL = 300;

/** 擬似的に 1 件ずつ進める。signal が止まったらそこで終わる。failEvery が正なら、その件ごとに失敗に数える */
function fakeRun(failEvery = 0) {
  return async (
    mode: BulkWidthMode,
    { signal, onProgress }: { signal: AbortSignal; onProgress: (p: { done: number; total: number }) => void },
  ): Promise<BulkWidthResult> => {
    const result: BulkWidthResult = {
      total: TOTAL,
      changed: 0,
      skippedFullWidth: 0,
      skippedAlready: 0,
      skippedOther: 0,
      failed: 0,
      failedIds: [],
      aborted: false,
    };
    onProgress({ done: 0, total: TOTAL });
    for (let i = 1; i <= TOTAL; i++) {
      if (signal.aborted) {
        result.aborted = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 15));
      if (failEvery > 0 && i % failEvery === 0) {
        result.failed++;
        result.failedIds.push(`n${i}`);
      } else if (i % 25 === 0) {
        if (mode === "a4") result.skippedFullWidth++;
        else result.skippedOther++;
      } else if (mode === "a4" && i % 40 === 0) {
        result.skippedAlready++;
      } else {
        result.changed++;
      }
      onProgress({ done: i, total: TOTAL });
    }
    return result;
  };
}

/** 押すと確認が出て、進み具合と「止める」が出る。終わると結果が 1 行 */
export const Default: Story = {
  args: { countTargets: () => TOTAL, run: fakeRun() },
};

/** 失敗した件があるときは、件数と「もう一度押せば続きから」を出す */
export const WithFailures: Story = {
  args: { countTargets: () => TOTAL, run: fakeRun(60) },
};

/** 対象が 0 件のときはボタンを押せない */
export const NoTargets: Story = {
  args: { countTargets: () => 0, run: fakeRun() },
};
