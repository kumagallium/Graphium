// 出典照合（Source check, v1）の画面部品ストーリー。
// 世界照合（WikiBanner.stories.tsx）と並んだときに見た目・意味の対応を確認できるようにする。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocaleProvider, syncLocale } from "../../../i18n";
import type { SourceCheckProfile } from "../../../lib/document-types";
import { SourceCheckBadge } from "./SourceCheckBadge";
import { SourceCheckDetailSection } from "./SourceCheckDetailSection";

const meta: Meta = {
  title: "Molecules/SourceCheck",
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "出典照合（引かれた出典に知見が書いてあるか）の verdict バッジと詳細欄。世界照合（Molecules/WikiBanner）とは別レーンだが、色の意味は揃えてある: supported=forest, contradicted=rose（最も目立たせる。世界照合の contested とは意図的に変えている）, not-in-source=amber(世界照合の weak), unclear=neutral, source-missing=neutral+破線。",
      },
    },
  },
  decorators: [
    (Story) => {
      syncLocale("ja");
      return (
        <LocaleProvider>
          <div style={{ background: "var(--paper-2)", padding: 20 }}>
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
};
export default meta;

type Story = StoryObj;

const CHECKED_META = {
  checkedAt: "2026-09-10T09:00:00Z",
  checkedBy: "claude-haiku-4-5",
} as const;

function profile(
  verdict: SourceCheckProfile["verdict"],
  entries: SourceCheckProfile["entries"],
  extra?: Partial<SourceCheckProfile>,
): SourceCheckProfile {
  return {
    verdict,
    entries,
    ...CHECKED_META,
    claimHash: "hash-v1",
    ...extra,
  };
}

// ── バッジ: 5 verdict 一覧 ──

export const BadgeAllVerdicts: Story = {
  name: "バッジ — 5 verdict",
  render: () => (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <SourceCheckBadge
        profile={profile("supported", [
          { sourceId: "note-1", sourceKind: "note", verdict: "supported", rationale: "出典の記述と一致する。" },
        ])}
      />
      <SourceCheckBadge
        profile={profile("contradicted", [
          { sourceId: "note-1", sourceKind: "note", verdict: "contradicted", rationale: "出典は逆の結果を報告している。" },
        ])}
      />
      <SourceCheckBadge
        profile={profile("not-in-source", [
          { sourceId: "pdf-1", sourceKind: "pdf", verdict: "not-in-source", rationale: "この主張に対応する記述が見当たらない。" },
        ])}
      />
      <SourceCheckBadge
        profile={profile("unclear", [
          { sourceId: "url-1", sourceKind: "url", verdict: "unclear", rationale: "文脈が曖昧で判定できなかった。" },
        ])}
      />
      <SourceCheckBadge
        profile={profile("source-missing", [
          { sourceId: "chat-1", sourceKind: "chat", verdict: "source-missing", rationale: "原文を取り出せなかった。", missingReason: "no-reference" },
        ])}
      />
    </div>
  ),
};

export const BadgeDismissed: Story = {
  name: "バッジ — 確認済み（dismissed）",
  parameters: {
    docs: {
      description: {
        story: "ユーザーが「確認した」を押した状態。色を 1 段落ち着かせ、ラベルの後ろに Check アイコンを添える。",
      },
    },
  },
  render: () => (
    <SourceCheckBadge
      profile={profile(
        "contradicted",
        [{ sourceId: "note-1", sourceKind: "note", verdict: "contradicted", rationale: "出典は逆の結果を報告している。" }],
        { dismissed: true },
      )}
    />
  ),
};

export const BadgeStale: Story = {
  name: "バッジ — 本文変更後（stale）",
  parameters: {
    docs: {
      description: {
        story: "照合後に知見の本文が変わった状態（呼び出し側が claimHash を比較して stale を渡す）。同じピル内に「本文変更後」の注記を添え、別ピルを増やさない。",
      },
    },
  },
  render: () => (
    <SourceCheckBadge
      profile={profile("supported", [
        { sourceId: "note-1", sourceKind: "note", verdict: "supported", rationale: "出典の記述と一致する。" },
      ])}
      stale
    />
  ),
};

export const BadgeNextToWorldVerdict: Story = {
  name: "バッジ — 世界照合バッジと並べた例",
  parameters: {
    docs: {
      description: {
        story:
          "世界照合（WikiBanner.tsx の WorldVerdictBadge）と出典照合バッジを並べたときに、アイコン（Globe2 / FileSearch）で区別できるかを確認する。WorldVerdictBadge を import せず、同じ見た目のモックで代用。",
      },
    },
  },
  render: () => (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      {/* 世界照合バッジと同じ見た目のモック（WorldVerdictBadge は export されていないため） */}
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "1px 8px",
          borderRadius: "var(--pill)",
          border: "1px solid var(--forest, var(--rule))",
          background: "var(--paper)",
          color: "var(--forest-ink)",
          fontSize: 12,
          lineHeight: 1.4,
          fontWeight: 500,
        }}
      >
        支持された知識と整合
      </span>
      <SourceCheckBadge
        profile={profile("supported", [
          { sourceId: "note-1", sourceKind: "note", verdict: "supported", rationale: "出典の記述と一致する。" },
        ])}
      />
    </div>
  ),
};

// ── 詳細欄 ──

const SOURCE_TITLES: Record<string, string> = {
  "note-abc123": "実験ノート: MA→SPS 試料 03",
  "pdf:media-pdf-1": "Sintering Theory and Practice.pdf",
  "chat:conv-1": "AI Chat",
};

