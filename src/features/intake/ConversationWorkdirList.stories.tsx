// 作業フォルダを選ぶ一覧のストーリー（選択は useState で動く）

import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { WorkdirSummary } from "@/lib/conversation/render";
import { ConversationStoryFrame } from "./conversation-story-frame";
import { ConversationWorkdirList } from "./ConversationWorkdirList";

const meta: Meta<typeof ConversationWorkdirList> = {
  title: "Features/Intake/Conversation/WorkdirList",
  component: ConversationWorkdirList,
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof ConversationWorkdirList>;

function row(
  name: string,
  sessions: number,
  unattendedSessions: number,
  ownChars: number,
  startedAt: string,
  endedAt: string,
): WorkdirSummary {
  const attended = sessions - unattendedSessions;
  return {
    workdir: `/Users/example/${name}`,
    sessions,
    unattendedSessions,
    candidateSessions: Math.floor(attended / 3),
    ownTurns: attended * 6,
    ownChars,
    startedAt,
    endedAt,
  };
}

const FIVE: WorkdirSummary[] = [
  row("bakery-notes", 12, 0, 18_420, "2026-03-04T09:12:00", "2026-10-21T18:40:00"),
  row("curry-lab", 9, 3, 9_870, "2026-05-11T10:00:00", "2026-09-02T21:05:00"),
  row("sourdough-log", 4, 0, 3_150, "2026-08-19T08:30:00", "2026-08-19T20:15:00"),
  row("spice-ledger", 6, 6, 0, "2026-06-01T12:00:00", "2026-06-30T12:00:00"),
  row("oven-calibration", 3, 0, 1_204, "2026-10-02T07:45:00", "2026-11-12T16:20:00"),
];

const NAMES = [
  "bakery-notes", "curry-lab", "sourdough-log", "spice-ledger", "oven-calibration",
  "rye-trials", "naan-tests", "focaccia-board", "dal-recipes", "starter-diary",
  "proofing-box", "garam-masala", "baguette-scoring", "roux-basics", "flour-sourcing",
  "tandoor-plan", "brioche-batch", "chutney-jars", "crumb-photos", "pantry-inventory",
];

const MANY: WorkdirSummary[] = NAMES.map((name, i) =>
  row(
    name,
    3 + ((i * 7) % 11),
    i % 5 === 3 ? 1 : 0,
    800 + ((i * 1373) % 15_000),
    `2026-0${1 + (i % 9)}-${String(1 + ((i * 3) % 27)).padStart(2, "0")}T09:00:00`,
    `2026-1${i % 2}-${String(2 + ((i * 5) % 25)).padStart(2, "0")}T18:00:00`,
  ),
);

/** 状態を持つ入れ物。最初に選んでおく workdir を渡す */
function Stateful({ items, initial }: { items: WorkdirSummary[]; initial: string[] }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(initial));
  const selectable = items.filter((i) => i.sessions - i.unattendedSessions > 0).map((i) => i.workdir);
  return (
    <ConversationStoryFrame>
      <ConversationWorkdirList
        status="ready"
        items={items}
        selected={selected}
        onToggle={(w) =>
          setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(w)) next.delete(w);
            else next.add(w);
            return next;
          })
        }
        onToggleAll={(next) => setSelected(new Set(next ? selectable : []))}
      />
    </ConversationStoryFrame>
  );
}

const noop = () => {};

export const Default: Story = {
  render: () => <Stateful items={FIVE} initial={[FIVE[0].workdir, FIVE[1].workdir]} />,
};

export const NothingSelected: Story = {
  render: () => <Stateful items={FIVE} initial={[]} />,
};

export const Empty: Story = {
  render: () => (
    <ConversationStoryFrame>
      <ConversationWorkdirList status="ready" items={[]} selected={new Set()} onToggle={noop} onToggleAll={noop} />
    </ConversationStoryFrame>
  ),
};

export const Loading: Story = {
  render: () => (
    <ConversationStoryFrame>
      <ConversationWorkdirList status="loading" items={[]} selected={new Set()} onToggle={noop} onToggleAll={noop} />
    </ConversationStoryFrame>
  ),
};

export const Many: Story = {
  render: () => <Stateful items={MANY} initial={MANY.map((m) => m.workdir)} />,
};
