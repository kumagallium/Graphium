// WikiBanner のビジュアル確認用ストーリー
// 08b 原案寄せ: sky-soft 背景 / Regenerate dropdown / current 行 forest-soft

import type { Meta, StoryObj } from "@storybook/react-vite";
import { WikiBanner, type WikiBannerDesignVariant } from "./WikiBanner";
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

// 実際の NoteEditorInner が出すタイトルバーを模した擬似 UI（border-b + 小タイトル + 保存済み）。
// ストーリーで「バナーがタイトルバーの上にある違和感」「区切り線が 2 本になる」を再現する。
function MockTitleBar({ title }: { title: string }) {
  return (
    <div
      style={{
        padding: "10px 16px",
        borderBottom: "1px solid var(--rule)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "var(--paper)",
      }}
    >
      <div
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 14,
          fontWeight: 500,
          color: "var(--ink-3)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={title}
      >
        {title}
      </div>
      <span style={{ fontSize: 10, color: "var(--ink-3)" }}>保存済み</span>
      <span style={{ fontSize: 12, color: "var(--ink-4)" }}>⋯</span>
    </div>
  );
}

function MockBody({ title }: { title: string }) {
  return (
    <div
      style={{
        margin: "0 32px",
        padding: "16px 0",
        fontSize: 16,
        lineHeight: 1.7,
        color: "var(--ink-1, var(--ink-2))",
      }}
    >
      <h1 style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.3, margin: "0 0 16px" }}>
        {title}
      </h1>
      <p style={{ margin: "0 0 12px" }}>
        塩基性条件下では電子移動律速が支配的になり、薄膜の還元速度は印加電位と
        pH の両方に対して 2 段階の依存性を示す。これは Marcus 理論の予測と
        整合し、過電圧 0.3 V を境に律速段階が切り替わるためと考えられる。
      </p>
      <p style={{ margin: 0 }}>
        ただし強酸性領域では表面プロトン化が支配的となり、本主張は成立しない
        （後述 Rebuttal 参照）。
      </p>
    </div>
  );
}

