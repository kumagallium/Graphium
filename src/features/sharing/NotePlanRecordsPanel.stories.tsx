// NotePlanRecordsPanel — 計画ノートの「行の記録」（ヘッダのバッジ・右パネル）
//
// 先生が計画を共有し、学生がそれを複製して行から記録を作り、区切りごとに共有する。
// 共有された記録には「どの計画のどの行か」が添えてあるので、計画を開いた人は、
// 行ごとに誰がいつ記録を出したかを右パネルで眺められる。
//
// 共有ライブラリは Tauri 越しなので、Storybook では封筒を props（DI）で渡す。
// 題材はマニュアルと同じパン作り。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocaleProvider, syncLocale } from "../../i18n";
import type { SharedEntry } from "../../lib/storage/shared";
import { NotePlanRecordsBadge, NotePlanRecordsPanel, type PlanRecordsRow } from "./NotePlanRecordsPanel";
import type { SharedSeenStore } from "./shared-seen";
import "../../app.css";

const PLAN_ID = "plan-shared-1";
const TEACHER = { name: "山田 先生", email: "yamada@example.ac.jp" };
const SATO = { name: "佐藤 花", email: "sato@example.ac.jp" };
const TANAKA = { name: "田中 蓮", email: "tanaka@example.ac.jp" };

const ROWS: PlanRecordsRow[] = [
  { tableBlockId: "tbl-1", rowId: "row_mix", name: "@計量とこね", tableCaption: "生地", tableIndex: 0 },
  { tableBlockId: "tbl-1", rowId: "row_ferment", name: "一次発酵", tableCaption: "生地", tableIndex: 0 },
  { tableBlockId: "tbl-1", rowId: "row_shape", name: "成形", tableCaption: "生地", tableIndex: 0 },
  { tableBlockId: "tbl-1", rowId: "row_proof", name: "二次発酵", tableCaption: "生地", tableIndex: 0 },
  { tableBlockId: "tbl-1", rowId: "row_bake", name: "焼成", tableCaption: "生地", tableIndex: 0 },
];

function record(
  id: string,
  author: { name: string; email: string },
  rowId: string,
  rowName: string,
  updatedAt: string,
  title = rowName,
  /** 共有した時点のチェックの件数 [印の数, 全体]。チェックリストの無い記録は渡さない */
  checks?: [number, number],
): SharedEntry {
  const bodyHash = `sha256:${id}-body`;
  return {
    id,
    type: "note",
    author,
    created_at: updatedAt,
    updated_at: updatedAt,
    hash: `sha256:${id}-v1`,
    prov: { derived_from: [] },
    extra: {
      title,
      planRow: { planIds: [PLAN_ID], tableBlockId: "tbl-1", rowId, rowName },
      bodyHash,
      ...(checks ? { checklist: { checked: checks[0], total: checks[1], bodyHash } } : {}),
    },
  } as SharedEntry;
}

const ENTRIES: SharedEntry[] = [
  // 佐藤さんの記録にはチェックリストがある（共有した時点の件数が出る）。田中さん・先生の記録には無い
  record("rec-1", SATO, "row_mix", "計量とこね", "2026-11-18T09:00:00Z", "計量とこね", [5, 5]),
  record("rec-2", TANAKA, "row_mix", "計量とこね", "2026-11-20T09:00:00Z", "計量とこね（全粒粉 30%）"),
  record("rec-3", SATO, "row_ferment", "一次発酵", "2026-11-21T09:00:00Z", "一次発酵", [3, 5]),
  record("rec-4", TEACHER, "row_bake", "焼成", "2026-11-12T09:00:00Z"),
];

// 佐藤さんの「計量とこね」は前に開いた版のまま、「一次発酵」は開いたあとに更新された
const SEEN: SharedSeenStore = {
  "rec-1": { hash: "sha256:rec-1-v1", comments: 0, at: "2026-11-19T00:00:00Z" },
  "rec-3": { hash: "sha256:rec-3-v0", comments: 0, at: "2026-11-19T00:00:00Z" },
};

