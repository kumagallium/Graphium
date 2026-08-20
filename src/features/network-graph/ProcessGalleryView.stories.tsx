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

/**
 * プレビューが実物らしく見えるように、工程の並びから素材・生成物と
 * エッジまで作る。i 番目の工程が生成したものを i+1 番目が使う直線を基本にし、
 * branch に指定した工程からは複数の後続へ枝分かれさせる。
 */
function buildGraph(
  noteId: string,
  stepNames: string[],
  opts: { materials?: string[]; tools?: string[]; branchFrom?: number } = {},
) {
  const steps = stepNames.map((n, i) => step(`${noteId}-s${i}`, n));
  const entities: any[] = [];
  const edges: any[] = [];

  // 各工程の生成物と、それを次の工程が受け取る流れ
  stepNames.forEach((name, i) => {
    const isLast = i === stepNames.length - 1;
    if (isLast) return;
    const outId = `${noteId}-out${i}`;
    entities.push({ id: outId, label: `${name}の生成物`, kind: "output", attrs: [] });
    edges.push({ id: `${outId}-g`, kind: "generates", source: `${noteId}-s${i}`, target: outId });

    const consumers =
      opts.branchFrom === i
        ? stepNames.map((_, j) => j).filter((j) => j > i)
        : [i + 1];
    for (const j of consumers) {
      edges.push({ id: `${outId}-u${j}`, kind: "used", source: outId, target: `${noteId}-s${j}` });
    }
  });

  // 最初の工程に入る素材と、そこで使う道具
  (opts.materials ?? []).forEach((label, i) => {
    const id = `${noteId}-mat${i}`;
    entities.push({ id, label, kind: "material", attrs: [] });
    edges.push({ id: `${id}-u`, kind: "used", source: id, target: `${noteId}-s0` });
  });
  (opts.tools ?? []).forEach((label, i) => {
    const id = `${noteId}-tool${i}`;
    entities.push({ id, label, kind: "tool", attrs: [] });
    const target = steps[Math.min(i + 1, steps.length - 1)].id;
    edges.push({ id: `${id}-u`, kind: "used", source: id, target });
  });

  return { steps, entities, edges };
}

const entry = (
  noteId: string,
  title: string,
  stepNames: string[],
  days: number,
  opts: {
    materials?: string[];
    tools?: string[];
    branchFrom?: number;
    forkedFrom?: ProcessIndexEntry["forkedFrom"];
  } = {},
): ProcessIndexEntry => {
  const graph = buildGraph(noteId, stepNames, opts);
  return {
    noteId,
    title,
    sourceModifiedAt: daysAgo(days),
    projectedAt: daysAgo(days),
    graph: graph as ProcessIndexEntry["graph"],
    summary: {
      stepCount: graph.steps.length,
      materialCount: graph.entities.filter((e) => e.kind === "material").length,
      toolCount: graph.entities.filter((e) => e.kind === "tool").length,
      outputCount: graph.entities.filter((e) => e.kind === "output").length,
      branching: opts.branchFrom !== undefined,
    },
    ...(opts.forkedFrom ? { forkedFrom: opts.forkedFrom } : {}),
  };
};

const INDEX: ProcessIndex = {
  version: 1,
  updatedAt: daysAgo(0),
  processes: [
    entry("n1", "Cu粉末の焼結実験（第1回）", ["秤量", "混合", "成形", "焼成", "研磨", "SEM観察"], 1, {
      materials: ["Cu粉末", "バインダー", "エタノール"],
      tools: ["遊星ボールミル", "一軸プレス", "管状炉"],
    }),
    entry("n2", "Bi2Te3 の熱電特性評価", ["合成", "XRD測定", "ゼーベック係数測定", "熱伝導率測定"], 3, {
      materials: ["Bi", "Te"],
      tools: ["XRD", "ZEM-3", "LFA"],
      branchFrom: 0,
    }),
    entry("n3", "第2回焼結実験の計画", ["秤量", "混合", "成形", "焼成"], 6, {
      materials: ["Cu粉末", "バインダー"],
      tools: ["管状炉"],
      forkedFrom: { noteId: "n1", title: "Cu粉末の焼結実験（第1回）", forkedAt: daysAgo(6) },
    }),
    entry("n4", "前駆体の予備検討", ["溶液調製", "乾燥"], 20, { materials: ["硝酸塩", "純水"] }),
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
  <div style={{ height: 620, display: "flex", width: 1180 }}>
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
          2,
          {
            materials: ["原料A", "原料B", "原料C"],
            tools: ["ボールミル", "電気炉", "精密切断機"],
            branchFrom: 6,
          },
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
