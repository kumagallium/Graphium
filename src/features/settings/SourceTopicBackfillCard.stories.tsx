// 設定の点検・整理「資料からトピックを作る」のカード。
// 実行は確認の窓を挟むので、ここでは押す前の見え方（対象の本数・飛ばす本数）を並べる。
// 「トピックを作る」を押すと、確かめの窓のあとに進み具合と結果が出る（モックは 1 本 0.6 秒）。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { ConfirmHost } from "../../ui/confirm-dialog";
import { SourceTopicBackfillCard, type SourceTopicBackfillHandlers } from "./SourceTopicBackfillCard";

function handlers(sources: number, alreadySettled: number, failEvery = 0): SourceTopicBackfillHandlers {
  let left = sources;
  return {
    plan: async () => ({ sources: left, alreadySettled }),
    run: async (onProgress, signal) => {
      const total = left;
      let done = 0;
      let topics = 0;
      let failed = 0;
      for (; done < total; ) {
        if (signal.aborted) break;
        await new Promise((r) => setTimeout(r, 600));
        if (failEvery > 0 && (done + 1) % failEvery === 0) failed++;
        else topics += 2;
        done++;
        onProgress({ done, total, topicsTouched: topics });
      }
      left -= done - failed;
      return {
        done, total, topicsTouched: topics, created: Math.floor(topics / 2), noTopic: 1, unreadable: 0,
        failedSources: failed, aborted: signal.aborted, stoppedByFailures: false,
      };
    },
  };
}

const meta: Meta<typeof SourceTopicBackfillCard> = {
  title: "Features/Settings/SourceTopicBackfillCard",
  component: SourceTopicBackfillCard,
  parameters: { layout: "padded" },
  // 確かめの窓はアプリと同じ ConfirmHost で出す（無いと押しても進まない）
  decorators: [(Story) => <div style={{ maxWidth: 560 }}><Story /><ConfirmHost /></div>],
};
export default meta;

type Story = StoryObj<typeof SourceTopicBackfillCard>;

/** まとめて取り込んだあとにアプリを閉じて、トピックの段が残った状態 */
export const Pending: Story = { args: { handlers: handlers(5, 0) } };

/** 前に回して、トピックにするものが無かった資料を飛ばす */
export const WithSettled: Story = { args: { handlers: handlers(3, 4) } };

/** 途中で失敗する資料がある（結果の行に、やり直せることを添える） */
export const WithFailures: Story = { args: { handlers: handlers(4, 0, 2) } };

/** 対象が無ければカードごと出ない */
export const NothingToDo: Story = { args: { handlers: handlers(0, 0) } };