function Wrapper({
  wikiMeta,
  loading = false,
  noteIndex,
  withWorldCheck = false,
  designVariant,
  withMockBody = false,
}: {
  wikiMeta: WikiMeta;
  loading?: boolean;
  noteIndex?: GraphiumIndex | null;
  /** true なら「世界照合」ボタンを出す（onCheckWorldValidity を配線する）。 */
  withWorldCheck?: boolean;
  /** デザイン比較バリアント（current / soft / type / both） */
  designVariant?: WikiBannerDesignVariant;
  /** 本文との視覚的連続性を比較したい時に、バナー下に擬似本文を出す。 */
  withMockBody?: boolean;
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
        designVariant={designVariant}
      />
      {withMockBody ? (
        <div
          style={{
            margin: "0 32px",
            padding: "8px 0 16px",
            fontSize: 16,
            lineHeight: 1.7,
            color: "var(--ink-1, var(--ink-2))",
          }}
        >
          <p style={{ margin: "0 0 12px" }}>
            塩基性条件下では電子移動律速が支配的になり、薄膜の還元速度は印加電位と
            pH の両方に対して 2 段階の依存性を示す。これは Marcus 理論の予測と
            整合し、過電圧 0.3 V を境に律速段階が切り替わるためと考えられる。
          </p>
          <p style={{ margin: 0 }}>
            ただし強酸性領域では表面プロトン化が支配的となり、本主張は成立しない
            （後述 Rebuttal 参照）。今後の検証では膜厚 50 nm を下回る系での
            表面効果の寄与を切り分ける必要がある。
          </p>
        </div>
      ) : (
        <div style={{ padding: "8px 32px", fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--mono)" }}>
          ↑ Regenerate は設定で選んだモデル（Default / Chat & Synthesis）を使います
        </div>
      )}
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

// ── Phase γ + η: Toulmin extension + EpistemicStatus icons ──
// 4 つの新フィールド（epistemicStatus / modalQualifier / backing / rebuttalConditions）
// の見た目を、それぞれ単独 + 全部入りで確認する。
// 色: speculation=amber, interpretation=sky, observation=forest, established=forest-soft / dark-ink

export const WithEpistemicStatusAll: StoryObj = {
  name: "epistemicStatus — 4 段階そろえ",
  parameters: {
    docs: {
      description: {
        story:
          "Phase η: 段階順に並べた 4 状態を 1 ストーリーに収めて、視覚的な強さの推移を一目で確認する。amber → sky → forest 系の順に色相が落ち着いていく。Atomizer / Synthesizer は最低継承（lowestEpistemicStatus）で値を受け継ぐので、wikiKind を問わず読める設計。",
      },
    },
  },
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Wrapper
        wikiMeta={{
          ...baseMeta,
          kind: "claim",
          epistemicStatus: "speculation",
          claimRole: ["question"],
        }}
      />
      <Wrapper
        wikiMeta={{
          ...baseMeta,
          kind: "claim",
          epistemicStatus: "interpretation",
          claimRole: ["interpretation"],
        }}
      />
      <Wrapper
        wikiMeta={{
          ...baseMeta,
          kind: "claim",
          epistemicStatus: "observation",
          claimRole: ["finding"],
        }}
      />
      <Wrapper
        wikiMeta={{
          ...baseMeta,
          kind: "claim",
          epistemicStatus: "established",
          claimRole: ["decision"],
        }}
      />
    </div>
  ),
};

export const WithModalQualifier: StoryObj = {
  name: "modalQualifier — 4 表現そろえ",
  parameters: {
    docs: {
      description: {
        story:
          "Phase γ: ノートの言い回しから推定したユーザー主観の確からしさ。system confidence とは別軸であることを Sparkles アイコン + italic で示唆。necessarily / probably / possibly / rarely の 4 値。",
      },
    },
  },
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Wrapper
        wikiMeta={{ ...baseMeta, kind: "claim", modalQualifier: "necessarily", claimRole: ["decision"] }}
      />
      <Wrapper
        wikiMeta={{ ...baseMeta, kind: "claim", modalQualifier: "probably", claimRole: ["interpretation"] }}
      />
      <Wrapper
        wikiMeta={{ ...baseMeta, kind: "claim", modalQualifier: "possibly", claimRole: ["question"] }}
      />
      <Wrapper
        wikiMeta={{ ...baseMeta, kind: "claim", modalQualifier: "rarely", claimRole: ["anomaly"] }}
      />
    </div>
  ),
};

export const WithBacking: StoryObj = {
  name: "Backing — Warrant の裏付け（折り畳み）",
  parameters: {
    docs: {
      description: {
        story:
          "Phase γ: Toulmin の Backing。Warrant（推論ルール）の根拠を、source ごとに色分けしたチップ（教科書=forest / 外部論文=sky / 内部 Claim=neutral）で並べる。externalReferences との違いに注意（あちらは Claim 自体の根拠）。",
      },
    },
  },
  render: () => (
    <Wrapper
      wikiMeta={{
        ...baseMeta,
        kind: "claim",
        claimRole: ["interpretation"],
        backing: [
          {
            source: "textbook",
            citation: "Marcus 理論：電子移動律速の原理（高校生でも知っている古典）",
          },
          {
            source: "external-paper",
            citation: "Doe et al. (2024), 'pH-dependent oxide reduction kinetics in alkaline media'",
            url: "https://example.org/doi/10.0000/marcus-ph",
          },
          {
            source: "internal-claim",
            citation: "別ノートで観測した、塩基性条件下での律速段階切り替わり",
            internalClaimId: "claim-xyz789",
          },
        ],
      }}
    />
  ),
};

export const WithRebuttalConditions: StoryObj = {
  name: "Rebuttal Conditions — 反例条件（折り畳み）",
  parameters: {
    docs: {
      description: {
        story:
          "Phase γ: この Claim が成立しない条件・領域。dashed border + AlertTriangle で「成り立たない領域」を示す。synthesizer が dialectic を検出するシグナルとしても使われる。",
      },
    },
  },
  render: () => (
    <Wrapper
      wikiMeta={{
        ...baseMeta,
        kind: "claim",
        claimRole: ["finding"],
        rebuttalConditions: [
          "強酸性条件（pH < 2）では電子移動律速が消失する",
          "極端な低温（< -10°C）では拡散律速が再支配する",
          "薄膜厚 < 50 nm では表面効果が無視できなくなる",
        ],
      }}
    />
  ),
};

export const WithToulminComplete: StoryObj = {
  name: "Toulmin 全部入り（epistemic + modal + backing + rebuttal）",
  parameters: {
    docs: {
      description: {
        story:
          "Phase γ + η + Phase 2b の集大成。Claim 1 つに 4 つの新情報 + verdict が同居したときに視覚的に窮屈にならないか確認するためのストーリー。バッジは header に、長文セクションは下に分離されているのを目視で確認する。",
      },
    },
  },
  render: () => (
    <Wrapper
      withWorldCheck
      wikiMeta={{
        ...baseMeta,
        kind: "claim",
        claimRole: ["interpretation", "decision"],
        epistemicStatus: "interpretation",
        modalQualifier: "probably",
        confidence: 0.78,
        backing: [
          {
            source: "textbook",
            citation: "Marcus 理論：電子移動律速の原理",
          },
          {
            source: "external-paper",
            citation: "Doe et al. (2024), pH-dependent oxide reduction kinetics",
            url: "https://example.org/doi/10.0000/marcus-ph",
          },
        ],
        rebuttalConditions: [
          "強酸性条件（pH < 2）では電子移動律速が消失する",
          "薄膜厚 < 50 nm では表面効果が無視できなくなる",
        ],
        grounding: {
          validity: {
            ...VERDICT_CHECK_META,
            verdict: "supported",
            score: 0.62,
            rationale: "KB の Marcus 理論エントリと整合し、複数の論文 backing が確認できる",
          },
        },
      }}
    />
  ),
};

// ── デザイン比較（2026-05-22, design subagent + ユーザー議論）──
// 「バナーの一貫性 vs 差別化」「フォントサイズ 11px は読ませる気がない」の論点を
// 視覚的に並べて比較するための 4 バリアント。合意後に designVariant prop は撤去予定。

const DESIGN_COMPARE_META: WikiMeta = {
  ...baseMeta,
  kind: "claim",
  claimRole: ["interpretation"],
  epistemicStatus: "interpretation",
  modalQualifier: "probably",
  confidence: 0.78,
  derivedFromNotes: ["note-abc123", "note-def456"],
  backing: [
    {
      source: "textbook",
      citation: "Marcus 理論：電子移動律速の原理",
    },
    {
      source: "external-paper",
      citation: "Doe et al. (2024), pH-dependent oxide reduction kinetics in alkaline media",
      url: "https://example.org/doi/10.0000/marcus-ph",
    },
  ],
  rebuttalConditions: [
    "強酸性条件（pH < 2）では電子移動律速が消失する",
    "薄膜厚 < 50 nm では表面効果が無視できなくなる",
  ],
  grounding: {
    validity: {
      checkedBy: "distilled-kb@v1",
      checkedAt: "2026-05-21T10:00:00Z",
      verdict: "supported",
      score: 0.62,
      rationale: "KB の Marcus 理論エントリと整合し、複数の論文 backing が確認できる",
    },
  },
};

function DesignCompareSection({
  title,
  description,
  variant,
}: {
  title: string;
  description: string;
  variant: WikiBannerDesignVariant;
}) {
  return (
    <div style={{ borderTop: "2px solid var(--rule)", paddingTop: 8 }}>
      <div
        style={{
          padding: "4px 32px 8px",
          fontSize: 13,
          color: "var(--ink-3)",
          fontFamily: "var(--mono)",
        }}
      >
        <strong style={{ color: "var(--ink-1, var(--ink-2))" }}>{title}</strong>
        {" — "}
        {description}
      </div>
      <Wrapper
        withWorldCheck
        withMockBody
        designVariant={variant}
        noteIndex={sampleNoteIndex}
        wikiMeta={DESIGN_COMPARE_META}
      />
    </div>
  );
}

export const DesignCompareCurrent: StoryObj = {
  name: "比較 A — 現状（bordered card / 11px 本文）",
  parameters: {
    docs: {
      description: {
        story:
          "案 A: 現状そのまま。bordered card + 11px の折り畳み本文。一貫性論からはノートと別物に見える / 「読ませる気がない」と感じられる、というユーザー指摘の出発点。",
      },
    },
  },
  render: () => (
    <DesignCompareSection
      title="A. 現状"
      description="bordered card + 折り畳み本文 11px。下の擬似本文との分離感が強い。"
      variant="current"
    />
  ),
};

export const DesignCompareSoftBoundary: StoryObj = {
  name: "比較 B — ソフト境界（背景透過 + dashed underline）",
  parameters: {
    docs: {
      description: {
        story:
          "案 B: 背景塗りと border を撤去し、下端の dashed underline だけ残す。AI バッジ / kind ラベル / 各種バッジは維持しているので「AI 出自の開示」は失わない。下の擬似本文と視覚的に連続するか確認する。",
      },
    },
  },
  render: () => (
    <DesignCompareSection
      title="B. ソフト境界"
      description="background:transparent / border 撤去 / 下端 1px dashed。本文との段差が小さくなる。"
      variant="soft"
    />
  ),
};

export const DesignCompareTypeFixed: StoryObj = {
  name: "比較 C — タイポ補正（折り畳み本文 14px）",
  parameters: {
    docs: {
      description: {
        story:
          "案 C: 折り畳みセクションの本文を 11px → 14px、line-height を 1.55 に補正。バッジ系（12px）はそのまま。閉じた状態でのバナー高さはほぼ変わらず、開いた時だけ読みやすくなる非対称な改善。design.md の禁止項目（任意値 11px）を解消。",
      },
    },
  },
  render: () => (
    <DesignCompareSection
      title="C. タイポ補正"
      description="折り畳み本文 14px・line-height 1.55。バッジは 12px のまま。"
      variant="type"
    />
  ),
};

export const DesignCompareBoth: StoryObj = {
  name: "比較 B+C — ソフト境界 + タイポ補正（design subagent 推奨）",
  parameters: {
    docs: {
      description: {
        story:
          "案 B+C: 両方適用。ボックスの圧迫感が消え、折り畳みを開いたときに「読める」サイズになる。これが design subagent の推奨案。下の 4 案並列ストーリーで A↔︎B+C の差を一目で比較できる。",
      },
    },
  },
  render: () => (
    <DesignCompareSection
      title="B+C. 推奨案"
      description="ソフト境界 + 折り畳み本文 14px。"
      variant="both"
    />
  ),
};

export const DesignCompareAllFour: StoryObj = {
  name: "比較 4 案並列（A / B / C / B+C）",
  parameters: {
    docs: {
      description: {
        story:
          "同じデータ（Toulmin 全部入り）に対して 4 バリアントを上から順に並べる。スクロールしながら見比べて、どの組み合わせが Crucible のブランドキーワード（誠実・やさしい・モダン・シンプル・居心地）にもっとも合うかを判断する材料。",
      },
    },
  },
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <DesignCompareSection
        title="A. 現状"
        description="bordered card + 折り畳み本文 11px。"
        variant="current"
      />
      <DesignCompareSection
        title="B. ソフト境界"
        description="background:transparent + 下端 1px dashed。本文 11px は据え置き。"
        variant="soft"
      />
      <DesignCompareSection
        title="C. タイポ補正"
        description="折り畳み本文 14px。bordered card のまま。"
        variant="type"
      />
      <DesignCompareSection
        title="B+C. 推奨案"
        description="ソフト境界 + 折り畳み本文 14px。"
        variant="both"
      />
    </div>
  ),
};

