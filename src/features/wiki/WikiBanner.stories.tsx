// WikiBanner のビジュアル確認用ストーリー
// 08b 原案寄せ: sky-soft 背景 / Regenerate dropdown / current 行 forest-soft

import type { Meta, StoryObj } from "@storybook/react-vite";
import { WikiBanner } from "./WikiBanner";
import type { WikiMeta } from "../../lib/document-types";

const meta: Meta<typeof WikiBanner> = {
  title: "Molecules/WikiBanner",
  component: WikiBanner,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Wiki ドキュメント最上部に常駐するバナー。AI 生成バッジ・生成日・モデル名・Regenerate ▾ ドロップダウン・削除ボタンを表示。",
      },
    },
  },
};
export default meta;

const baseMeta: WikiMeta = {
  kind: "summary",
  derivedFromNotes: ["note-abc123"],
  derivedFromChats: [],
  generatedAt: "2026-04-20T14:32:00Z",
  generatedBy: { model: "gpt-4o-mini", version: "" },
};

// モデルリストをストーリーで表示するためのモックモジュール上書き
// getLLMModels を stub してドロップダウンに 4 モデルが出る状態をシミュレート
const STUB_MODELS = [
  { name: "gpt-4o", provider: "openai", modelId: "gpt-4o", apiKey: "", apiBase: "" },
  { name: "gpt-4o-mini", provider: "openai", modelId: "gpt-4o-mini", apiKey: "", apiBase: "" },
  { name: "claude-haiku-4-5", provider: "anthropic", modelId: "claude-haiku-4-5", apiKey: "", apiBase: "" },
  { name: "claude-sonnet-4-6", provider: "anthropic", modelId: "claude-sonnet-4-6", apiKey: "", apiBase: "" },
];

function Wrapper({ wikiMeta, loading = false }: { wikiMeta: WikiMeta; loading?: boolean }) {
  return (
    <div style={{ background: "var(--paper-2)", padding: "16px 0", minWidth: 640 }}>
      <WikiBanner
        wikiMeta={wikiMeta}
        onRegenerate={(opts) => console.info("[story] onRegenerate", opts)}
        onDelete={() => console.info("[story] onDelete")}
        loading={loading}
      />
      <div style={{ padding: "8px 32px", fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--mono)" }}>
        ↑ Regenerate ▾ をクリックするとモデル選択が開きます（{STUB_MODELS.map(m => m.name).join(" / ")}）
      </div>
    </div>
  );
}

export const Summary: StoryObj = {
  name: "Summary — 基本",
  render: () => <Wrapper wikiMeta={baseMeta} />,
};

export const Claim: StoryObj = {
  name: "Claim",
  render: () => <Wrapper wikiMeta={{ ...baseMeta, kind: "claim", generatedBy: { model: "claude-haiku-4-5", version: "" } }} />,
};

export const Synthesis: StoryObj = {
  name: "Synthesis",
  render: () => <Wrapper wikiMeta={{ ...baseMeta, kind: "synthesis", generatedBy: { model: "claude-sonnet-4-6", version: "" } }} />,
};

export const Loading: StoryObj = {
  name: "Loading 状態",
  render: () => <Wrapper wikiMeta={baseMeta} loading />,
};

export const NoModel: StoryObj = {
  name: "モデル名なし",
  render: () => (
    <Wrapper
      wikiMeta={{
        ...baseMeta,
        generatedBy: { model: "", version: "" },
      }}
    />
  ),
};
