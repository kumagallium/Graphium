// WikiFrameSection の「Asterism」ブロックのストーリー。
// 節を開くと末尾に出る。型の語は設定（受け口）で与えたものだけが選べる。
import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { WikiMeta } from "../../lib/document-types";
import { LocaleProvider, syncLocale } from "../../i18n";
import type { AsterismSettings } from "../settings/store";
import { WikiFrameSection } from "./WikiFrameSection";
import "../../app.css";

const meta: Meta = {
  title: "Molecules/WikiFrameSection/Asterism",
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "知見ページ「構造」節の末尾にある Asterism ブロック。型（自動 / 手動の印つき）と根拠 IRI（1 行 1 IRI）を編集する。語は設定で与えたものだけで、Graphium は一覧を持たない。",
      },
    },
  },
  decorators: [
    (Story) => {
      syncLocale("ja");
      return (
        <LocaleProvider>
          <div style={{ background: "var(--paper-2)", padding: 16, maxWidth: 640 }}>
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
};
export default meta;

type Story = StoryObj;

const settings: AsterismSettings = {
  vocabBaseIri: "https://kumagallium.github.io/asterism/vocab/shared#",
  typeSlugs: { observation: "sosa:Observation", interpretation: "interpretation", rule: "rule", judgment: "judgment" },
};

const baseMeta: WikiMeta = {
  kind: "claim",
  statementForm: "general",
  epistemicStatus: "established",
  ruleFrame: {
    conditions: [{ text: "温度が高い" }],
    consequences: [{ text: "収率が下がる" }],
    reviewState: "confirmed",
  },
} as unknown as WikiMeta;

function Wrapper({ initial, conf = settings }: { initial: WikiMeta; conf?: AsterismSettings }) {
  const [m, setM] = useState<WikiMeta>(initial);
  return (
    <WikiFrameSection
      wikiMeta={m}
      asterismSettings={conf}
      defaultOpen
      onUpdateWikiMeta={(patch) => setM((x) => ({ ...x, ...patch }))}
    />
  );
}

export const AutoAssigned: Story = {
  name: "自動割当あり",
  render: () => <Wrapper initial={{ ...baseMeta, asterism: { typeSlug: "rule", typeSlugBy: "auto" } }} />,
};

export const ManualOverride: Story = {
  name: "手動上書き（自動に戻せる）",
  render: () => <Wrapper initial={{ ...baseMeta, asterism: { typeSlug: "interpretation", typeSlugBy: "human" } }} />,
};

export const WithEvidence: Story = {
  name: "根拠あり",
  render: () => (
    <Wrapper
      initial={{
        ...baseMeta,
        asterism: {
          typeSlug: "rule",
          typeSlugBy: "auto",
          evidenceIris: ["https://example.org/observation/1", "ex:observation-2"],
        },
      }}
    />
  ),
};

export const TypeUnset: Story = {
  name: "型が未設定（語は設定済み）",
  render: () => <Wrapper initial={{ ...baseMeta, asterism: { evidenceIris: [] } }} />,
};

// frame の無い claim でも、設定に語があれば Asterism ブロックだけが出る
export const NoFrame: Story = {
  name: "frame 無し（設定に語があるだけ）",
  render: () => <Wrapper initial={{ kind: "claim" } as unknown as WikiMeta} />,
};