// ── レイアウト位置の比較（2026-05-22 ユーザー指摘）──
// 実態: WikiBanner（独自 border）→ タイトルバー（border-b）→ H1 → 本文
// → 区切り線が 2 本、タイトルが 2 回（タイトルバーの小タイトル + H1）、
//    そしてタイトルバーの上にバナーが乗る違和感。
// 以下 D0 / D1 / D2 で位置パターンを比較する。WikiBanner 本体は同じ「B+C 推奨案」
// バリアント（ソフト境界 + 14px）を使う — 比較対象は配置のみに絞る。

const SAMPLE_TITLE = "液体急冷と真空封入実験の結果と今後の課題";

function LayoutFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--paper-2)",
        minWidth: 720,
        border: "1px solid var(--rule)",
        borderRadius: 4,
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

function LayoutCaption({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "4px 16px 8px",
        fontSize: 13,
        color: "var(--ink-3)",
        fontFamily: "var(--mono)",
      }}
    >
      {children}
    </div>
  );
}

export const LayoutCompareCurrent: StoryObj = {
  name: "配置 D0 — 現状（タイトルバー上にバナー）",
  parameters: {
    docs: {
      description: {
        story:
          "現状の配置を擬似的に再現したもの。WikiBanner はタイトルバーの上にあり、独自の border-radius + border を持つ。タイトルバーには小タイトル + 保存済み。下に H1 がもう一度。区切り線が 2 本（banner 下端と title bar 下端）、タイトルが 2 回出るのが目視で分かる。",
      },
    },
  },
  render: () => (
    <>
      <LayoutCaption>
        <strong style={{ color: "var(--ink-1, var(--ink-2))" }}>D0. 現状</strong>
        {" — "}
        WikiBanner → タイトルバー → H1。区切り線 2 本 + タイトル 2 回が起きる。
      </LayoutCaption>
      <LayoutFrame>
        <Wrapper
          withWorldCheck
          designVariant="both"
          wikiMeta={DESIGN_COMPARE_META}
          noteIndex={sampleNoteIndex}
        />
        <MockTitleBar title={SAMPLE_TITLE} />
        <MockBody title={SAMPLE_TITLE} />
      </LayoutFrame>
    </>
  ),
};

