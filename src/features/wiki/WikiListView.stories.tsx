// WikiListView のストーリー（発想（synthesis）一覧の見た目確認用）

import type { Meta, StoryObj } from "@storybook/react-vite";
import { WikiListView } from "./WikiListView";
import { LocaleProvider } from "../../i18n";
import type {
  GraphiumFile,
  WikiMetaSummary,
} from "../../lib/document-types";
import "../../app.css";

const now = new Date();
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400_000).toISOString();

// 既存の synthesis 4 件
const SYNTHESIS_FILES: GraphiumFile[] = [
  {
    id: "s1",
    name: "低加工強度と揮発性成分の過剰添加で単相化が進む",
    modifiedTime: hoursAgo(3),
    createdTime: daysAgo(2),
  },
  {
    id: "s2",
    name: "降温速度を緩めると相変態が安定する",
    modifiedTime: hoursAgo(8),
    createdTime: daysAgo(3),
  },
  {
    id: "s3",
    name: "微量置換とアニール時間は独立に格子定数を変える",
    modifiedTime: daysAgo(1),
    createdTime: daysAgo(5),
  },
  {
    id: "s4",
    name: "ゼーベック係数の温度依存性は試料履歴で説明できる",
    modifiedTime: daysAgo(2),
    createdTime: daysAgo(7),
  },
];

const SYNTHESIS_METAS = new Map<string, WikiMetaSummary>([
  [
    "s1",
    {
      title: SYNTHESIS_FILES[0].name,
      kind: "synthesis",
      model: "gpt-oss-120b",
      synthesisMode: "deductive",
      hypothesisStatus: "speculative",
    },
  ],
  [
    "s2",
    {
      title: SYNTHESIS_FILES[1].name,
      kind: "synthesis",
      model: "claude-opus-4-7",
      synthesisMode: "dialectic",
      hypothesisStatus: "tested",
    },
  ],
  [
    "s3",
    {
      title: SYNTHESIS_FILES[2].name,
      kind: "synthesis",
      model: "gpt-oss-120b",
      synthesisMode: "abductive",
      hypothesisStatus: "speculative",
    },
  ],
  [
    "s4",
    {
      title: SYNTHESIS_FILES[3].name,
      kind: "synthesis",
      model: "claude-opus-4-7",
      synthesisMode: "analogical",
      hypothesisStatus: "speculative",
    },
  ],
]);

const NOOP = () => {};
const ASYNC_NOOP = async () => {};

const meta: Meta<typeof WikiListView> = {
  title: "Features/WikiListView",
  component: WikiListView,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "発想（synthesis）一覧の表示。",
      },
    },
  },
  decorators: [
    (Story) => (
      <LocaleProvider>
        <div style={{ height: "100vh", display: "flex", flexDirection: "column", fontFamily: "'Inter', system-ui, sans-serif" }}>
          <Story />
        </div>
      </LocaleProvider>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof WikiListView>;

const baseArgs = {
  noteIndex: null,
  wikiKind: "synthesis" as const,
  wikiFiles: SYNTHESIS_FILES,
  wikiMetas: SYNTHESIS_METAS,
  onOpenWiki: NOOP,
  onOpenWikiFull: NOOP,
  onBack: NOOP,
  onDeleteWiki: ASYNC_NOOP,
  onRegenerateWiki: ASYNC_NOOP,
  onWorldCheckWiki: ASYNC_NOOP,
};

export const SynthesisList: Story = {
  name: "発想一覧",
  args: baseArgs,
};
