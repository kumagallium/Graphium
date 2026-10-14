// ExperimentalBadge Atom — 採用: 文言「試験運用」・neutral（灰色）・11px（2026-10-14 2 回目で決定。1 回目は「実験的」・12px）。以降は不採用案の記録

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Lightbulb } from "lucide-react";
import { ExperimentalBadge } from "./experimental-badge";

const TIP = "試験運用中の機能です。有効性を確かめている段階のため、使い方や結果は今後変わることがあります";

const meta: Meta<typeof ExperimentalBadge> = {
  title: "Atoms/ExperimentalBadge",
  component: ExperimentalBadge,
  parameters: { layout: "padded" },
  argTypes: {
    size: { control: "select", options: ["xs", "sm"] },
    tone: { control: "select", options: ["neutral", "warning", "accent"] },
  },
};
export default meta;

type Story = StoryObj<typeof ExperimentalBadge>;

/** 採用した見た目（試験運用・neutral・11px）。先頭に置く */
export const Default: Story = {
  args: { label: "試験運用", tooltip: TIP, size: "sm", tone: "neutral" },
};

const Row = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="flex items-center gap-4 py-2">
    <span className="w-48 shrink-0 text-xs text-muted-foreground">{title}</span>
    <div className="flex items-center gap-3">{children}</div>
  </div>
);

export const WordingCandidates: Story = {
  name: "不採用案: 文言の候補（1 回目）",
  render: () => (
    <div>
      {["実験的", "試験中", "検証中", "Beta", "Experimental"].map((l) => (
        <Row key={l} title={l}>
          <ExperimentalBadge label={l} tooltip={TIP} size="xs" />
          <ExperimentalBadge label={l} tooltip={TIP} size="sm" />
        </Row>
      ))}
    </div>
  ),
};

export const LookCandidates: Story = {
  name: "不採用案: 見た目の候補（neutral で決定）",
  render: () => (
    <div>
      {(["neutral", "warning", "accent"] as const).map((tone) => (
        <Row key={tone} title={tone}>
          <ExperimentalBadge label="実験的" tooltip={TIP} tone={tone} size="xs" />
          <ExperimentalBadge label="実験的" tooltip={TIP} tone={tone} size="sm" />
        </Row>
      ))}
    </div>
  ),
};

export const Placements: Story = {
  name: "置き場所の見本",
  render: () => (
    <div className="flex max-w-md flex-col gap-6">
      <Row title="設定のトグル行">
        <div className="flex w-72 items-center justify-between rounded-md border border-border px-3 py-2">
          <span className="flex items-center gap-1.5 text-sm">
            世界照合 <ExperimentalBadge label="試験運用" tooltip={TIP} />
          </span>
          <span className="h-4 w-7 rounded-full bg-primary/60" />
        </div>
      </Row>
      <Row title="サイドバーの 1 行">
        <div className="flex w-56 items-center gap-2 rounded-md bg-secondary px-3 py-1.5 text-sm">
          <Lightbulb className="size-4" />
          <span>知見</span>
          <ExperimentalBadge label="試験運用" tooltip={TIP} />
          <span className="ml-auto text-xs text-muted-foreground">7</span>
        </div>
      </Row>
      <Row title="一覧の見出し">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          知見 (7/7) <ExperimentalBadge label="試験運用" tooltip={TIP} />
        </h3>
      </Row>
      <Row title="結果の節の見出し">
        <h4 className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
          世界照合 <ExperimentalBadge label="試験運用" tooltip={TIP} />
        </h4>
      </Row>
      <Row title="ダイアログのタイトル">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          Asterism に書き出す <ExperimentalBadge label="試験運用" tooltip={TIP} size="sm" />
        </h2>
      </Row>
    </div>
  ),
};

// ── 2026-10-14 2 回目の見比べ（利用者: 「実験的」は自然か／もう少し小さく） ──

const SIZES: { name: string; style?: React.CSSProperties }[] = [
  { name: "現状（12px・余白あり）" },
  { name: "小（11px・余白少なめ）", style: { fontSize: 11, padding: "0 6px", lineHeight: "15px" } },
  { name: "最小（10px・余白最小）", style: { fontSize: 10, padding: "0 5px", lineHeight: "13px" } },
];

const InContext = ({ label, style }: { label: string; style?: React.CSSProperties }) => (
  <div className="flex flex-col gap-3">
    <div className="flex w-56 items-center gap-2 rounded-md bg-secondary px-3 py-1.5 text-sm">
      <Lightbulb className="size-4" />
      <span>知見</span>
      <ExperimentalBadge label={label} tooltip={TIP} style={style} />
      <span className="ml-auto text-xs text-muted-foreground">7</span>
    </div>
    <h3 className="flex items-center gap-2 text-sm font-semibold">
      知見 <span className="text-xs font-normal text-muted-foreground">(7/7)</span>
      <ExperimentalBadge label={label} tooltip={TIP} style={style} />
    </h3>
    <div className="flex w-72 items-center justify-between rounded-md border border-border px-3 py-2">
      <span className="flex items-center gap-1.5 text-sm">
        出典照合を使う <ExperimentalBadge label={label} tooltip={TIP} style={style} />
      </span>
      <span className="h-4 w-7 rounded-full bg-primary/60" />
    </div>
  </div>
);

export const CompareWording2: Story = {
  name: "見比べ: 文言（2 回目。試験運用で決定）",
  render: () => (
    <div className="flex flex-wrap gap-10">
      {["実験的", "試験運用", "ベータ"].map((w) => (
        <div key={w} className="flex flex-col gap-2">
          <div className="text-xs text-muted-foreground">「{w}」</div>
          <InContext label={w} style={SIZES[1].style} />
        </div>
      ))}
    </div>
  ),
};

export const CompareSize2: Story = {
  name: "見比べ: 大きさ（2 回目。小 11px で決定）",
  render: () => (
    <div className="flex flex-wrap gap-10">
      {SIZES.map((sz) => (
        <div key={sz.name} className="flex flex-col gap-2">
          <div className="text-xs text-muted-foreground">{sz.name}</div>
          <InContext label="実験的" style={sz.style} />
        </div>
      ))}
    </div>
  ),
};
