// SharedCitationCard — 全状態・全種別のカタログ（Phase 2c-2 の見た目合意用）
//
// ノート本文中に置かれる shared:// 引用カードの表示バリエーションを並べる。
// データ取得や hash 照合は行わない（純表示コンポーネント）。

import type { Meta, StoryObj } from "@storybook/react-vite";
import type { SharedEntryType } from "../../lib/storage/shared";
import { SharedCitationCard } from "./SharedCitationCard";

const meta: Meta<typeof SharedCitationCard> = {
  title: "Sharing/SharedCitationCard",
  component: SharedCitationCard,
  parameters: { layout: "padded" },
  argTypes: {
    status: {
      control: "select",
      options: ["verified", "checking", "mismatch", "offline", "missing"],
    },
    entryType: {
      control: "select",
      options: ["note", "reference", "data-manifest", "template", "claim", "atom", "report"],
    },
  },
};
export default meta;

type Story = StoryObj<typeof SharedCitationCard>;

const dataArgs = {
  title: "NaCl 単結晶 XRD（2026-05-12 測定）",
  entryType: "data-manifest" as SharedEntryType,
  authorName: "田中",
  updatedAt: "2026-05-12T10:30:00+09:00",
  fileInfo: { name: "nacl_xrd_scan.csv", sizeLabel: "2.3 MB" },
  onOpen: () => {},
};

export const Playground: Story = {
  args: { ...dataArgs, status: "verified" },
};

export const AllStatuses: Story = {
  name: "全状態",
  render: () => (
    <div className="flex max-w-2xl flex-col gap-3">
      {(
        [
          ["verified", "照合済み（正常）"],
          ["checking", "照合中"],
          ["mismatch", "内容に差異（hash 不一致）"],
          ["offline", "オフライン（キャッシュ表示）"],
          ["missing", "共有側に存在しない"],
        ] as const
      ).map(([status, label]) => (
        <section key={status}>
          <h3 className="mb-1 text-xs font-semibold text-muted-foreground">{label}</h3>
          <SharedCitationCard {...dataArgs} status={status} />
        </section>
      ))}
    </div>
  ),
};

export const NewerVersion: Story = {
  name: "新版あり（major 改訂）",
  render: () => (
    <div className="max-w-2xl">
      <SharedCitationCard
        {...dataArgs}
        status="verified"
        version={2}
        hasNewerVersion
        onOpenLatest={() => {}}
      />
    </div>
  ),
};

export const AllTypes: Story = {
  name: "全種別",
  render: () => (
    <div className="flex max-w-2xl flex-col gap-2">
      {(
        [
          ["note", "焼結条件の検討メモ"],
          ["reference", "Ceder et al., Nature Materials (2024)"],
          ["data-manifest", "NaCl 単結晶 XRD（2026-05-12 測定）"],
          ["template", "実験ノートテンプレート v3"],
          ["claim", "焼結温度 800°C 以上で粒径が急増する"],
          ["atom", "前駆体の粒径が最終密度を支配する"],
          ["report", "2026 年度上期 進捗レポート"],
        ] as [SharedEntryType, string][]
      ).map(([entryType, title]) => (
        <SharedCitationCard
          key={entryType}
          title={title}
          entryType={entryType}
          authorName="田中"
          updatedAt="2026-05-12T10:30:00+09:00"
          status="verified"
          fileInfo={
            entryType === "data-manifest"
              ? { name: "nacl_xrd_scan.csv", sizeLabel: "2.3 MB" }
              : undefined
          }
          onOpen={() => {}}
        />
      ))}
    </div>
  ),
};

export const InNoteContext: Story = {
  name: "ノート本文中での見え方",
  render: () => (
    <div className="mx-auto max-w-2xl text-sm leading-relaxed text-foreground">
      <h2 className="mb-2 text-lg font-semibold">NaCl 格子定数の再解析</h2>
      <p className="mb-2">
        先行測定の生データを使って、Rietveld 解析のバックグラウンド処理を変えた場合の
        格子定数のずれを確認する。
      </p>
      <SharedCitationCard
        {...dataArgs}
        status="verified"
        onOpen={() => {}}
      />
      <p className="mt-2">
        上のデータをフィッティングし直すと、a = 5.6404 Å となり、文献値との差は
        0.02% 以内に収まった。バックグラウンドの多項式次数を上げても結果は安定している。
      </p>
    </div>
  ),
};
