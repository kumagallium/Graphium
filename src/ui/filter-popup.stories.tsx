// FilterPopup Molecule — 列ヘッダから開く複数選択フィルタのカタログ
// 議論用途：トリガー（funnel icon）配置・選択挙動・検索閾値の合意取り。

import { useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Filter } from "lucide-react";
import { FilterPopup, type FilterOption } from "./filter-popup";
import { cn } from "@/lib/utils";

const meta: Meta<typeof FilterPopup> = {
  title: "Molecules/FilterPopup",
  component: FilterPopup,
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof FilterPopup>;

// 列ヘッダに置く funnel アイコン（FilterPopup のトリガー想定）
function ColumnHeaderWithFilter({
  label,
  selectedCount,
  onClick,
}: {
  label: string;
  selectedCount: number;
  onClick: (rect: DOMRect) => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const active = selectedCount > 0;
  return (
    <div className="inline-flex items-center gap-1 text-xs font-semibold text-secondary-foreground bg-secondary px-3 py-2 rounded">
      <span>{label}</span>
      <button
        ref={btnRef}
        type="button"
        onClick={() => {
          if (btnRef.current) onClick(btnRef.current.getBoundingClientRect());
        }}
        className={cn(
          "inline-flex items-center justify-center w-5 h-5 rounded transition-colors",
          active
            ? "text-primary bg-primary/10 hover:bg-primary/15"
            : "text-text-tertiary hover:text-foreground hover:bg-muted",
        )}
        aria-label={`Filter ${label}`}
        title={`Filter ${label}`}
      >
        <Filter size={12} strokeWidth={2.25} />
      </button>
      {active && (
        <span className="text-[10px] tabular-nums text-primary">
          ({selectedCount})
        </span>
      )}
    </div>
  );
}

// ---- Type 列（Atom + Synthesis の混在）— 最初の実装ターゲット
const TYPE_OPTIONS: FilterOption[] = [
  { value: "atom.causal", label: "Atom · Causal", count: 8 },
  { value: "atom.correlational", label: "Atom · Correlational", count: 4 },
  { value: "atom.mechanistic", label: "Atom · Mechanistic", count: 3 },
  { value: "atom.conditional", label: "Atom · Conditional", count: 2 },
  { value: "atom.observational", label: "Atom · Observational", count: 6 },
  { value: "synth.deductive", label: "Synthesis · Deductive", count: 5 },
  { value: "synth.abductive", label: "Synthesis · Abductive", count: 3 },
  { value: "synth.analogical", label: "Synthesis · Analogical", count: 2 },
  { value: "synth.dialectic", label: "Synthesis · Dialectic", count: 1 },
];

export const TypeColumn: Story = {
  name: "Wiki: Type 列（最初の統合ターゲット）",
  render: () => {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ top: 0, left: 0 });
    const [selected, setSelected] = useState<string[]>([]);

    return (
      <div className="p-6 bg-background">
        <p className="text-xs text-muted-foreground mb-3">
          列ヘッダの funnel アイコンをクリックすると FilterPopup を開く。
          選択が空 = フィルタ未適用（全件表示）。
        </p>
        <ColumnHeaderWithFilter
          label="Type"
          selectedCount={selected.length}
          onClick={(rect) => {
            setPos({ top: rect.bottom + 4, left: rect.left });
            setOpen(true);
          }}
        />
        {open && (
          <FilterPopup
            position={pos}
            onClose={() => setOpen(false)}
            title="Filter by type"
            options={TYPE_OPTIONS}
            selected={selected}
            onChange={setSelected}
            searchPlaceholder="Search type…"
            clearLabel="Clear"
            minWidth={260}
          />
        )}
        <div className="mt-4 text-xs text-muted-foreground">
          選択中: {selected.length === 0 ? "（なし）" : selected.join(", ")}
        </div>
      </div>
    );
  },
};

