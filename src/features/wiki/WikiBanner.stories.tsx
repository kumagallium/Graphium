// WikiBanner のビジュアル確認用ストーリー
// 08b 原案寄せ: sky-soft 背景 / Regenerate dropdown / current 行 forest-soft

import type { Meta, StoryObj } from "@storybook/react-vite";
import { WikiBanner, WikiContextDrawer } from "./WikiBanner";
import type { WikiMeta, WikiMetaSummary } from "../../lib/document-types";
import type { GraphiumIndex } from "../navigation/index-file";

const meta: Meta<typeof WikiBanner> = {
  title: "Molecules/WikiBanner",
  component: WikiBanner,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Wiki ドキュメント上部に常駐する identity バナー（AI 生成バッジ・型・確信度・世界照合 verdict・Regenerate / 削除）。\n\n" +
          "D2 配置（2026-06）: 手順条件 / 派生元 / 世界照合 詳細 / 同じ世界事実に接続した洞察 / Backing / Rebuttal といった「関連・文脈」セクションは本文の**下**に `WikiContextDrawer` として展開する。各ストーリーは title bar → identity → 本文 → context drawer の実レイアウトを擬似再現している。",
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

// 実 UI と同じく、バナーは「タイトルバーの直下 → 本文の直上」に挟まる位置で
// 表示されるので、Storybook も同じスタックを擬似的に再現する。
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
        {title || "(無題)"}
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
      <p style={{ margin: 0 }}>
        塩基性条件下では電子移動律速が支配的になり、薄膜の還元速度は印加電位と
        pH の両方に対して 2 段階の依存性を示す。
      </p>
    </div>
  );
}

