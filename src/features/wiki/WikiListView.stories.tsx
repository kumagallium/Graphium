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

// topic（話題）3 件。うち 1 件はメンバー 0 件（orphan）を含めて表示を確認する。
const TOPIC_FILES: GraphiumFile[] = [
  {
    id: "t1",
    name: "焼結温度とゼーベック係数の関係",
    modifiedTime: hoursAgo(1),
    createdTime: daysAgo(4),
  },
  {
    id: "t2",
    name: "微量置換の効果",
    modifiedTime: daysAgo(2),
    createdTime: daysAgo(6),
  },
  {
    id: "t3",
    name: "孤立した話題（メンバー 0 件）",
    modifiedTime: daysAgo(3),
    createdTime: daysAgo(3),
  },
];

const TOPIC_METAS = new Map<string, WikiMetaSummary>([
  [
    "t1",
    {
      title: TOPIC_FILES[0].name,
      kind: "topic",
      model: "claude-haiku-4-5",
      derivedFromClaims: ["c1", "c2", "c3"],
    },
  ],
  [
    "t2",
    {
      title: TOPIC_FILES[1].name,
      kind: "topic",
      model: "gpt-oss-120b",
      derivedFromClaims: ["c4"],
    },
  ],
  [
    "t3",
    {
      title: TOPIC_FILES[2].name,
      kind: "topic",
      model: "claude-haiku-4-5",
      derivedFromClaims: [],
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

export const TopicList: Story = {
  name: "話題一覧（知見数列・孤立話題を含む）",
  args: {
    ...baseArgs,
    wikiKind: "topic",
    wikiFiles: TOPIC_FILES,
    wikiMetas: TOPIC_METAS,
  },
};

// 知見一覧（Source check, v1.1）— 「出典」列。5 verdict + 未照合 + dismissed の見え方を確認する。
const CLAIM_FILES: GraphiumFile[] = [
  { id: "c1", name: "低加工強度と揮発性成分の過剰添加で単相化が進む", modifiedTime: hoursAgo(2), createdTime: daysAgo(1) },
  { id: "c2", name: "降温速度を緩めると相変態が安定する", modifiedTime: hoursAgo(5), createdTime: daysAgo(2) },
  { id: "c3", name: "微量置換で格子定数が変わる", modifiedTime: daysAgo(1), createdTime: daysAgo(3) },
  { id: "c4", name: "ゼーベック係数は試料履歴に依存する", modifiedTime: daysAgo(2), createdTime: daysAgo(4) },
  { id: "c5", name: "まだ照合していない知見", modifiedTime: daysAgo(3), createdTime: daysAgo(5) },
  { id: "c6", name: "判定できなかった知見", modifiedTime: daysAgo(4), createdTime: daysAgo(6) },
  { id: "c7", name: "出典を開けなかった知見", modifiedTime: daysAgo(5), createdTime: daysAgo(7) },
];

const CLAIM_METAS = new Map<string, WikiMetaSummary>([
  ["c1", { title: CLAIM_FILES[0].name, kind: "claim", model: "claude-haiku-4-5", sourceCheckVerdict: { verdict: "supported", claimHash: "h1" } }],
  ["c2", { title: CLAIM_FILES[1].name, kind: "claim", model: "gpt-oss-120b", sourceCheckVerdict: { verdict: "contradicted", claimHash: "h2" } }],
  ["c3", { title: CLAIM_FILES[2].name, kind: "claim", model: "claude-haiku-4-5", sourceCheckVerdict: { verdict: "not-in-source", claimHash: "h3" } }],
  ["c4", { title: CLAIM_FILES[3].name, kind: "claim", model: "gpt-oss-120b", sourceCheckVerdict: { verdict: "supported", claimHash: "h4", dismissed: true } }],
  ["c5", { title: CLAIM_FILES[4].name, kind: "claim", model: "claude-haiku-4-5" }],
  ["c6", { title: CLAIM_FILES[5].name, kind: "claim", model: "claude-haiku-4-5", sourceCheckVerdict: { verdict: "unclear", claimHash: "h6" } }],
  ["c7", { title: CLAIM_FILES[6].name, kind: "claim", model: "gpt-oss-120b", sourceCheckVerdict: { verdict: "source-missing", claimHash: "h7" } }],
]);

export const ClaimListWithSourceCheck: Story = {
  name: "知見一覧（出典列 — 5 verdict + 未照合 + 確認済み）",
  args: {
    ...baseArgs,
    wikiKind: "claim",
    wikiFiles: CLAIM_FILES,
    wikiMetas: CLAIM_METAS,
    worldGroundingEnabled: false,
  },
};