export const LayoutCompareBelowTitleBar: StoryObj = {
  name: "配置 D1 — タイトルバーの下にバナー",
  parameters: {
    docs: {
      description: {
        story:
          "タイトルバーは UI の最上段に維持して、ノートと一貫させる。WikiBanner はタイトルバーの直下に降ろし、ソフト境界（背景透過・border なし）にすることで title bar の border-b が「タイトルバー / 本体」の唯一の区切り線として機能する。バナーは「本文の上に置かれたメタ情報帯」になり、H1 が続く。",
      },
    },
  },
  render: () => (
    <>
      <LayoutCaption>
        <strong style={{ color: "var(--ink-1, var(--ink-2))" }}>D1. タイトルバー下</strong>
        {" — "}
        タイトルバーが最上段（ノートと一貫）。バナーは soft 境界で本文に降りる。
      </LayoutCaption>
      <LayoutFrame>
        <MockTitleBar title={SAMPLE_TITLE} />
        <Wrapper
          withWorldCheck
          designVariant="both"
          wikiMeta={DESIGN_COMPARE_META}
          noteIndex={sampleNoteIndex}
        />
        <MockBody title={SAMPLE_TITLE} />
      </LayoutFrame>
    </>
  ),
};

// D2 用: バナーを「タイトルバーに統合した」ように見せる擬似 UI。
// 実装の方向性確認のためのモックなので、WikiBanner コンポーネントは使わず手で書く。
// 本実装する場合は WikiBanner を「inline 版」と「セクション drawer 版」に分解する必要がある。
function MockMergedTitleBar({
  title,
  kindLabel,
  date,
  model,
}: {
  title: string;
  kindLabel: string;
  date: string;
  model: string;
}) {
  return (
    <div
      style={{
        padding: "10px 16px",
        borderBottom: "1px solid var(--rule)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: "var(--paper)",
        flexWrap: "wrap",
      }}
    >
      <div
        style={{
          fontSize: 14,
          fontWeight: 500,
          color: "var(--ink-3)",
          maxWidth: 320,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={title}
      >
        {title}
      </div>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "1px 8px 1px 4px",
          borderRadius: "var(--pill)",
          background: "var(--paper)",
          border: "1px solid var(--rule)",
          color: "var(--ink-2)",
          fontSize: 12,
        }}
      >
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: 3,
            background: "var(--forest)",
            color: "#fff",
            fontSize: 9,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 500,
          }}
        >
          AI
        </span>
        {kindLabel}
      </span>
      <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{date}</span>
      <span style={{ fontSize: 12, color: "var(--ink-4)", fontFamily: "var(--mono)" }}>{model}</span>
      <div style={{ flex: 1 }} />
      <span style={{ fontSize: 10, color: "var(--ink-3)" }}>保存済み</span>
      <span style={{ fontSize: 12, color: "var(--ink-4)" }}>⋯</span>
    </div>
  );
}