// ---- ラベル列（Note）— icon prop の利用例
const LABEL_OPTIONS: FilterOption[] = [
  { value: "procedure", label: "Procedure", icon: <Dot color="#5b8fb9" /> },
  { value: "material", label: "Material", icon: <Dot color="#4B7A52" /> },
  { value: "tool", label: "Tool", icon: <Dot color="#c08b3e" /> },
  { value: "attribute", label: "Attribute", icon: <Dot color="#8fa394" /> },
  { value: "sample", label: "Sample", icon: <Dot color="#8b7ab5" /> },
  { value: "output", label: "Output", icon: <Dot color="#c26356" /> },
  { value: "plan", label: "Plan", icon: <Dot color="#6b7f6e" /> },
];

function Dot({ color }: { color: string }) {
  return (
    <span
      className="block w-2.5 h-2.5 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

export const LabelColumn: Story = {
  name: "Note: ラベル列（icon prop 活用）",
  render: () => {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ top: 0, left: 0 });
    const [selected, setSelected] = useState<string[]>(["procedure"]);

    return (
      <div className="p-6 bg-background">
        <ColumnHeaderWithFilter
          label="Labels"
          selectedCount={selected.length}
          onClick={(rect) => {
            setPos({ top: rect.bottom + 4, left: rect.left });
            setOpen(true);
          }}
        />
        {open && (
          <FilterPopup
            position={pos}
            onClose={() => setOpen(false)}
            title="Filter by label"
            options={LABEL_OPTIONS}
            selected={selected}
            onChange={setSelected}
          />
        )}
      </div>
    );
  },
};

// ---- 検索ボックスが自動表示される長いリスト（≥ 8 件で自動有効）
const MODEL_OPTIONS: FilterOption[] = [
  { value: "gpt-oss-120b", label: "gpt-oss-120b", count: 14 },
  { value: "claude-opus-4-7", label: "Claude Opus 4.7", count: 8 },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", count: 5 },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5", count: 2 },
  { value: "gpt-5", label: "GPT-5", count: 3 },
  { value: "gpt-4o", label: "GPT-4o", count: 11 },
  { value: "gemini-2-5-pro", label: "Gemini 2.5 Pro", count: 4 },
  { value: "gemini-2-5-flash", label: "Gemini 2.5 Flash", count: 6 },
  { value: "llama-3-3-70b", label: "Llama 3.3 70B", count: 1 },
];

export const SearchableLongList: Story = {
  name: "長いリスト（検索ボックス自動表示）",
  render: () => {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ top: 0, left: 0 });
    const [selected, setSelected] = useState<string[]>([]);

    return (
      <div className="p-6 bg-background">
        <ColumnHeaderWithFilter
          label="Model"
          selectedCount={selected.length}
          onClick={(rect) => {
            setPos({ top: rect.bottom + 4, left: rect.left });
            setOpen(true);
          }}
        />
        {open && (
          <FilterPopup
            position={pos}
            onClose={() => setOpen(false)}
            title="Filter by model"
            options={MODEL_OPTIONS}
            selected={selected}
            onChange={setSelected}
            searchPlaceholder="Search model…"
            minWidth={260}
          />
        )}
      </div>
    );
  },
};

// ---- 空 options 状態（asset gallery で usedIn が全て 0 など）
export const EmptyOptions: Story = {
  name: "選択肢ゼロ",
  render: () => {
    const [open, setOpen] = useState(true);
    return (
      <div className="p-6 bg-background">
        <p className="text-xs text-muted-foreground mb-3">
          選択肢ゼロ時はテキストで案内（押せる項目を出さない）。
        </p>
        {open && (
          <FilterPopup
            position={{ top: 60, left: 24 }}
            onClose={() => setOpen(false)}
            title="Filter"
            options={[]}
            selected={[]}
            onChange={() => {}}
            emptyText="No values to filter"
          />
        )}
      </div>
    );
  },
};
