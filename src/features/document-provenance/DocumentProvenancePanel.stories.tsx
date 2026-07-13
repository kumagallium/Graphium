// DocumentProvenancePanel（履歴タブ）のビジュアル確認用ストーリー
// #553 で追加された Wiki 成長操作の型ラベルと、取り込みソース（EditActivity.used）
// のチップ表示（成長タイムライン）を確認する。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { DocumentProvenancePanel, type ResolvedRevisionSource } from "./DocumentProvenancePanel";
import type { DocumentProvenance, RevisionSummary } from "./types";

const meta: Meta<typeof DocumentProvenancePanel> = {
  title: "Molecules/DocumentProvenancePanel",
  component: DocumentProvenancePanel,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "右レール「履歴」タブのリビジョンタイムライン。Wiki（Knowledge）では " +
          "ingest / merge / cross-update / 重複統合 / 再生成 / 洞察抽出 の各操作が " +
          "型付きで刻まれ、各操作が取り込んだソース（EditActivity.used）がチップとして並ぶ。" +
          "チップは resolveSource が openId を返した場合クリック可能（SidePeek で開く）。",
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ width: 320, border: "1px solid var(--border, #e5e7eb)", borderRadius: 8 }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof DocumentProvenancePanel>;

function summary(over: Partial<RevisionSummary> = {}): RevisionSummary {
  return {
    blocksAdded: 0,
    blocksRemoved: 0,
    blocksModified: 0,
    labelsChanged: [],
    provLinksAdded: 0,
    provLinksRemoved: 0,
    knowledgeLinksAdded: 0,
    knowledgeLinksRemoved: 0,
    ...over,
  };
}

/** wiki の典型的な成長履歴: ingest → merge → cross-update → 再生成 */
const growthProvenance: DocumentProvenance = {
  agents: [{ id: "agent_ai_claude", type: "ai", label: "claude-sonnet" }],
  activities: [
    {
      id: "edit_001", type: "wiki_ingest",
      startedAt: "2026-07-01T09:00:00Z", endedAt: "2026-07-01T09:00:00Z",
      wasAssociatedWith: "agent_ai_claude",
      used: ["note-anneal"],
    },
    {
      id: "edit_002", type: "wiki_merge",
      startedAt: "2026-07-03T10:00:00Z", endedAt: "2026-07-03T10:00:00Z",
      wasAssociatedWith: "agent_ai_claude",
      used: ["note-oxidation"],
    },
    {
      id: "edit_003", type: "wiki_cross_update",
      startedAt: "2026-07-05T11:00:00Z", endedAt: "2026-07-05T11:00:00Z",
      wasAssociatedWith: "agent_ai_claude",
      used: ["note-followup"],
    },
    {
      id: "edit_004", type: "wiki_regenerate",
      startedAt: "2026-07-08T12:00:00Z", endedAt: "2026-07-08T12:00:00Z",
      wasAssociatedWith: "agent_ai_claude",
      used: ["note-anneal", "note-oxidation", "pdf:paper-2026", "url:https://example.org/ref"],
    },
  ],
  revisions: [
    {
      id: "rev_001", savedAt: "2026-07-01T09:00:00Z",
      summary: summary({ blocksAdded: 5 }),
      contentHash: "aaa1", wasGeneratedBy: "edit_001",
    },
    {
      id: "rev_002", savedAt: "2026-07-03T10:00:00Z",
      summary: summary({ blocksAdded: 2, blocksModified: 3 }),
      contentHash: "bbb2", prevContentHash: "aaa1",
      wasDerivedFrom: "rev_001", wasGeneratedBy: "edit_002",
    },
    {
      id: "rev_003", savedAt: "2026-07-05T11:00:00Z",
      summary: summary({ blocksAdded: 1 }),
      contentHash: "ccc3", prevContentHash: "bbb2",
      wasDerivedFrom: "rev_002", wasGeneratedBy: "edit_003",
    },
    {
      id: "rev_004", savedAt: "2026-07-08T12:00:00Z",
      summary: summary({ blocksAdded: 4, blocksRemoved: 6, blocksModified: 2 }),
      contentHash: "ddd4", prevContentHash: "ccc3",
      wasDerivedFrom: "rev_003", wasGeneratedBy: "edit_004",
    },
  ],
};

const TITLES: Record<string, string> = {
  "note-anneal": "アニール実験メモ 650℃",
  "note-oxidation": "酸化耐性の追試",
  "note-followup": "追加考察: 粒界の影響",
};

const resolveSource = (id: string): ResolvedRevisionSource => {
  if (id.startsWith("pdf:")) return { label: id.slice(4), kind: "pdf" };
  if (id.startsWith("url:")) return { label: id.slice(4), kind: "url" };
  const title = TITLES[id];
  return title
    ? { label: title, kind: "note", openId: id }
    : { label: `${id.slice(0, 8)}…`, kind: "note" };
};

/** Wiki の成長タイムライン（型付き操作 + 取り込み元チップ） */
export const WikiGrowthTimeline: Story = {
  args: {
    provenance: growthProvenance,
    resolveSource,
    onOpenSource: (openId) => alert(`SidePeek open: ${openId}`),
  },
};

/** resolveSource 未指定（生 ID フォールバック表示） */
export const WithoutResolver: Story = {
  args: {
    provenance: growthProvenance,
  },
};

/** 人間編集のみ（従来のノート履歴。ソースチップは出ない） */
export const HumanEditsOnly: Story = {
  args: {
    provenance: {
      agents: [{ id: "agent_human", type: "human", label: "user", author: { name: "Ada", email: "ada@example.org" } }],
      activities: [
        {
          id: "edit_001", type: "human_edit",
          startedAt: "2026-07-10T09:00:00Z", endedAt: "2026-07-10T09:00:00Z",
          wasAssociatedWith: "agent_human",
        },
      ],
      revisions: [
        {
          id: "rev_001", savedAt: "2026-07-10T09:00:00Z",
          summary: summary({ blocksAdded: 3, labelsChanged: ["procedure"] }),
          contentHash: "eee5", wasGeneratedBy: "edit_001",
        },
      ],
    },
  },
};

/** 履歴なし（空状態） */
export const Empty: Story = {
  args: { provenance: null },
};