export const DetailThreeSources: Story = {
  name: "詳細欄 — 出典 3 件（ノート / PDF / チャット）",
  parameters: {
    docs: {
      description: {
        story:
          "ノート（supported + quote + blockId）、PDF（contradicted + quote）、チャット（source-missing, no-reference）の 3 出典。ノートは該当箇所へ遷移でき、チャットは missingReason を i18n ラベルで出す（保存済み rationale より優先）。",
      },
    },
  },
  render: () => (
    <SourceCheckDetailSection
      profile={profile("contradicted", [
        {
          sourceId: "note-abc123",
          sourceKind: "note",
          verdict: "supported",
          rationale: "「電子移動律速が支配的」の記述と一致する。",
          quote: "塩基性条件下では電子移動律速が支配的になる。",
          blockId: "block-42",
        },
        {
          sourceId: "pdf:media-pdf-1",
          sourceKind: "pdf",
          verdict: "contradicted",
          rationale: "出典は拡散律速を主要因として報告しており、電子移動律速の主張と食い違う。",
          quote: "Diffusion-controlled kinetics dominate under alkaline conditions.",
        },
        {
          sourceId: "chat:conv-1",
          sourceKind: "chat",
          verdict: "source-missing",
          rationale: "(保存時の言語で書かれた古い rationale。UI 言語のラベルを優先する)",
          missingReason: "no-reference",
        },
      ])}
      sourceTitles={SOURCE_TITLES}
      onOpenSource={(sourceId, blockId) => console.info("[story] onOpenSource", sourceId, blockId)}
      onRecheck={() => console.info("[story] onRecheck")}
      onDismiss={() => console.info("[story] onDismiss")}
      onClear={() => console.info("[story] onClear")}
    />
  ),
};

export const DetailStale: Story = {
  name: "詳細欄 — 本文変更後（stale）",
  render: () => (
    <SourceCheckDetailSection
      profile={profile("supported", [
        {
          sourceId: "note-abc123",
          sourceKind: "note",
          verdict: "supported",
          rationale: "出典の記述と一致する。",
        },
      ])}
      stale
      sourceTitles={SOURCE_TITLES}
      onRecheck={() => console.info("[story] onRecheck")}
    />
  ),
};

export const DetailRefetchedUrl: Story = {
  name: "詳細欄 — URL 再取得で not-in-source",
  parameters: {
    docs: {
      description: {
        story: "sourceTextOrigin が refetched（保存済みキャッシュではなく URL を再取得した）ケース。原文中にこの主張に対応する記述が見当たらなかった not-in-source。",
      },
    },
  },
  render: () => (
    <SourceCheckDetailSection
      profile={profile("not-in-source", [
        {
          sourceId: "url:https://example.org/paper",
          sourceKind: "url",
          verdict: "not-in-source",
          rationale: "再取得した原文にこの主張に対応する記述が見当たらない。",
          sourceTextOrigin: "refetched",
        },
      ])}
      sourceTitles={{ "url:https://example.org/paper": "example.org/paper" }}
      onOpenSource={(sourceId) => console.info("[story] onOpenSource", sourceId)}
    />
  ),
};

export const DetailButtonsPartial: Story = {
  name: "詳細欄 — ボタンは渡したものだけ出る",
  parameters: {
    docs: {
      description: {
        story: "onRecheck / onDismiss / onClear は渡されたものだけ表示する。ここでは onDismiss のみ渡している。",
      },
    },
  },
  render: () => (
    <SourceCheckDetailSection
      profile={profile("unclear", [
        { sourceId: "note-abc123", sourceKind: "note", verdict: "unclear", rationale: "文脈が曖昧で判定できなかった。" },
      ])}
      sourceTitles={SOURCE_TITLES}
      onDismiss={() => console.info("[story] onDismiss")}
    />
  ),
};

// ── English ──

export const English: Story = {
  name: "English",
  decorators: [
    (Story) => {
      syncLocale("en");
      return (
        <LocaleProvider>
          <div style={{ background: "var(--paper-2)", padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
  render: () => (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <SourceCheckBadge
          profile={profile("supported", [
            { sourceId: "note-1", sourceKind: "note", verdict: "supported", rationale: "Matches the source." },
          ])}
        />
        <SourceCheckBadge
          profile={profile("contradicted", [
            { sourceId: "note-1", sourceKind: "note", verdict: "contradicted", rationale: "The source reports the opposite." },
          ])}
        />
        <SourceCheckBadge
          profile={profile(
            "not-in-source",
            [{ sourceId: "pdf-1", sourceKind: "pdf", verdict: "not-in-source", rationale: "No matching passage found." }],
          )}
          stale
        />
      </div>
      <SourceCheckDetailSection
        profile={profile("contradicted", [
          {
            sourceId: "note-abc123",
            sourceKind: "note",
            verdict: "supported",
            rationale: "Matches the note's description.",
            quote: "Electron-transfer-limited kinetics dominate under alkaline conditions.",
            blockId: "block-42",
          },
          {
            sourceId: "chat:conv-1",
            sourceKind: "chat",
            verdict: "source-missing",
            rationale: "(stale rationale saved in another language)",
            missingReason: "no-reference",
          },
        ])}
        sourceTitles={SOURCE_TITLES}
        onOpenSource={(sourceId, blockId) => console.info("[story] onOpenSource", sourceId, blockId)}
        onRecheck={() => console.info("[story] onRecheck")}
        onDismiss={() => console.info("[story] onDismiss")}
        onClear={() => console.info("[story] onClear")}
      />
    </>
  ),
};

