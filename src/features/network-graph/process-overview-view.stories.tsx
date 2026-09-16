// 全体ビュー（ProcessOverviewView）のストーリー。
//
// 見るべきところ:
//   - Proposal（note-chain.proposal.stories.tsx の 4 番）と同じ見た目・配色になっているか
//   - 分岐・合流のあるステップ名グラフが ELK layered（左→右）で自然に並ぶか
//   - dropped の注記・空状態が文言どおりに出るか

import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocaleProvider } from "../../i18n";
import { ProcessOverviewView } from "./process-overview-view";
import type { ProcessIndex, ProcessIndexEntry } from "./process-index";
import type { FlowStep } from "./activity-graph-adapter";
import type { BlockLink } from "../../lib/block-link-types";
import "../../app.css";

const summary = { stepCount: 0, materialCount: 0, toolCount: 0, outputCount: 0, branching: false };

const flowStep = (id: string, name: string): FlowStep => ({ id, name, params: [] });

const link = (overrides: Partial<BlockLink> & Pick<BlockLink, "id" | "sourceBlockId" | "targetBlockId">): BlockLink => ({
  type: "informed_by",
  layer: "prov",
  createdBy: "human",
  ...overrides,
});

const entry = (overrides: Partial<ProcessIndexEntry> & Pick<ProcessIndexEntry, "noteId">): ProcessIndexEntry => ({
  title: overrides.noteId,
  sourceModifiedAt: new Date().toISOString(),
  projectedAt: new Date().toISOString(),
  graph: { steps: [], entities: [], edges: [] },
  summary,
  ...overrides,
});

const buildIndex = (processes: ProcessIndexEntry[]): ProcessIndex => ({
  version: 1,
  updatedAt: new Date().toISOString(),
  processes,
});

// 直線 4 工程: 製粉 → こねる → 焼成 → 試食
const linearIndex = buildIndex([
  entry({ noteId: "n-mill-1", graph: { steps: [flowStep("s1", "製粉")], entities: [], edges: [] } }),
  entry({ noteId: "n-mill-2", graph: { steps: [flowStep("s1", "製粉")], entities: [], edges: [] } }),
  entry({
    noteId: "n-knead-1",
    graph: { steps: [flowStep("s2", "こねる")], entities: [], edges: [] },
    crossNoteLinks: [link({ id: "l1", sourceBlockId: "s2", targetBlockId: "s1", targetNoteId: "n-mill-1" })],
  }),
  entry({
    noteId: "n-bake-1",
    graph: { steps: [flowStep("s3", "焼成")], entities: [], edges: [] },
    crossNoteLinks: [link({ id: "l2", sourceBlockId: "s3", targetBlockId: "s2", targetNoteId: "n-knead-1" })],
  }),
  entry({
    noteId: "n-taste-1",
    graph: { steps: [flowStep("s4", "試食")], entities: [], edges: [] },
    crossNoteLinks: [link({ id: "l3", sourceBlockId: "s4", targetBlockId: "s3", targetNoteId: "n-bake-1" })],
  }),
]);

// 分岐と合流: 製粉 → { こねる, 一次発酵 } → こねる → 焼成 → { 試食, 断面観察 } → 試食
const branchMergeIndex = buildIndex([
  entry({ noteId: "n-mill", graph: { steps: [flowStep("s1", "製粉")], entities: [], edges: [] } }),
  entry({
    noteId: "n-ferment",
    graph: { steps: [flowStep("s2", "一次発酵")], entities: [], edges: [] },
    crossNoteLinks: [link({ id: "l1", sourceBlockId: "s2", targetBlockId: "s1", targetNoteId: "n-mill" })],
  }),
  entry({
    noteId: "n-knead",
    graph: { steps: [flowStep("s3", "こねる")], entities: [], edges: [] },
    crossNoteLinks: [
      link({ id: "l2", sourceBlockId: "s3", targetBlockId: "s1", targetNoteId: "n-mill" }),
      link({ id: "l3", sourceBlockId: "s3", targetBlockId: "s2", targetNoteId: "n-ferment" }),
    ],
  }),
  entry({
    noteId: "n-bake",
    graph: { steps: [flowStep("s4", "焼成")], entities: [], edges: [] },
    crossNoteLinks: [link({ id: "l4", sourceBlockId: "s4", targetBlockId: "s3", targetNoteId: "n-knead" })],
  }),
  entry({
    noteId: "n-cut",
    graph: { steps: [flowStep("s5", "断面観察")], entities: [], edges: [] },
    crossNoteLinks: [link({ id: "l5", sourceBlockId: "s5", targetBlockId: "s4", targetNoteId: "n-bake" })],
  }),
  entry({
    noteId: "n-taste",
    graph: { steps: [flowStep("s6", "試食")], entities: [], edges: [] },
    crossNoteLinks: [
      link({ id: "l6", sourceBlockId: "s6", targetBlockId: "s4", targetNoteId: "n-bake" }),
      link({ id: "l7", sourceBlockId: "s6", targetBlockId: "s5", targetNoteId: "n-cut" }),
    ],
  }),
]);

