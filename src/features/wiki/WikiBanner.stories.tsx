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
  withWorldCheck = false,
}: {
  wikiMeta: WikiMeta;
  loading?: boolean;
  noteIndex?: GraphiumIndex | null;
  /** true なら「世界照合」ボタンを出す（onCheckWorldValidity を配線する）。 */
  withWorldCheck?: boolean;
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
        onCheckWorldValidity={
          withWorldCheck
            ? () => console.info("[story] onCheckWorldValidity")
            : undefined
        }
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

// ── 世界モデル照合 verdict バッジ（Phase 2 / PR 2A） ──
// 「世界照合」ボタンと 4 verdict（established / supported / weak / contested）の見た目確認。
// 別レーン契約: epistemicStatus / hypothesisStatus は触らない。

const VERDICT_CHECK_META = {
  checkedBy: "distilled-kb@v1",
  checkedAt: "2026-05-21T10:00:00Z",
} as const;

export const WorldCheckButton: StoryObj = {
  name: "世界照合 — 未照合（ボタンのみ）",
  parameters: {
    docs: {
      description: {
        story:
          "未照合状態。バッジは出ず、Regenerate の前に dashed border の「世界照合」ボタンが控えめに出る。クリックで蒸留 KB と突き合わせる（LLM なし）。",
      },
    },
  },
  render: () => (
    <Wrapper
      withWorldCheck
      wikiMeta={{ ...baseMeta, kind: "claim" }}
    />
  ),
};

export const WithValidityEstablished: StoryObj = {
  name: "世界照合 — established（教科書的確立）",
  parameters: {
    docs: {
      description: {
        story:
          "蒸留 KB の `established` エントリと一致した状態。濃い緑バッジで「Established」を提示。バッジは hover で簡易情報、バナー下部の「世界照合 詳細」折り畳みで rationale / sources / checkedBy / checkedAt をクリックで読める（派生元セクションと同じトーン）。",
      },
    },
  },
  render: () => (
    <Wrapper
      withWorldCheck
      wikiMeta={{
        ...baseMeta,
        kind: "claim",
        grounding: {
          validity: {
            ...VERDICT_CHECK_META,
            verdict: "established",
            score: 0.75,
            rationale: "Coble sintering / Herring scaling（焼結教科書の標準扱い）",
            matchedKeywords: ["焼結", "sintering", "粒成長"],
            sources: [
              { kind: "distilled", ref: "R. M. German, Sintering Theory and Practice" },
              { kind: "distilled", ref: "Wikipedia: Sintering", url: "https://en.wikipedia.org/wiki/Sintering" },
            ],
          },
        },
      }}
    />
  ),
};

export const WithValiditySupported: StoryObj = {
  name: "世界照合 — supported（支持されているが議論残り）",
  render: () => (
    <Wrapper
      withWorldCheck
      wikiMeta={{
        ...baseMeta,
        kind: "claim",
        grounding: {
          validity: {
            ...VERDICT_CHECK_META,
            verdict: "supported",
            score: 0.5,
            rationale: "豊富な実験例があるが完全な予測は難しい",
          },
        },
      }}
    />
  ),
};

export const WithValidityWeak: StoryObj = {
  name: "世界照合 — weak（裏付け弱い）",
  render: () => (
    <Wrapper
      withWorldCheck
      wikiMeta={{
        ...baseMeta,
        kind: "claim",
        grounding: {
          validity: {
            ...VERDICT_CHECK_META,
            verdict: "weak",
            score: 0.4,
            rationale: "実機構は議論中（急速昇温・短保持の効果説）",
          },
        },
      }}
    />
  ),
};

export const WithValidityContested: StoryObj = {
  name: "世界照合 — contested（反例あり）",
  parameters: {
    docs: {
      description: {
        story:
          "KB の contested エントリと一致。赤系バッジで「反例あり」を提示する。別レーン契約により epistemicStatus / hypothesisStatus は変更されない。",
      },
    },
  },
  render: () => (
    <Wrapper
      withWorldCheck
      wikiMeta={{
        ...baseMeta,
        kind: "claim",
        epistemicStatus: "interpretation",
        grounding: {
          validity: {
            ...VERDICT_CHECK_META,
            verdict: "contested",
            score: 0.6,
            rationale: "凝集の律速段階は系・温度・界面状態に強く依存し、一律比較は実験で支持されない",
          },
        },
      }}
    />
  ),
};
