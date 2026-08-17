// OcrToast — 画像 OCR の進捗トースト
// 画面右下に fixed 表示される小さなピル。自動 OCR は画像を貼っただけで裏で走るため、
// 何が起きているかを短く知らせるのが役目（操作は持たせない）。

import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { OcrToast, type OcrToastState } from "./OcrToast";

const meta: Meta<typeof OcrToast> = {
  title: "Molecules/OcrToast",
  component: OcrToast,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof OcrToast>;

/** 状態を差し替えて見比べるためのラッパー（完了トーストは実挙動どおり数秒で消える） */
function ToastPlayground({ initial }: { initial: OcrToastState }) {
  const [state, setState] = useState<OcrToastState>(initial);
  return (
    <div className="min-h-[320px] p-4 space-y-2">
      <p className="text-xs text-muted-foreground max-w-md">
        トーストは画面右下に fixed 表示されます。読み取り中は出したままで、結果は数秒で
        自動的に消えます（操作の邪魔をしないため）。
      </p>
      <div className="flex gap-2">
        <button
          className="text-xs underline text-primary"
          onClick={() => setState({ running: 1, chars: 0, empty: 0 })}
        >
          読み取り中にする
        </button>
        <button
          className="text-xs underline text-primary"
          onClick={() => setState({ running: 0, chars: 412, empty: 0 })}
        >
          完了にする
        </button>
      </div>
      <OcrToast state={state} />
    </div>
  );
}

/** 読み取り中 — 画像を貼った直後。枚数分が終わるまで出したままにする。 */
export const Running: Story = {
  render: () => <ToastPlayground initial={{ running: 1, chars: 0, empty: 0 }} />,
};

/** 複数枚を続けて読み取り中（まとめて貼った場合） */
export const RunningMultiple: Story = {
  render: () => <ToastPlayground initial={{ running: 3, chars: 0, empty: 0 }} />,
};

/** 完了 — 抽出できた文字数を出す。数秒で自動的に消える。 */
export const Done: Story = {
  render: () => <ToastPlayground initial={{ running: 0, chars: 412, empty: 0 }} />,
};

/**
 * 文字が取れなかった場合 — 写真やイラストではこれが普通なので、
 * 失敗（赤）ではなく淡い muted 表示にして不安を煽らない。
 */
export const NoText: Story = {
  render: () => <ToastPlayground initial={{ running: 0, chars: 0, empty: 1 }} />,
};

/**
 * 読み取り自体に失敗した場合（タイムアウト・画像を開けない等）。
 * 「文字が無かった」とは違うので、amber の注意色で件数を出す。
 * 一括 OCR で最初の 1 件から詰まったとき（デスクトップの宙吊り）はこの表示になる。
 */
export const Failed: Story = {
  render: () => <ToastPlayground initial={{ running: 0, chars: 0, empty: 0, failed: 2 }} />,
};

/** 一括 OCR で一部だけ失敗 — 読めた文字数と失敗件数を並べて出す */
export const DoneWithFailures: Story = {
  render: () => (
    <ToastPlayground initial={{ running: 0, chars: 1280, empty: 3, failed: 1 }} />
  ),
};