// 切れた参照（供給ノートが index に無い= 削除済み）を含む
const droppedIndex = buildIndex([
  entry({
    noteId: "n-knead",
    graph: { steps: [flowStep("s2", "こねる")], entities: [], edges: [] },
    crossNoteLinks: [
      link({ id: "l1", sourceBlockId: "s2", targetBlockId: "s1", targetNoteId: "n-mill-deleted" }),
    ],
  }),
  entry({
    noteId: "n-bake",
    graph: { steps: [flowStep("s3", "焼成")], entities: [], edges: [] },
    crossNoteLinks: [link({ id: "l2", sourceBlockId: "s3", targetBlockId: "s2", targetNoteId: "n-knead" })],
  }),
]);

const emptyIndex = buildIndex([]);

const meta: Meta<typeof ProcessOverviewView> = {
  title: "Process/ProcessOverview",
  component: ProcessOverviewView,
  decorators: [
    (Story) => (
      <LocaleProvider>
        <div style={{ maxWidth: 820 }}>
          <Story />
        </div>
      </LocaleProvider>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof ProcessOverviewView>;

export const Linear: Story = {
  name: "直線 4 工程",
  args: { processIndex: linearIndex },
};

export const BranchAndMerge: Story = {
  name: "分岐と合流",
  args: { processIndex: branchMergeIndex },
};

export const DroppedReferences: Story = {
  name: "切れた参照あり",
  args: { processIndex: droppedIndex },
};

export const Empty: Story = {
  name: "空",
  args: { processIndex: emptyIndex },
};

// ── マニュアル用（英語・パン作りの世界観）──
// manual/public/screenshots/operation-overview_en.png の元。分岐と合流

const manualIndex = buildIndex([
  entry({ noteId: "n-mill", graph: { steps: [flowStep("s1", "Milling")], entities: [], edges: [] } }),
  entry({ noteId: "n-mill-2", graph: { steps: [flowStep("s1", "Milling")], entities: [], edges: [] } }),
  entry({ noteId: "n-levain", graph: { steps: [flowStep("s2", "Levain build")], entities: [], edges: [] } }),
  entry({
    noteId: "n-knead",
    graph: { steps: [flowStep("s3", "Kneading")], entities: [], edges: [] },
    crossNoteLinks: [
      link({ id: "l1", sourceBlockId: "s3", targetBlockId: "s1", targetNoteId: "n-mill" }),
      link({ id: "l2", sourceBlockId: "s3", targetBlockId: "s2", targetNoteId: "n-levain" }),
    ],
  }),
  entry({
    noteId: "n-knead-2",
    graph: { steps: [flowStep("s3", "Kneading")], entities: [], edges: [] },
    crossNoteLinks: [link({ id: "l3", sourceBlockId: "s3", targetBlockId: "s1", targetNoteId: "n-mill-2" })],
  }),
  entry({
    noteId: "n-bake",
    graph: { steps: [flowStep("s4", "Baking")], entities: [], edges: [] },
    crossNoteLinks: [link({ id: "l4", sourceBlockId: "s4", targetBlockId: "s3", targetNoteId: "n-knead" })],
  }),
  entry({
    noteId: "n-crumb",
    graph: { steps: [flowStep("s5", "Crumb check")], entities: [], edges: [] },
    crossNoteLinks: [link({ id: "l5", sourceBlockId: "s5", targetBlockId: "s4", targetNoteId: "n-bake" })],
  }),
  entry({
    noteId: "n-taste",
    graph: { steps: [flowStep("s6", "Tasting")], entities: [], edges: [] },
    crossNoteLinks: [link({ id: "l6", sourceBlockId: "s6", targetBlockId: "s4", targetNoteId: "n-bake" })],
  }),
]);

export const Manual: Story = {
  name: "Manual (English, bread world)",
  args: { processIndex: manualIndex },
};
