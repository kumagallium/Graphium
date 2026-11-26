// 修正案カードのストーリー
// - ノートへの複数の変更（未決）: 各行の「反映」「やめる」と、下の「すべて反映」
// - 反映済み・やめた・古い が混ざった状態（反映済みがあれば「元に戻す」）
// - スキルへの 1 件の書き換え（「すべて反映」は出ない）
// - 追加と削除

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { LocaleProvider } from "@/i18n";
import type { ChatEditProposal } from "../../../lib/document-types";
import { EditProposalCard, type EditProposalStatus } from "./EditProposalCard";

const NOTE: ChatEditProposal = {
  id: "p1",
  target: { kind: "note", id: "n1", title: "全粒粉 30% の食パン（2 回目）" },
  reason: "温度と時間を表の値にそろえ、こね上げ温度の記録が抜けていたので足します。",
  changes: [
    {
      id: "c1",
      op: "replace",
      before: "一次発酵: 30℃ で 50 分",
      after: "一次発酵: 28℃ で 60 分（表の条件に合わせた）",
      blockId: "x",
    },
    {
      id: "c2",
      op: "insert",
      before: "こね: 低速 3 分 → 中速 8 分",
      after: "こね上げ温度: 26℃",
      blockId: "x",
    },
    {
      id: "c3",
      op: "delete",
      before: "（メモ）あとで温度を確認する",
      blockId: "x",
    },
  ],
};

const SKILL: ChatEditProposal = {
  id: "p2",
  target: { kind: "skill", id: "s1", title: "実験ノートの書き方" },
  reason: "条件を表にまとめる指示を足し、出典の書き方を 1 つにそろえます。",
  changes: [
    {
      id: "c1",
      op: "replace",
      before: "- 条件は本文に書く\n- 出典は文末に書く",
      after: "- 条件（温度・時間・雰囲気）は表にまとめる\n- 出典は [Source: \"題\"] の形で、使った文の直後に書く",
      blockId: "x",
    },
  ],
};

function Interactive({ initial, initialStatuses = {} }: { initial: ChatEditProposal; initialStatuses?: Record<string, EditProposalStatus> }) {
  const [statuses, setStatuses] = useState(initialStatuses);
  const set = (ids: string[], status: EditProposalStatus) =>
    setStatuses((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, status])) }));
  return (
    <EditProposalCard
      proposal={initial}
      statuses={statuses}
      onApply={(ids) => set(ids, "applied")}
      onDecline={(ids) => set(ids, "declined")}
      onUndo={(ids) => set(ids, "pending")}
      onOpenTarget={() => {}}
    />
  );
}

const meta: Meta = {
  title: "Molecules/EditProposalCard",
  decorators: [
    (Story) => (
      <LocaleProvider>
        <div style={{ padding: 24, width: 420, background: "var(--paper)" }}>
          <Story />
        </div>
      </LocaleProvider>
    ),
  ],
};
export default meta;

type Story = StoryObj;

export const NoteChanges: Story = { render: () => <Interactive initial={NOTE} /> };

export const MixedStatus: Story = {
  render: () => (
    <Interactive initial={NOTE} initialStatuses={{ c1: "applied", c2: "stale", c3: "declined" }} />
  ),
};

export const SkillRewrite: Story = { render: () => <Interactive initial={SKILL} /> };
