// 設定画面の「線の多さ」を減らす見せ方を見比べるストーリー（デザイン合意用）。
//
// まとまりの区切り（border-t）と、カードの枠（border）が重なって、画面が線だらけに見えていた。
// 線で区切る代わりに、面（背景色）と余白で区切る案を並べる。中身はどれも同じ。
// 2026-11-04 に A（見出しの帯＋カードは面）で合意し、SettingsGroup.tsx の定数で全体に当てた。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChevronDown, Plug, Search } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

type Look = {
  /** まとまり全体の包み */
  block: string;
  /** まとまりの見出し */
  title: string;
  /** まとまりの中身 */
  body: string;
  /** 中のカード（入れ子 1 段目） */
  card: string;
  /** カードの中のカード（入れ子 2 段目） */
  innerCard: string;
  /** 見出しに当てる追加の style（Storybook で未生成のクラスを避ける用） */
  titleStyle?: CSSProperties;
};

function Select({ value }: { value: string }) {
  return (
    <div className="relative">
      <div className="w-full rounded-md border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground">{value}</div>
      <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

function Item({ title, summary, children }: { title: string; summary: string; children?: ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-foreground">{title}</h4>
      <p className="text-xs text-muted-foreground mt-1 pl-4">{summary}</p>
      {children && <div className="mt-2 pl-4">{children}</div>}
    </div>
  );
}

function Sample({ look }: { look: Look }) {
  return (
    <div className="space-y-6">
      <section className={look.block}>
        <h3 className={look.title} style={look.titleStyle}>モデルの割り当て</h3>
        <div className={look.body}>
          <Item title="デフォルトモデル" summary="ほかを空欄にしておけば、AI の機能はすべてこのモデルを使います">
            <Select value="サーバーデフォルト (Claude Sonnet 5)" />
          </Item>
          <Item title="チャットモデル" summary="AI チャット・点検・トピックの統合に使うモデル">
            <Select value="デフォルトモデルと同じ" />
          </Item>
        </div>
      </section>

      <section className={look.block}>
        <h3 className={look.title} style={look.titleStyle}>
          <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
          外部ツールとの接続（MCP）
        </h3>
        <div className={look.body}>
          <div>
            <h4 className="flex items-center gap-1 text-xs font-semibold text-foreground">
              <Plug size={12} className="text-muted-foreground" />
              MCP サーバー
            </h4>
            <div className="mt-2 pl-4 space-y-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="inline-block h-[18px] w-8 rounded-full bg-primary" />
                <span className="font-medium">tavily</span>
                <span className="truncate text-muted-foreground">— https://mcp.tavily.com/mcp/</span>
              </div>
              <div className={look.card}>
                <div className="text-xs font-semibold">何をつなぎますか？</div>
                <div className={look.innerCard}>
                  <div className="flex justify-between text-xs">
                    <span>
                      <span className="font-medium">Tavily</span> <span className="text-muted-foreground">tavily.com</span>
                    </span>
                    <span className="text-muted-foreground">追加済み</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">AI のための Web 検索。毎月 1,000 クレジットまで無料。</p>
                </div>
                <div className="text-xs font-semibold">公式の一覧から探す</div>
                <div className="flex gap-2">
                  <div className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
                    例: search、github、slack
                  </div>
                  <div className="flex items-center rounded-md bg-primary/60 px-3 text-white">
                    <Search size={14} />
                  </div>
                </div>
                <div className="flex justify-between pt-1 text-xs">
                  <span className="text-primary">詳しい設定（JSON・手入力・レジストリ）</span>
                  <span className="text-muted-foreground">キャンセル</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

/** いま: まとまりを上の線で区切り、カードは枠線で囲む */
const CURRENT: Look = {
  block: "border-t border-border pt-6",
  title: "flex items-center gap-1 text-sm font-semibold text-foreground mb-3",
  body: "space-y-4 pl-4",
  card: "rounded-md border border-border p-3 space-y-3",
  innerCard: "rounded-md border border-border px-3 py-2",
};

/** A: 見出しを薄い帯にする。区切り線は消し、カードは枠なしの面 */
const BAND: Look = {
  block: "",
  title: "flex items-center gap-1 rounded-md bg-muted px-3 py-1.5 text-sm font-semibold text-foreground mb-3",
  body: "space-y-4 pl-4",
  card: "rounded-lg bg-muted/60 p-3 space-y-3",
  innerCard: "rounded-md bg-card px-3 py-2",
};

/** B: 見出しの左に色の縦棒。区切り線は消して余白で区切り、カードは枠なしの面 */
const ACCENT: Look = {
  block: "",
  title: "flex items-center gap-1 pl-2 text-sm font-semibold text-foreground mb-3",
  body: "space-y-4 pl-4",
  card: "rounded-lg bg-muted/60 p-3 space-y-3",
  innerCard: "rounded-md bg-card px-3 py-2",
  titleStyle: { borderLeft: "4px solid var(--color-primary)" },
};

/** C: まとまりごと面のカードに入れる。見出しはカードの頭、区切り線もカードの枠も無し */
const PANEL: Look = {
  block: "rounded-xl bg-muted/50 p-4",
  title: "flex items-center gap-1 text-sm font-semibold text-foreground mb-3",
  body: "space-y-4 pl-4",
  card: "rounded-lg bg-card p-3 space-y-3",
  innerCard: "rounded-md bg-muted/60 px-3 py-2",
};

function Frame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="w-[460px]">
      <div className="mb-2 text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="rounded-xl border border-border bg-card p-5">{children}</div>
    </div>
  );
}

const meta = {
  title: "Molecules/SettingsSurface",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Compare: Story = {
  name: "見比べ（いま / A 見出しの帯 / B 左の縦棒 / C まとまりを面に）",
  render: () => (
    <div className="flex flex-wrap gap-6 bg-background p-4">
      <Frame label="いま">
        <Sample look={CURRENT} />
      </Frame>
      <Frame label="A: 見出しを薄い帯に＋カードは面（採用）">
        <Sample look={BAND} />
      </Frame>
      <Frame label="B: 見出しの左に縦棒＋カードは面">
        <Sample look={ACCENT} />
      </Frame>
      <Frame label="C: まとまりごと面に入れる">
        <Sample look={PANEL} />
      </Frame>
    </div>
  ),
};
