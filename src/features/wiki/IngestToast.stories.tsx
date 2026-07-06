// IngestToast — AI 処理（Ingest / Wiki パイプライン）の進捗トースト
// 画面右下に fixed 表示される。ヘッダーの ∨ で最小化（ピル表示）、ピルをクリックで再展開。

import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { IngestToast, type IngestToastState } from "./IngestToast";

const meta: Meta<typeof IngestToast> = {
  title: "Molecules/IngestToast",
  component: IngestToast,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof IngestToast>;

/** dismiss 後に再表示できるラッパー（完了トーストは実挙動どおり 5 秒で自動的に消える） */
function ToastPlayground({ initial }: { initial: IngestToastState }) {
  const [state, setState] = useState<IngestToastState>(initial);
  return (
    <div className="min-h-[420px] p-4 space-y-2">
      <p className="text-xs text-muted-foreground max-w-md">
        トーストは画面右下に fixed 表示されます。ヘッダーの ∨ ボタンで最小化（進捗ピルに切り替え）、
        ピルをクリックすると再展開します。完了トーストは 5 秒で自動的に消えます。
      </p>
      {state === null && (
        <button
          className="text-xs underline text-primary"
          onClick={() => setState(initial)}
        >
          トーストを再表示
        </button>
      )}
      <IngestToast state={state} onDismiss={() => setState(null)} />
    </div>
  );
}

/** 大量アイテム処理中 — 最小化が効くケース（チャット欄と重なる高さまで成長する） */
export const ManyItemsActive: Story = {
  name: "処理中（大量アイテム）",
  render: () => (
    <ToastPlayground
      initial={{
        items: [
          { id: "1", status: "success", noteTitle: "Cu粉末の焼結実験（第1回）", result: "3 claims" },
          { id: "2", status: "success", noteTitle: "シリカ管の前処理手順", result: "2 claims" },
          { id: "3", status: "success", noteTitle: "XRD 分析結果", result: "4 claims" },
          {
            id: "4",
            status: "generating",
            noteTitle: "ゼーベック係数の温度依存性",
            detail: "claims...",
            stages: [
              { key: "cross-update", label: "Cross-update", status: "done", detail: "2 wikis" },
              { key: "atomize", label: "Atomize", status: "running" },
              { key: "synthesize", label: "Synthesize", status: "pending" },
              { key: "lint", label: "Lint", status: "pending" },
            ],
          },
          { id: "5", status: "queued", noteTitle: "第2回焼結実験の計画" },
          { id: "6", status: "queued", noteTitle: "SPS 装置の操作メモ" },
          { id: "7", status: "queued", noteTitle: "熱電材料レビュー論文の抜粋" },
          { id: "8", status: "queued", noteTitle: "粒界偏析と伝導率の関係" },
        ],
      }}
    />
  ),
};

/** 全件成功（5 秒で自動 dismiss） */
export const AllSuccess: Story = {
  name: "全件完了",
  render: () => (
    <ToastPlayground
      initial={{
        items: [
          { id: "1", status: "success", noteTitle: "Cu粉末の焼結実験（第1回）", result: "3 claims" },
          { id: "2", status: "success", noteTitle: "シリカ管の前処理手順", result: "2 claims" },
        ],
      }}
    />
  ),
};

/** エラー混じり — 最小化ピルにも赤いエラー件数が出る */
export const WithErrors: Story = {
  name: "エラーあり",
  render: () => (
    <ToastPlayground
      initial={{
        items: [
          { id: "1", status: "success", noteTitle: "Cu粉末の焼結実験（第1回）", result: "3 claims" },
          {
            id: "2",
            status: "error",
            noteTitle: "シリカ管の前処理手順",
            result: "LLM API error: 401 Unauthorized — サブスクリプションの再認証が必要です",
          },
          {
            id: "3",
            status: "generating",
            noteTitle: "XRD 分析結果",
            detail: "claims...",
          },
          { id: "4", status: "queued", noteTitle: "第2回焼結実験の計画" },
        ],
      }}
    />
  ),
};
