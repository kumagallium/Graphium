import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArrowLeft, PanelLeftClose, RefreshCw, Search } from "lucide-react";
import { BrandLockup } from "./brand-lockup";

const meta = {
  title: "Brand/App Brand Lockup",
  component: BrandLockup,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof BrandLockup>;
export default meta;

type Story = StoryObj<typeof meta>;

function HeaderSlice({ children }: { children: ReactNode }) {
  return (
    <aside className="w-64 shrink-0 border border-sidebar-border bg-sidebar-background">
      <div className="border-b border-sidebar-border p-4">
        <div className="mb-3 flex min-h-7 items-center justify-between">
          {children}
          <div className="flex items-center gap-2 text-muted-foreground">
            <button type="button" aria-label="戻る" className="flex shrink-0 items-center justify-center rounded-md p-1">
              <ArrowLeft size={16} />
            </button>
            <button type="button" aria-label="更新"><RefreshCw size={14} /></button>
            <button type="button" aria-label="サイドバーを閉じる"><PanelLeftClose size={14} /></button>
          </div>
        </div>
        <button
          type="button"
          className="mb-1 flex w-full items-center gap-2 rounded-lg border border-sidebar-border px-3 py-1.5 text-sm text-sidebar-foreground/60"
        >
          <Search size={14} className="shrink-0" />
          <span className="flex-1 text-left">検索</span>
          <span className="text-[10px] text-sidebar-foreground/40">⌘K</span>
        </button>
      </div>
    </aside>
  );
}

const comparisons = [
  {
    title: "現在",
    description: "Gが大きめで、文字と色が分かれています。",
    lockup: (
      <div className="flex items-center gap-2">
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" className="h-7 w-7" />
        <img src={`${import.meta.env.BASE_URL}logo-text.png`} alt="Graphium" className="mt-px h-[18px]" />
      </div>
    ),
  },
  {
    title: "調整後",
    description: "Gを少し小さくし、サイドバーと同じ落ち着いた色にそろえます。",
    lockup: <BrandLockup />,
  },
];

export const Comparison: Story = {
  name: "サイドバーヘッダー比較",
  render: () => (
    <section className="bg-background p-6 text-foreground">
      <h2 className="mb-4 text-lg font-semibold">サイドバーヘッダーのバランス</h2>
      <div className="flex flex-wrap items-start gap-6">
        {comparisons.map(({ title, description, lockup }) => (
          <article key={title} className="w-64 shrink-0">
            <h3 className="mb-2 text-sm font-semibold">{title}</h3>
            <HeaderSlice>{lockup}</HeaderSlice>
            <p className="mt-3 text-sm text-muted-foreground">{description}</p>
          </article>
        ))}
      </div>
    </section>
  ),
};

export const InContext: Story = {
  name: "ノート本文と並べて比較",
  render: () => (
    <section className="space-y-6 overflow-x-auto bg-background p-6 text-foreground">
      <div>
        <h2 className="text-lg font-semibold">本文とロゴのバランス</h2>
        <p className="mt-2 text-sm text-muted-foreground">架空のノートを使い、本文との関係を示す単純な見本です。</p>
      </div>
      {comparisons.map(({ title, lockup }) => (
        <article key={title} className="w-[960px]">
          <h3 className="mb-2 text-sm font-semibold">{title}</h3>
          <div className="flex min-h-[320px] border border-sidebar-border">
            <div className="w-64 shrink-0 border-r border-sidebar-border bg-sidebar-background">
              <HeaderSlice>{lockup}</HeaderSlice>
              <nav aria-label={`${title}の見本ナビゲーション`} className="space-y-1 p-3 text-sm text-muted-foreground">
                <div className="rounded-md bg-sidebar-accent px-3 py-2 text-sidebar-foreground">ノート</div>
                <div className="px-3 py-2">ナレッジ</div>
                <div className="px-3 py-2">素材</div>
                <div className="border-t border-sidebar-border pt-2">
                  <div className="px-3 py-2">実験ノート</div>
                  <div className="px-3 py-2">観察メモ</div>
                </div>
              </nav>
            </div>
            <div className="flex-1 bg-background px-12 py-8">
              <h1 className="mb-6 text-2xl font-semibold">実験ノート</h1>
              <h2 className="mb-2 text-xl font-semibold">観察メモ</h2>
              <p className="text-base leading-relaxed">測定結果を整理します。</p>
              <p className="mt-3 text-base leading-relaxed">試料の変化を記録し、次の測定で確認する項目をまとめます。</p>
            </div>
          </div>
        </article>
      ))}
    </section>
  ),
};
