// ローカルビューの Storybook。データは buildLocalView を通さず、
// LocalViewModel を直接組み立てて渡す（モデルの正しさは
// local-view-model.test.ts の担当）。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocaleProvider } from "../../i18n";
import "../../app.css";
import { LocalGraphView } from "./local-view";
import type { LocalViewModel } from "./local-view-model";

const meta: Meta = {
  title: "Graph/LocalView",
  parameters: { layout: "fullscreen" },
};
meta.decorators = [
  (Story) => (
    <LocaleProvider>
      <div style={{ height: "100vh" }}>
        <Story />
      </div>
    </LocaleProvider>
  ),
];
export default meta;

type Story = StoryObj<typeof LocalGraphView>;

// ストーリーでは NoteOriginPicker の実データ依存を避け、選択中の起点名を
// 表示するだけの静的なボタンで代替する（originPicker は ReactNode を渡せる）
function staticOriginPicker(title: string) {
  return (
    <button
      type="button"
      className="px-2 py-0.5 rounded-md border border-border bg-card text-sm"
      disabled
    >
      {title}
    </button>
  );
}

// ── 直線 3 工程（親あり） ──

const LINEAR_MODEL: LocalViewModel = {
  origin: { noteId: "dough", title: "仕込み" },
  plans: [{ noteId: "plan", title: "春のカンパーニュ試作" }],
  parent: { noteId: "plan", title: "春のカンパーニュ試作", t: "2026-04-01T09:00:00.000Z", row: 0, isOrigin: false },
  siblings: [
    { noteId: "mill", title: "製粉", t: "2026-04-03T09:00:00.000Z", row: 0, isOrigin: false },
    { noteId: "dough", title: "仕込み", t: "2026-04-05T09:00:00.000Z", row: 0, isOrigin: true },
    { noteId: "bake", title: "焼成", t: "2026-04-08T09:00:00.000Z", row: 0, isOrigin: false },
    { noteId: "taste", title: "試食", t: "2026-04-12T09:00:00.000Z", row: 0, isOrigin: false },
  ],
  children: {
    kind: "steps",
    steps: [
      { id: "s1", name: "こねる", col: 0, row: 0 },
      { id: "s2", name: "一次発酵", col: 1, row: 0 },
      { id: "s3", name: "分割", col: 2, row: 0 },
    ],
    edges: [
      { from: "s1", to: "s2" },
      { from: "s2", to: "s3" },
    ],
  },
  handoffs: [
    { from: "mill", to: "dough", broken: false },
    { from: "dough", to: "bake", broken: false },
    { from: "bake", to: "taste", broken: false },
  ],
  truncated: false,
};

export const LinearThreeSteps: Story = {
  name: "直線 3 工程",
  render: () => (
    <LocalGraphView
      model={LINEAR_MODEL}
      depth={1}
      onDepthChange={() => {}}
      onOpenNote={() => {}}
      originPicker={staticOriginPicker(LINEAR_MODEL.origin.title)}
    />
  ),
};

// ── 分岐 + broken ──

const BRANCH_MODEL: LocalViewModel = {
  origin: { noteId: "mill", title: "製粉" },
  plans: [{ noteId: "plan", title: "春のカンパーニュ試作" }],
  parent: { noteId: "plan", title: "春のカンパーニュ試作", t: "2026-04-01T09:00:00.000Z", row: 0, isOrigin: false },
  siblings: [
    { noteId: "mill", title: "製粉", t: "2026-04-03T09:00:00.000Z", row: 0, isOrigin: true },
    { noteId: "doughA", title: "仕込み A（加水 65%）", t: "2026-04-05T09:00:00.000Z", row: 0, isOrigin: false },
    { noteId: "doughB", title: "仕込み B（加水 72%）", t: "2026-04-05T09:00:00.000Z", row: 1, isOrigin: false },
    { noteId: "bake", title: "焼成", t: "2026-04-08T09:00:00.000Z", row: 0, isOrigin: false },
    {
      noteId: "taste",
      title: "試食",
      t: "2026-04-12T09:00:00.000Z",
      row: 0,
      isOrigin: false,
      state: "archived",
    },
  ],
  children: {
    kind: "steps",
    steps: [
      { id: "s1", name: "秤量", col: 0, row: 0 },
      { id: "s2", name: "挽く", col: 1, row: 0 },
      { id: "s3", name: "ふるう", col: 2, row: 0 },
      { id: "s4", name: "粗挽き分け", col: 2, row: 1 },
    ],
    edges: [
      { from: "s1", to: "s2" },
      { from: "s2", to: "s3" },
      { from: "s2", to: "s4" },
    ],
  },
  handoffs: [
    { from: "mill", to: "doughA", broken: false },
    { from: "mill", to: "doughB", broken: false },
    { from: "doughA", to: "bake", broken: false },
    { from: "doughB", to: "bake", broken: false },
    { from: "bake", to: "taste", broken: true },
  ],
  truncated: false,
};