const meta: Meta<typeof NotePlanRecordsPanel> = {
  title: "Sharing/NotePlanRecordsPanel",
  component: NotePlanRecordsPanel,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "共有した計画（またはその複製）を開いたとき、右パネルに出る行ごとの一覧。保存するものは増やさず、計画の表の行と、共有フォルダの記録の封筒（extra.planRow）を読み合わせる。出すのは「記録がある／まだ無い」と、誰がいつ出したかだけで、期限・担当・進み具合のような状態は持たない。",
      },
    },
  },
  args: {
    planIds: [PLAN_ID],
    rows: ROWS,
    entries: ENTRIES,
    seen: SEEN,
    selfEmail: TEACHER.email,
    onOpenEntry: (id: string) => console.log("[storybook] open shared entry", id),
  },
  decorators: [
    (Story, context) => {
      syncLocale("ja");
      return (
        <LocaleProvider>
          <div
            style={{
              fontFamily: "'Inter', system-ui, sans-serif",
              width: 340,
              // マニュアル用の 1 枚だけ、中身の高さに合わせる（下の余白を撮らない）
              height: (context.parameters.frameHeight as number | undefined) ?? 560,
              border: "1px solid var(--color-border)",
              borderRadius: 12,
              overflow: "hidden",
              background: "var(--color-muted, #f6f8f6)",
            }}
          >
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
};
export default meta;
type Story = StoryObj<typeof NotePlanRecordsPanel>;

export const TeacherView: Story = {
  name: "先生が計画を開いたとき（5 行のうち 3 行に記録）",
};

export const WithUnmatched: Story = {
  name: "計画の表に無い行の記録がある（複製に足した行・消した行）",
  args: {
    entries: [...ENTRIES, record("rec-9", TANAKA, "row_added", "冷却と保存", "2026-11-22T09:00:00Z")],
  },
};

export const TwoTables: Story = {
  name: "表が 2 つある計画（表ごとに見出し）",
  args: {
    rows: [
      ...ROWS.slice(0, 2),
      { tableBlockId: "tbl-2", rowId: "row_taste", name: "試食", tableCaption: "", tableIndex: 1 },
      { tableBlockId: "tbl-2", rowId: "row_crumb", name: "断面の観察", tableCaption: "", tableIndex: 1 },
    ],
    entries: [
      ...ENTRIES.slice(0, 3),
      {
        ...record("rec-7", TANAKA, "row_taste", "試食", "2026-11-23T09:00:00Z"),
        extra: { title: "試食", planRow: { planIds: [PLAN_ID], tableBlockId: "tbl-2", rowId: "row_taste", rowName: "試食" } },
      } as SharedEntry,
    ],
  },
};

export const StudentView: Story = {
  name: "学生が複製した計画を開いたとき（自分の記録には印が付かない）",
  args: { selfEmail: SATO.email, seen: {} },
};

export const HeaderBadge: StoryObj<typeof NotePlanRecordsBadge> = {
  name: "ヘッダのバッジ（記録が 1 件も無いうちは出ない）",
  render: () => (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, background: "var(--color-background, #fff)", height: "100%" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "#6b7280", width: 120 }}>見ていない記録あり</span>
        <NotePlanRecordsBadge planIds={[PLAN_ID]} entries={ENTRIES} selfEmail={TEACHER.email} />
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "#6b7280", width: 120 }}>自分の記録だけ</span>
        <NotePlanRecordsBadge planIds={[PLAN_ID]} entries={[ENTRIES[3]]} selfEmail={TEACHER.email} />
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "#6b7280", width: 120 }}>記録なし（出ない）</span>
        <NotePlanRecordsBadge planIds={[PLAN_ID]} entries={[]} selfEmail={TEACHER.email} />
      </div>
    </div>
  ),
};

// ── マニュアル用（英語 UI・パン作りの世界観）──
// scripts/manual-screenshots-shared.mjs が plan-row-records.png として撮る

const EN_TEACHER = { name: "Dr. Yamada", email: "yamada@example.ac.jp" };
const EN_MAYA = { name: "Maya Sato", email: "maya@example.ac.jp" };
const EN_LEO = { name: "Leo Tanaka", email: "leo@example.ac.jp" };

const EN_ROWS: PlanRecordsRow[] = [
  { tableBlockId: "tbl-1", rowId: "row_mix", name: "@Mix and knead", tableIndex: 0 },
  { tableBlockId: "tbl-1", rowId: "row_bulk", name: "Bulk ferment", tableIndex: 0 },
  { tableBlockId: "tbl-1", rowId: "row_shape", name: "Shape", tableIndex: 0 },
  { tableBlockId: "tbl-1", rowId: "row_proof", name: "Final proof", tableIndex: 0 },
  { tableBlockId: "tbl-1", rowId: "row_bake", name: "Bake", tableIndex: 0 },
];

const EN_ENTRIES: SharedEntry[] = [
  record("en-1", EN_MAYA, "row_mix", "Mix and knead", "2026-11-18T09:00:00Z", "Mix and knead", [5, 5]),
  record("en-2", EN_LEO, "row_mix", "Mix and knead", "2026-11-20T09:00:00Z", "Mix and knead (30% whole wheat)"),
  record("en-3", EN_MAYA, "row_bulk", "Bulk ferment", "2026-11-21T09:00:00Z", "Bulk ferment", [3, 5]),
  record("en-4", EN_TEACHER, "row_bake", "Bake", "2026-11-12T09:00:00Z"),
];

const EN_SEEN: SharedSeenStore = {
  "en-1": { hash: "sha256:en-1-v1", comments: 0, at: "2026-11-19T00:00:00Z" },
  "en-3": { hash: "sha256:en-3-v0", comments: 0, at: "2026-11-19T00:00:00Z" },
};

export const ManualEnglish: Story = {
  name: "Manual (English, bread world)",
  parameters: { frameHeight: 462 },
  args: {
    rows: EN_ROWS,
    entries: EN_ENTRIES,
    seen: EN_SEEN,
    selfEmail: EN_TEACHER.email,
  },
  decorators: [
    (Story) => {
      syncLocale("en");
      return (
        <LocaleProvider>
          <Story />
        </LocaleProvider>
      );
    },
  ],
};