function MockContextDrawer() {
  return (
    <div
      style={{
        margin: "0 32px 16px",
        padding: "8px 12px",
        background: "transparent",
        borderTop: "1px dashed var(--rule)",
        borderBottom: "1px dashed var(--rule)",
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        fontSize: 14,
        lineHeight: 1.55,
        color: "var(--ink-2)",
      }}
    >
      <span style={{ color: "var(--ink-3)", fontSize: 12 }}>このナレッジについて:</span>
      <span style={{ fontSize: 12 }}>派生元 (2)</span>
      <span style={{ color: "var(--ink-4)" }}>·</span>
      <span style={{ fontSize: 12, color: "var(--forest-ink)" }}>世界照合: supported</span>
      <span style={{ color: "var(--ink-4)" }}>·</span>
      <span style={{ fontSize: 12 }}>Backing (2)</span>
      <span style={{ color: "var(--ink-4)" }}>·</span>
      <span style={{ fontSize: 12, color: "var(--amber-ink, #b45309)" }}>Rebuttal (2)</span>
      <span style={{ color: "var(--ink-4)" }}>·</span>
      <span style={{ fontSize: 12, fontStyle: "italic" }}>interpretation / probably</span>
    </div>
  );
}

export const LayoutCompareMergedIntoTitleBar: StoryObj = {
  name: "配置 D2 — タイトルバーに統合 + 本文下に context drawer",
  parameters: {
    docs: {
      description: {
        story:
          "WikiBanner の identification（AI バッジ・kind・date・model）をタイトルバーの右側に inline で並べてしまう案。タイトルバーは「Wiki 用に少し情報量が多いバージョン」になるが、ノート用との UI 構造は同じ。Toulmin / derivation / world grounding / backing / rebuttal は H1 の下に「context drawer」として 1 行に圧縮し、クリックで詳細が展開できる形にする想定。実装には WikiBanner を分解する必要があるので、まずはモックで方向性を共有する。",
      },
    },
  },
  render: () => (
    <>
      <LayoutCaption>
        <strong style={{ color: "var(--ink-1, var(--ink-2))" }}>D2. 統合 + drawer</strong>
        {" — "}
        identification は title bar に inline。Toulmin / 派生元 / verdict は H1 の下に 1 行で要約。
      </LayoutCaption>
      <LayoutFrame>
        <MockMergedTitleBar
          title={SAMPLE_TITLE}
          kindLabel="要約"
          date="2026年5月21日"
          model="gpt-oss-120b"
        />
        <MockBody title={SAMPLE_TITLE} />
        <MockContextDrawer />
      </LayoutFrame>
    </>
  ),
};

