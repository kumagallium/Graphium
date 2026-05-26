// WikiListView のストーリー（PR #349 聴牌レイヤの見た目確認用）
//
// 実際の dev データでは causal=5 / mechanistic=7 / observational=7 と判定境界（=1 / =0）に
// 乗らないため heuristic 聴牌は永遠に発火しない（[[project-tenpai-layer-design]]）。
// このストーリーでモック TenpaiHint を渡し、行レイアウト・バッジ・dismiss ボタンを確認する。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { WikiListView } from "./WikiListView";
import { LocaleProvider } from "../../i18n";
import type {
  GraphiumFile,
  WikiMetaSummary,
} from "../../lib/document-types";
import type { TenpaiHint } from "../ai-assistant/tenpai-types";
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

// 聴牌候補 3 件（dialectic / analogical / abductive）
const TENPAI_HINTS: TenpaiHint[] = [
  {
    id: "dialectic:atom-c1",
    mode: "dialectic",
    missingKey: "tenpai.missing.dialectic.one-more-causal",
    involvedAtoms: [
      { id: "atom-c1", title: "降温速度が遅いほど相純度が高まる" },
    ],
    generatedAt: hoursAgo(1),
  },
  {
    id: "analogical:atom-m1",
    mode: "analogical",
    missingKey: "tenpai.missing.analogical.one-more-mechanism",
    involvedAtoms: [
      { id: "atom-m1", title: "界面拡散が結晶配向の決定要因になる機構" },
    ],
    generatedAt: hoursAgo(6),
  },
  {
    id: "abductive:atom-o1,atom-o2",
    mode: "abductive",
    missingKey: "tenpai.missing.abductive.need-mechanism",
    involvedAtoms: [
      { id: "atom-o1", title: "格子定数 10.47 Å を観測した試料 A" },
      { id: "atom-o2", title: "ゼーベック係数 180 µV/K を観測した試料 B" },
    ],
    generatedAt: daysAgo(1),
  },
];

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
          "発想（synthesis）一覧の表示。tenpaiHints を渡すと『もうすぐ揃いそう』な聴牌行が時系列に混じって表示される（[[project-tenpai-layer-design]]）。",
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

export const SynthesisWithTenpai: Story = {
  name: "発想一覧（聴牌行あり）",
  args: {
    ...baseArgs,
    tenpaiHints: TENPAI_HINTS,
    onDismissTenpai: NOOP,
  },
};

export const SynthesisOnly: Story = {
  name: "発想一覧（聴牌なし）",
  args: {
    ...baseArgs,
    tenpaiHints: [],
  },
};

export const TenpaiOnly: Story = {
  name: "聴牌行のみ（atom 不足で発想がまだない状態の想定）",
  args: {
    ...baseArgs,
    wikiFiles: [],
    wikiMetas: new Map(),
    tenpaiHints: TENPAI_HINTS,
    onDismissTenpai: NOOP,
  },
};