export const BranchWithBroken: Story = {
  name: "分岐 + broken",
  render: () => (
    <LocalGraphView
      model={BRANCH_MODEL}
      depth={1}
      onDepthChange={() => {}}
      onOpenNote={() => {}}
      originPicker={staticOriginPicker(BRANCH_MODEL.origin.title)}
    />
  ),
};

// ── 起点が計画（子 = notes） ──

const PLAN_ORIGIN_MODEL: LocalViewModel = {
  origin: { noteId: "plan", title: "春のカンパーニュ試作" },
  plans: [],
  parent: null,
  siblings: [{ noteId: "plan", title: "春のカンパーニュ試作", t: "2026-04-01T09:00:00.000Z", row: 0, isOrigin: true }],
  children: {
    kind: "notes",
    notes: [
      { noteId: "mill", title: "製粉", t: "2026-04-03T09:00:00.000Z", row: 0, isOrigin: false },
      { noteId: "dough", title: "仕込み", t: "2026-04-05T09:00:00.000Z", row: 0, isOrigin: false },
      { noteId: "bake", title: "焼成", t: "2026-04-08T09:00:00.000Z", row: 0, isOrigin: false, state: "trashed" },
    ],
    stepsByNote: {},
  },
  handoffs: [],
  truncated: false,
};

export const PlanOriginWithNoteChildren: Story = {
  name: "起点が計画（子 = 工程ノート）",
  render: () => (
    <LocalGraphView
      model={PLAN_ORIGIN_MODEL}
      depth={1}
      onDepthChange={() => {}}
      onOpenNote={() => {}}
      originPicker={staticOriginPicker(PLAN_ORIGIN_MODEL.origin.title)}
    />
  ),
};

// ── 計画起点で各工程の手順が 3 段目のレーンに出る ──

const PLAN_ORIGIN_WITH_STEPS_MODEL: LocalViewModel = {
  origin: { noteId: "plan", title: "春のカンパーニュ試作" },
  plans: [],
  parent: null,
  siblings: [{ noteId: "plan", title: "春のカンパーニュ試作", t: "2026-04-01T09:00:00.000Z", row: 0, isOrigin: true }],
  children: {
    kind: "notes",
    notes: [
      { noteId: "mill", title: "製粉", t: "2026-04-03T09:00:00.000Z", row: 0, isOrigin: false },
      { noteId: "dough", title: "仕込み", t: "2026-04-05T09:00:00.000Z", row: 0, isOrigin: false },
    ],
    stepsByNote: {
      mill: {
        steps: [
          { id: "m1", name: "秤量", col: 0, row: 0 },
          { id: "m2", name: "挽く", col: 1, row: 0 },
        ],
        edges: [{ from: "m1", to: "m2" }],
      },
      // 仕込みは手順が無い（未記入）想定。レーンには何も出ない
      dough: { steps: [], edges: [] },
    },
  },
  handoffs: [{ from: "mill", to: "dough", broken: false }],
  truncated: false,
};

export const PlanOriginWithChildSteps: Story = {
  name: "計画起点で各工程の手順が出る",
  render: () => (
    <LocalGraphView
      model={PLAN_ORIGIN_WITH_STEPS_MODEL}
      depth={1}
      onDepthChange={() => {}}
      onOpenNote={() => {}}
      originPicker={staticOriginPicker(PLAN_ORIGIN_WITH_STEPS_MODEL.origin.title)}
    />
  ),
};

// ── 計画なし depth 2 ──

const NO_PLAN_DEPTH2_MODEL: LocalViewModel = {
  origin: { noteId: "note-b", title: "配合検討メモ" },
  plans: [],
  parent: null,
  siblings: [
    { noteId: "note-a", title: "素材の下調べ", t: "2026-05-01T09:00:00.000Z", row: 0, isOrigin: false },
    { noteId: "note-b", title: "配合検討メモ", t: "2026-05-03T09:00:00.000Z", row: 0, isOrigin: true },
    { noteId: "note-c", title: "試作 v2", t: "2026-05-06T09:00:00.000Z", row: 0, isOrigin: false },
  ],
  children: {
    kind: "steps",
    steps: [{ id: "s1", name: "配合を決める", col: 0, row: 0 }],
    edges: [],
  },
  handoffs: [
    { from: "note-a", to: "note-b", broken: false },
    { from: "note-b", to: "note-c", broken: false },
  ],
  truncated: true,
};

export const NoPlanDepth2: Story = {
  name: "計画なし depth 2（truncated）",
  render: () => (
    <LocalGraphView
      model={NO_PLAN_DEPTH2_MODEL}
      depth={2}
      onDepthChange={() => {}}
      onOpenNote={() => {}}
      originPicker={staticOriginPicker(NO_PLAN_DEPTH2_MODEL.origin.title)}
    />
  ),
};