function Wrapper({
  wikiMeta,
  loading = false,
  noteIndex,
  withWorldCheck = false,
  mockTitle = "Wiki ドキュメントのタイトル",
  allWikiMetas,
  wikiId,
}: {
  wikiMeta: WikiMeta;
  loading?: boolean;
  noteIndex?: GraphiumIndex | null;
  /** true なら「世界照合」ボタンを出す（onCheckWorldValidity を配線する）。 */
  withWorldCheck?: boolean;
  /** 擬似タイトルバー / 擬似 H1 に流すタイトル文字列。 */
  mockTitle?: string;
  /** 「同じ世界事実に接続した洞察」用の全 wiki サマリ Map。 */
  allWikiMetas?: Map<string, WikiMetaSummary>;
  /** 表示中 wiki 自身の ID（grounding edge で自分を除外）。 */
  wikiId?: string;
}) {
  return (
    <div style={{ background: "var(--paper-2)", minWidth: 640 }}>
      <MockTitleBar title={mockTitle} />
      {/* identity（本文の上）。relational なセクションは持たない。 */}
      <WikiBanner
        wikiMeta={wikiMeta}
        onRegenerate={() => console.info("[story] onRegenerate")}
        onDelete={() => console.info("[story] onDelete")}
        loading={loading}
        onCheckWorldValidity={
          withWorldCheck
            ? () => console.info("[story] onCheckWorldValidity")
            : undefined
        }
      />
      <MockBody title={mockTitle} />
      {/* context drawer（本文の下、D2 配置）。MockBody と同じ左右マージンに揃える。 */}
      <div style={{ margin: "0 32px" }}>
        <WikiContextDrawer
          wikiMeta={wikiMeta}
          noteIndex={noteIndex ?? null}
          onNavigateNote={(noteId) => console.info("[story] onNavigateNote", noteId)}
          onClearWorldValidity={() => console.info("[story] onClearWorldValidity")}
          allWikiMetas={allWikiMetas}
          wikiId={wikiId}
        />
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
    // Phase δ/ε ストーリー用ダミー Atom エントリ群
    {
      noteId: "atom-grain-001",
      title: "Atom: 粒成長は時間 t^{1/3} に従う",
      modifiedAt: "2026-05-20T11:00:00Z",
      createdAt: "2026-05-20T11:00:00Z",
      headings: [],
      labels: [],
      outgoingLinks: [],
      source: "ai",
      wikiKind: "atom",
    },
    {
      noteId: "atom-sps-002",
      title: "Atom: SPS では短時間でも緻密化が進む",
      modifiedAt: "2026-05-20T12:00:00Z",
      createdAt: "2026-05-20T12:00:00Z",
      headings: [],
      labels: [],
      outgoingLinks: [],
      source: "ai",
      wikiKind: "atom",
    },
    {
      noteId: "atom-polymer-003",
      title: "Atom: 高分子の架橋密度が機械強度を支配する",
      modifiedAt: "2026-05-20T13:00:00Z",
      createdAt: "2026-05-20T13:00:00Z",
      headings: [],
      labels: [],
      outgoingLinks: [],
      source: "ai",
      wikiKind: "atom",
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

export const ClaimCorroborated: StoryObj = {
  name: "Claim — 確証済み（複数ノート依拠で自動昇格）",
  render: () => (
    <Wrapper
      wikiMeta={{
        ...baseMeta,
        kind: "claim",
        status: "verified",
        derivedFromNotes: ["note-abc123", "note-def456"],
        generatedBy: { model: "claude-haiku-4-5", version: "" },
      }}
    />
  ),
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

export const WithShape: StoryObj = {
  name: "構造の形（Atom: shape）",
  parameters: {
    docs: {
      description: {
        story:
          "構造的抽象（PR #477）で付与される `shape`（関係の形）。バッジで identity 層に出すと情報過多になるため、世界照合・派生元と同じ context drawer 下部に「構造の形 …」の控えめなテキストで表示する（一覧には出さない）。\n\n`transfer`（越境転移）はデータとしては生成・保持するが UI には出さない — 別分野への越境を発想するのはユーザーの創造的な仕事で、AI が先回りするとアンカリングになるため。将来の発想（Idea）レイヤ（人間トリガー）で使う。ここでは transfer をあえて渡しても表示されないことを確認できる。",
      },
    },
  },
  render: () => (
    <Wrapper
      noteIndex={sampleNoteIndex}
      wikiMeta={{
        ...baseMeta,
        kind: "atom",
        derivedFromClaims: ["claim-xyz789"],
        atomType: "mechanistic",
        shape: "composition-structure",
        // transfer はデータとして持っていても UI には出さない（意図的に非表示）
        transfer: {
          field: "都市交通",
          example: "車線幅や信号間隔が揃った道路網ほど渋滞（流れの妨げ）が起きにくい。",
        },
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

// ── Phase δ: Atom 間 dimensional 関係（axial coding）──
// relatedAtoms を派生元と同じ折り畳みの中に表示する（B案: 折り畳み数を増やさない統合）。
// 関係種別ピル + リンク + citation の 3 段重ね。

export const WithRelatedAtoms: StoryObj = {
  name: "Phase δ: Atom 間 dimensional 関係",
  parameters: {
    docs: {
      description: {
        story:
          "Phase δ: Atom 間の dimensional 関係（axial coding）。`relatedAtoms` を派生元の折り畳み内に表示する。関係種別（extends / shares-mechanism / contradicts / applies-to-different-domain など）を controllable な fixed vocabulary で示し、citation で 1 文の関係説明を添える。Synthesizer の analogical / dialectic ペア選択シグナルとしても使われる。",
      },
    },
  },
  render: () => (
    <Wrapper
      noteIndex={sampleNoteIndex}
      wikiMeta={{
        ...baseMeta,
        kind: "atom",
        atomType: "mechanistic",
        derivedFromNotes: ["note-abc123"],
        relatedAtoms: [
          {
            atomId: "atom-grain-001",
            relationType: "shares-mechanism",
            citation: "両方とも拡散律速で説明される粒成長の系。",
          },
          {
            atomId: "atom-polymer-003",
            relationType: "applies-to-different-domain",
            citation: "セラミックの粒成長と高分子の架橋成長は同じ τ^{1/3} スケーリングを示す。",
          },
          {
            atomId: "atom-missing-relation-999",
            relationType: "contradicts",
            citation: "凝集律速説と一致しないデータが報告されている。",
          },
        ],
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

// ── D2 配置: 「同じ世界事実に接続した洞察」（grounding edge） ──
// 本文下の context drawer に展開される。常時開なので、上に置くと縦を強く圧迫していた。
const GROUNDING_SIBLINGS: Map<string, WikiMetaSummary> = new Map([
  [
    "claim-sib-1",
    {
      title: "Ti 置換は Al3V のパワーファクターと zT を向上させる",
      kind: "claim",
      groundingValidity: { entryId: "gen-world-fact-001" },
    },
  ],
  [
    "claim-sib-2",
    {
      title: "Ti・Nb・Si 合金化は格子散乱を増やし熱伝導率を下げる",
      kind: "claim",
      groundingValidity: { entryId: "gen-world-fact-001" },
    },
  ],
  [
    "atom-sib-3",
    {
      title: "少量の添加元素は格子散乱を増やし熱伝導率を低下させる",
      kind: "atom",
      groundingValidity: { entryId: "gen-world-fact-001" },
    },
  ],
  // 別 entryId（出てこないはず）
  [
    "claim-other",
    {
      title: "無関係な世界事実に繋がる Claim",
      kind: "claim",
      groundingValidity: { entryId: "gen-world-fact-999" },
    },
  ],
]);

export const GroundingEdges: StoryObj = {
  name: "D2: 同じ世界事実に接続した洞察（本文下ドロワー）",
  parameters: {
    docs: {
      description: {
        story:
          "同じ `grounding.validity.entryId`（＝同じ世界事実）に接続した他の洞察を、本文の下に列挙する。D2 配置の主目的: 常時展開のこのリストが本文を押し下げていたのを解消する。identity は本文上、関連洞察は本文下、という非対称配置を確認するためのストーリー。",
      },
    },
  },
  render: () => (
    <Wrapper
      mockTitle="Al3V の 5% 合金化はフォノン散乱を増やして熱伝導率を下げる"
      wikiId="claim-current"
      allWikiMetas={GROUNDING_SIBLINGS}
      wikiMeta={{
        ...baseMeta,
        kind: "claim",
        claimRole: ["finding"],
        epistemicStatus: "observation",
        grounding: {
          validity: {
            verdict: "supported",
            score: 0.6,
            checkedBy: "distilled-kb@v1",
            checkedAt: "2026-06-20T10:00:00Z",
            entryId: "gen-world-fact-001",
            rationale: "固溶体散乱の標準的な筋書きと整合する",
          },
        },
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

