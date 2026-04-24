// Composer（Cmd+K）のビジュアル確認用ストーリー
// 実際のキーボードショートカットは無効化した状態でオーバーレイを常時表示する。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { LocaleProvider } from "@/i18n";
import { Composer } from "./Composer";
import type { ComposerMode, ComposerSubmission, DiscoveryCard } from "./types";

const meta: Meta<typeof Composer> = {
  title: "Molecules/Composer",
  component: Composer,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Cmd+K で開くグローバル Composer。実アプリでは Ask モードのみ右パネル Chat に配線済み（Compose / Insert は後続 PR）。本ストーリーは配線なしのシェルで、submit と発見カード選択は console に流れる。",
      },
    },
  },
};
export default meta;

type Args = {
  defaultMode?: ComposerMode;
  showDiscoveryCards?: boolean;
};

function Harness({ defaultMode = "ask", showDiscoveryCards = false }: Args) {
  const [mode, setMode] = useState<ComposerMode>(defaultMode);
  const [prompt, setPrompt] = useState("");
  const [log, setLog] = useState<string[]>([]);

  const sampleCards: DiscoveryCard[] = showDiscoveryCards
    ? [
        {
          id: "continue",
          title: "続きを書く",
          hint: "直前の段落を踏まえた次の一文",
          action: { kind: "continue-writing" },
        },
        {
          id: "summarize",
          title: "このノートを要約する",
          hint: "見出し単位で 3 行にまとめる",
          action: { kind: "summarize-note" },
        },
        {
          id: "visualize",
          title: "PROV を可視化",
          hint: "現在のノートの来歴グラフを開く",
          action: { kind: "visualize-prov" },
        },
        {
          id: "concept",
          title: "Concept Wiki を作る",
          hint: "頻出キーワードから Concept ノートを下書き",
          action: { kind: "make-concept-wiki" },
        },
      ]
    : [];

  return (
    <LocaleProvider>
      <div
        style={{
          background: "var(--paper-2)",
          height: "100dvh",
          padding: 32,
          fontFamily: "'Inter', system-ui, sans-serif",
          color: "var(--ink-2)",
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        <p style={{ marginTop: 0 }}>
          背景はエディタを想定した紙面。Composer がオーバーレイで表示されている状態を常時レンダリング。
        </p>
        {log.length > 0 && (
          <ul style={{ marginTop: 12, paddingLeft: 16 }}>
            {log.map((l, i) => (
              <li key={i} style={{ fontFamily: "ui-monospace, 'SF Mono', monospace", fontSize: 12 }}>
                {l}
              </li>
            ))}
          </ul>
        )}
        <Composer
          open
          mode={mode}
          onModeChange={setMode}
          prompt={prompt}
          onPromptChange={setPrompt}
          onSubmit={(submission: ComposerSubmission) => {
            setLog((prev) => [...prev, `submit: mode=${submission.mode}, prompt="${submission.prompt}"`]);
            setPrompt("");
          }}
          onClose={() => setLog((prev) => [...prev, "close (dismissed)"])}
          discoveryCards={sampleCards}
          onDiscoveryCardSelect={(card) =>
            setLog((prev) => [...prev, `card: ${card.id} (${card.action.kind})`])
          }
        />
      </div>
    </LocaleProvider>
  );
}

export const AskMode: StoryObj<Args> = {
  name: "Ask モード（初期状態）",
  render: (args) => <Harness {...args} />,
  args: { defaultMode: "ask" },
};

export const ComposeMode: StoryObj<Args> = {
  name: "Compose モード",
  render: (args) => <Harness {...args} />,
  args: { defaultMode: "compose" },
};

export const InsertProvMode: StoryObj<Args> = {
  name: "Insert PROV モード",
  render: (args) => <Harness {...args} />,
  args: { defaultMode: "insert-prov" },
};

export const WithDiscoveryCards: StoryObj<Args> = {
  name: "発見カード付き",
  render: (args) => <Harness {...args} />,
  args: { defaultMode: "ask", showDiscoveryCards: true },
};