// ── 入れ子の途中（親・同じ層・子 = notes） ──

const NESTED_MODEL: LocalViewModel = {
  origin: { noteId: "sub-plan", title: "焼成条件サブ計画" },
  plans: [
    { noteId: "root-plan", title: "春のカンパーニュ試作" },
    { noteId: "other-plan", title: "夏の食パン試作" },
  ],
  parent: {
    noteId: "root-plan",
    title: "春のカンパーニュ試作",
    t: "2026-04-01T09:00:00.000Z",
    row: 0,
    isOrigin: false,
  },
  siblings: [
    { noteId: "mill", title: "製粉", t: "2026-04-03T09:00:00.000Z", row: 0, isOrigin: false },
    { noteId: "sub-plan", title: "焼成条件サブ計画", t: "2026-04-05T09:00:00.000Z", row: 0, isOrigin: true },
    { noteId: "taste", title: "試食", t: "2026-04-12T09:00:00.000Z", row: 0, isOrigin: false },
  ],
  children: {
    kind: "notes",
    notes: [
      { noteId: "bake-low", title: "低温長時間焼成", t: "2026-04-06T09:00:00.000Z", row: 0, isOrigin: false },
      { noteId: "bake-high", title: "高温短時間焼成", t: "2026-04-06T09:00:00.000Z", row: 1, isOrigin: false },
    ],
    stepsByNote: {},
  },
  handoffs: [
    { from: "mill", to: "sub-plan", broken: false },
    { from: "sub-plan", to: "taste", broken: false },
  ],
  truncated: false,
};

export const NestedMiddle: Story = {
  name: "入れ子の途中（親・同層・子 = 工程ノート）",
  render: () => (
    <LocalGraphView
      model={NESTED_MODEL}
      depth={1}
      onDepthChange={() => {}}
      onOpenNote={() => {}}
      originPicker={staticOriginPicker(NESTED_MODEL.origin.title)}
    />
  ),
};

// ── model null（起点が index に無い / 起点未選択） ──

export const OriginMissing: Story = {
  name: "起点が index に無い（model null）",
  render: () => (
    <LocalGraphView
      model={null}
      depth={1}
      onDepthChange={() => {}}
      onOpenNote={() => {}}
      originPicker={staticOriginPicker("（見つかりません）")}
    />
  ),
};

export const OriginNotSelected: Story = {
  name: "起点が未選択",
  render: () => (
    <LocalGraphView
      model={null}
      depth={1}
      onDepthChange={() => {}}
      onOpenNote={() => {}}
      originPicker={staticOriginPicker("起点のノートを検索…")}
    />
  ),
};

// ── マニュアル用（英語・パン作りの世界観）──
// manual/public/screenshots/timeline-mode_en.png の元。計画起点で 3 段目に各工程の手順が出る

const MANUAL_MODEL: LocalViewModel = {
  origin: { noteId: "plan", title: "Sourdough trial" },
  plans: [],
  parent: null,
  siblings: [{ noteId: "plan", title: "Sourdough trial", t: "2026-04-01T09:00:00.000Z", row: 0, isOrigin: true }],
  children: {
    kind: "notes",
    notes: [
      { noteId: "mill", title: "Milling", t: "2026-04-03T09:00:00.000Z", row: 0, isOrigin: false },
      { noteId: "dough", title: "Kneading", t: "2026-04-05T09:00:00.000Z", row: 0, isOrigin: false },
      { noteId: "bake", title: "Baking", t: "2026-04-08T09:00:00.000Z", row: 0, isOrigin: false },
    ],
    stepsByNote: {
      mill: {
        steps: [
          { id: "m1", name: "Weigh grain", col: 0, row: 0 },
          { id: "m2", name: "Mill", col: 1, row: 0 },
        ],
        edges: [{ from: "m1", to: "m2" }],
      },
      dough: {
        steps: [
          { id: "d1", name: "Mix", col: 0, row: 0 },
          { id: "d2", name: "Bulk ferment", col: 1, row: 0 },
          { id: "d3", name: "Shape", col: 2, row: 0 },
        ],
        edges: [
          { from: "d1", to: "d2" },
          { from: "d2", to: "d3" },
        ],
      },
      bake: {
        steps: [{ id: "b1", name: "Bake", col: 0, row: 0 }],
        edges: [],
      },
    },
  },
  // 受け渡しの線は同じ層（起点と同じレーン）の間だけ引かれる。計画起点では出ない
  handoffs: [],
  truncated: false,
};

export const Manual: Story = {
  name: "Manual (English, bread world)",
  render: () => (
    <LocalGraphView
      model={MANUAL_MODEL}
      depth={1}
      onDepthChange={() => {}}
      onOpenNote={() => {}}
      originPicker={staticOriginPicker(MANUAL_MODEL.origin.title)}
    />
  ),
};