export const LayoutCompareAllThree: StoryObj = {
  name: "配置 3 案並列（D0 / D1 / D2）",
  parameters: {
    docs: {
      description: {
        story:
          "同じデータで配置パターンだけ変えて並べる。スクロールしながら、(1) 区切り線の重複、(2) タイトル 2 回出現、(3) タイトルバー上にバナーが乗る違和感、それぞれが各案でどう解消されるかを目視確認する。",
      },
    },
  },
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      <div>
        <LayoutCaption>
          <strong style={{ color: "var(--ink-1, var(--ink-2))" }}>D0. 現状</strong>
          {" — "}
          区切り線 2 本 / タイトル 2 回 / バナーがタイトルバー上。
        </LayoutCaption>
        <LayoutFrame>
          <Wrapper
            withWorldCheck
            designVariant="both"
            wikiMeta={DESIGN_COMPARE_META}
            noteIndex={sampleNoteIndex}
          />
          <MockTitleBar title={SAMPLE_TITLE} />
          <MockBody title={SAMPLE_TITLE} />
        </LayoutFrame>
      </div>
      <div>
        <LayoutCaption>
          <strong style={{ color: "var(--ink-1, var(--ink-2))" }}>D1. タイトルバー下にバナー</strong>
          {" — "}
          タイトルバーが最上段（ノートと一貫）。区切り線は title bar の 1 本。
        </LayoutCaption>
        <LayoutFrame>
          <MockTitleBar title={SAMPLE_TITLE} />
          <Wrapper
            withWorldCheck
            designVariant="both"
            wikiMeta={DESIGN_COMPARE_META}
            noteIndex={sampleNoteIndex}
          />
          <MockBody title={SAMPLE_TITLE} />
        </LayoutFrame>
      </div>
      <div>
        <LayoutCaption>
          <strong style={{ color: "var(--ink-1, var(--ink-2))" }}>D2. 統合 + drawer</strong>
          {" — "}
          identification は title bar、annotation は H1 下の 1 行に。
        </LayoutCaption>
        <LayoutFrame>
          <MockMergedTitleBar
            title={SAMPLE_TITLE}
            kindLabel="要約"
            date="2026年5月21日"
            model="gpt-oss-120b"
          />
          <MockBody title={SAMPLE_TITLE} />
          <MockContextDrawer />
        </LayoutFrame>
      </div>
    </div>
  ),
};
