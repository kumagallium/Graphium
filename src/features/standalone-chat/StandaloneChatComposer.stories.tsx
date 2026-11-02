// ノートに紐づかないチャットの入力欄のストーリー。
// 一覧の先頭（新しいチャットを始める）と会話画面の下（続きを送る）で共用する部品。
// 送信・停止・渡す範囲チップ・エラー表示の見た目だけを確認する（AI 呼び出しはしない）。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { LocaleProvider, syncLocale } from "../../i18n";
import type { GroundingScope } from "../../lib/grounding-scope";
import { StandaloneChatComposer } from "./StandaloneChatComposer";
import type { FolderNode } from "../note-context/folder-tree-model";

const meta: Meta<typeof StandaloneChatComposer> = {
  title: "Molecules/StandaloneChatComposer",
  component: StandaloneChatComposer,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "ノートに紐づかないチャットの入力欄。渡す範囲は外部参照 / 内部参照の 2 値（常に横断検索するので「ノート内参照」は無い）。",
      },
    },
  },
  decorators: [
    (Story, context) => {
      syncLocale("ja");
      const width = (context.parameters.frameWidth as number | undefined) ?? 640;
      return (
        <LocaleProvider>
          <div style={{ width, padding: 12, background: "var(--paper, #fff)" }}>
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
};
export default meta;

type Story = StoryObj<typeof StandaloneChatComposer>;

function WithScopeState({ initial, ...rest }: { initial: GroundingScope } & Partial<React.ComponentProps<typeof StandaloneChatComposer>>) {
  const [scope, setScope] = useState<GroundingScope>(initial);
  return (
    <StandaloneChatComposer
      onSend={(text) => console.info("[story] onSend", text, scope)}
      scope={scope}
      onScopeChange={setScope}
      {...rest}
    />
  );
}

export const Default: Story = {
  name: "既定（内部参照）",
  render: () => <WithScopeState initial="internal" />,
};

export const External: Story = {
  name: "外部参照を選んだ状態",
  render: () => <WithScopeState initial="external" />,
};

export const Loading: Story = {
  name: "応答待ち（停止ボタン）",
  render: () => <WithScopeState initial="internal" loading onStop={() => console.info("[story] onStop")} />,
};

export const WithError: Story = {
  name: "エラー表示",
  render: () => (
    <WithScopeState initial="internal" error="応答の取得に失敗しました。しばらくしてからもう一度お試しください。" />
  ),
};

export const WithoutScopeChip: Story = {
  name: "チップなし（onScopeChange 未指定）",
  args: {
    onSend: (text) => console.info("[story] onSend", text),
  },
};

/** ピークと同じ 320px 幅。チップは送信ヒントの右に収まらず 2 行目に折り返す */
export const Narrow: Story = {
  name: "狭い幅（320px）",
  parameters: { frameWidth: 320 },
  render: () => <WithScopeState initial="internal" />,
};

/** ストーリー用のフォルダツリー（パン作りの世界観） */
const DEMO_FOLDERS: FolderNode[] = [
  {
    name: "AI 会話",
    path: "AI 会話",
    directCount: 3,
    totalCount: 12,
    children: [
      { name: "パン作り", path: "AI 会話/パン作り", directCount: 7, totalCount: 7, children: [] },
      { name: "道具選び", path: "AI 会話/道具選び", directCount: 2, totalCount: 2, children: [] },
    ],
  },
  { name: "発酵の記録", path: "発酵の記録", directCount: 18, totalCount: 18, children: [] },
];

function WithFolderState({ initialFolder, folders = DEMO_FOLDERS }: { initialFolder?: string; folders?: FolderNode[] }) {
  const [scope, setScope] = useState<GroundingScope>("internal");
  const [folder, setFolder] = useState<string | undefined>(initialFolder);
  return (
    <StandaloneChatComposer
      onSend={(text) => console.info("[story] onSend", text, scope, folder)}
      scope={scope}
      onScopeChange={setScope}
      folderScope={{ value: folder, onChange: setFolder, folders }}
    />
  );
}

/** 探すフォルダのチップ（未選択 = すべてのフォルダ）。押すとフォルダの一覧が開く */
export const FolderScopeAll: Story = {
  name: "探すフォルダ: すべて",
  render: () => <WithFolderState />,
};

/** フォルダを選んだ状態。チップが濃くなり、× で「すべて」に戻せる */
export const FolderScopeSelected: Story = {
  name: "探すフォルダ: 子フォルダを選んだ状態",
  render: () => <WithFolderState initialFolder="AI 会話/パン作り" />,
};

export const FolderScopeEmpty: Story = {
  name: "探すフォルダ: フォルダがまだ無い",
  render: () => <WithFolderState folders={[]} />,
};

export const FolderScopeNarrow: Story = {
  name: "探すフォルダ: 狭い幅（320px）",
  parameters: { frameWidth: 320 },
  render: () => <WithFolderState initialFolder="AI 会話/パン作り" />,
};
