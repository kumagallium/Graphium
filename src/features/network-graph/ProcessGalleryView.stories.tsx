// プロセス一覧のストーリー。
//
// 見るべきところ:
//   - 行から「どんな流れの実験か」が名前より先に伝わるか
//   - 素材一覧の隣に置いても、編集できない棚だと分かるか
//   - 枝分かれの印が、一本道のノートに紛れず目に入るか

import type { Meta, StoryObj } from "@storybook/react-vite";
import { ProcessGalleryView } from "./ProcessGalleryView";
import type { ProcessIndex, ProcessIndexEntry } from "./process-index";
import "../../app.css";

const daysAgo = (d: number) => new Date(Date.now() - d * 86400_000).toISOString();

const step = (id: string, name: string) => ({ id, name, params: [] });

const entry = (
  noteId: string,
  title: string,
  stepNames: string[],
  summary: Partial<ProcessIndexEntry["summary"]>,
  days: number,
  forkedFrom?: ProcessIndexEntry["forkedFrom"],
): ProcessIndexEntry => ({
  noteId,
  title,
  sourceModifiedAt: daysAgo(days),
  projectedAt: daysAgo(days),
  graph: { steps: stepNames.map((n, i) => step(`${noteId}-s${i}`, n)), entities: [], edges: [] },
  summary: {
    stepCount: stepNames.length,
    materialCount: 0,
    toolCount: 0,
    outputCount: 0,
    branching: false,
    ...summary,
  },
  ...(forkedFrom ? { forkedFrom } : {}),
});

const INDEX: ProcessIndex = {
  version: 1,
  updatedAt: daysAgo(0),
  processes: [
    entry(
      "n1",
      "Cu粉末の焼結実験（第1回）",
      ["秤量", "混合", "成形", "焼成", "研磨", "SEM観察"],
      { materialCount: 4, toolCount: 3, outputCount: 2 },
      1,
    ),
    entry(
      "n2",
      "Bi2Te3 の熱電特性評価",
      ["合成", "XRD測定", "ゼーベック係数測定", "熱伝導率測定"],
      { materialCount: 2, toolCount: 4, outputCount: 3, branching: true },
      3,
    ),
    entry(
      "n3",
      "第2回焼結実験の計画",
      ["秤量", "混合", "成形", "焼成"],
      { materialCount: 4, toolCount: 2, outputCount: 1 },
      6,
      { noteId: "n1", title: "Cu粉末の焼結実験（第1回）", forkedAt: daysAgo(6) },
    ),
    entry("n4", "前駆体の予備検討", ["溶液調製", "乾燥"], { materialCount: 3, outputCount: 1 }, 20),
  ],
};

const meta = {
  title: "Process/ProcessGalleryView",
  component: ProcessGalleryView,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ProcessGalleryView>;

export default meta;
type Story = StoryObj<typeof meta>;

const Frame = (args: React.ComponentProps<typeof ProcessGalleryView>) => (
  <div style={{ height: 560, display: "flex", width: 720 }}>
    <ProcessGalleryView {...args} />
  </div>
);

export const Default: Story = {
  args: { processIndex: INDEX, onBack: () => {}, onNavigateNote: () => {} },
  render: Frame,
};

/** フォーク元を持つ行の見え方（複製したプロセスは別物だが、線は残る） */
export const WithFork: Story = {
  args: {
    processIndex: { ...INDEX, processes: [INDEX.processes[2], INDEX.processes[0]] },
    onBack: () => {},
    onNavigateNote: () => {},
  },
  render: Frame,
};

/** 工程が多いノート（+N の省略が効いているか） */
export const LongProcess: Story = {
  args: {
    processIndex: {
      ...INDEX,
      processes: [
        entry(
          "n9",
          "多段階合成の全工程",
          ["秤量", "予備混合", "仮焼", "粉砕", "本混合", "成形", "焼成", "アニール", "切断", "研磨"],
          { materialCount: 7, toolCount: 5, outputCount: 4, branching: true },
          2,
        ),
      ],
    },
    onBack: () => {},
    onNavigateNote: () => {},
  },
  render: Frame,
};

/** まだ手順を書いたノートが無い状態 */
export const Empty: Story = {
  args: {
    processIndex: { version: 1, updatedAt: daysAgo(0), processes: [] },
    onBack: () => {},
    onNavigateNote: () => {},
  },
  render: Frame,
};

/** インデックスがまだ作られていない（初回・再投影前） */
export const NotIndexedYet: Story = {
  args: { processIndex: null, onBack: () => {}, onNavigateNote: () => {} },
  render: Frame,
};
