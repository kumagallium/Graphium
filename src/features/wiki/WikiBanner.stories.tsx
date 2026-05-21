// WikiBanner のビジュアル確認用ストーリー
// 08b 原案寄せ: sky-soft 背景 / Regenerate dropdown / current 行 forest-soft

import type { Meta, StoryObj } from "@storybook/react-vite";
import { WikiBanner } from "./WikiBanner";
import type { WikiMeta } from "../../lib/document-types";
import type { GraphiumIndex } from "../navigation/index-file";

const meta: Meta<typeof WikiBanner> = {
  title: "Molecules/WikiBanner",
  component: WikiBanner,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Wiki ドキュメント最上部に常駐するバナー。AI 生成バッジ・生成日・モデル名・Regenerate ボタン・削除ボタンを表示。Regenerate は設定で選んだモデル（Default / Chat & Synthesis）に従う。",
      },
    },
  },
};
export default meta;

const baseMeta: WikiMeta = {
  kind: "summary",
  derivedFromNotes: ["note-abc123"],
  derivedFromChats: [],
  generatedAt: "2026-04-20T14:32:00Z",
  generatedBy: { model: "gpt-4o-mini", version: "" },
};

function Wrapper({
  wikiMeta,
  loading = false,
  noteIndex,
}: {
  wikiMeta: WikiMeta;
  loading?: boolean;
  noteIndex?: GraphiumIndex | null;
}) {
  return (
    <div style={{ background: "var(--paper-2)", padding: "16px 0", minWidth: 640 }}>
      <WikiBanner
        wikiMeta={wikiMeta}
        onRegenerate={() => console.info("[story] onRegenerate")}
        onDelete={() => console.info("[story] onDelete")}
        loading={loading}
        noteIndex={noteIndex ?? null}
        onNavigateNote={(noteId) => console.info("[story] onNavigateNote", noteId)}
      />
      <div style={{ padding: "8px 32px", fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--mono)" }}>
        ↑ Regenerate は設定で選んだモデル（Default / Chat & Synthesis）を使います
      </div>
    </div>
  );
}

// 派生元セクションの解決用ダミーインデックス
const sampleNoteIndex: GraphiumIndex = {
  version: 16,
  updatedAt: "2026-05-20T12:00:00Z",
  notes: [
    {
      noteId: "note-abc123",
      title: "実験ノート: MA→SPS 試料 03",
      modifiedAt: "2026-05-18T09:00:00Z",
      createdAt: "2026-05-15T09:00:00Z",
      headings: [],
      labels: [],
      outgoingLinks: [],
      source: "human",
    },
    {
      noteId: "note-def456",
      title: "TG-DTA 測定メモ",
      modifiedAt: "2026-05-19T10:00:00Z",
      createdAt: "2026-05-16T10:00:00Z",
      headings: [],
      labels: [],
      outgoingLinks: [],
      source: "human",
    },
    {
      noteId: "claim-xyz789",
      title: "Claim: 800℃ 焼結で粒成長が抑制される",
      modifiedAt: "2026-05-19T11:00:00Z",
      createdAt: "2026-05-19T11:00:00Z",
      headings: [],
      labels: [],
      outgoingLinks: [],
      source: "ai",
      wikiKind: "claim",
    },
  ],
};

export const Summary: StoryObj = {
  name: "Summary — 基本",
  render: () => <Wrapper wikiMeta={baseMeta} />,
};

export const Claim: StoryObj = {
  name: "Claim",
  render: () => <Wrapper wikiMeta={{ ...baseMeta, kind: "claim", generatedBy: { model: "claude-haiku-4-5", version: "" } }} />,
};

export const Synthesis: StoryObj = {
  name: "Synthesis",
  render: () => <Wrapper wikiMeta={{ ...baseMeta, kind: "synthesis", generatedBy: { model: "claude-sonnet-4-6", version: "" } }} />,
};

export const Loading: StoryObj = {
  name: "Loading 状態",
  render: () => <Wrapper wikiMeta={baseMeta} loading />,
};

export const NoModel: StoryObj = {
  name: "モデル名なし",
  render: () => (
    <Wrapper
      wikiMeta={{
        ...baseMeta,
        generatedBy: { model: "", version: "" },
      }}
    />
  ),
};

export const WithDerivedFrom: StoryObj = {
  name: "派生元あり（Atom: ノート + Source Claim）",
  parameters: {
    docs: {
      description: {
        story:
          "world-model-grounding Phase 1。`derivedFromNotes` / `derivedFromClaims` がある場合に、来歴を控えめにバナー下部へ畳んで提示する。クリックで該当ノート / Claim を SidePeek（右側スライド）で開く想定。深い系譜は右パネルの Graph→Lineage タブで辿る。",
      },
    },
  },
  render: () => (
    <Wrapper
      noteIndex={sampleNoteIndex}
      wikiMeta={{
        ...baseMeta,
        kind: "atom",
        derivedFromNotes: ["note-abc123", "note-def456"],
        derivedFromClaims: ["claim-xyz789"],
        atomType: "mechanistic",
      }}
    />
  ),
};

export const WithDerivedFromUnresolved: StoryObj = {
  name: "派生元あり（一部 index 未解決）",
  parameters: {
    docs: {
      description: {
        story:
          "ゴミ箱送り・古いデータなどで index に存在しない ID は `(不明)` として薄く表示し、ナビゲーションは抑止する。",
      },
    },
  },
  render: () => (
    <Wrapper
      noteIndex={sampleNoteIndex}
      wikiMeta={{
        ...baseMeta,
        kind: "atom",
        derivedFromNotes: ["note-abc123", "note-missing-999"],
        derivedFromClaims: ["claim-xyz789", "claim-missing-000"],
      }}
    />
  ),
};
