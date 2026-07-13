// Wiki ドキュメント用バナー
// エディタ上部に表示: AI 生成バッジ、アクションボタン

import { useMemo, useState } from "react";
import {
  RefreshCw,
  Trash2,
  ChevronDown,
  Archive,
  RotateCcw,
  Globe2,
  HelpCircle,
  Lightbulb,
  Eye,
  ShieldCheck,
  BookOpen,
  ExternalLink,
  Link as LinkIcon,
  AlertTriangle,
  Sparkles,
  BadgeCheck,
} from "lucide-react";
import type {
  AtomRelation,
  AtomShape,
  BackingEntry,
  EpistemicStatus,
  GroundingValidityVerdict,
  ModalQualifier,
  ProcedureContext,
  ShapeFamily,
  SynthesisMode,
  WikiMeta,
  WikiMetaSummary,
} from "../../lib/document-types";
import { resolveShapeFamily } from "../../lib/document-types";
import type { GraphiumIndex, NoteIndexEntry } from "../navigation/index-file";
import type { MediaIndex } from "../asset-browser/media-index";
import { parseExternalSource } from "../network-graph/external-source";
import { useT } from "../../i18n";
import { SynthesisModeModal } from "./SynthesisModeModal";

function TypeBadge({
  label,
  title,
  onClick,
}: {
  label: string;
  title?: string;
  onClick?: () => void;
}) {
  const interactive = Boolean(onClick);
  const baseStyle = {
    display: "inline-flex",
    alignItems: "center",
    padding: "1px 8px",
    borderRadius: "var(--pill)",
    background: "var(--paper)",
    border: "1px solid var(--rule)",
    color: "var(--ink-2)",
    fontSize: 12,
    lineHeight: 1.4,
    fontWeight: 500,
  } as const;

  if (interactive) {
    return (
      <button
        type="button"
        title={title}
        onClick={onClick}
        style={{
          ...baseStyle,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        {label}
      </button>
    );
  }
  return (
    <span title={title} style={baseStyle}>
      {label}
    </span>
  );
}

type Props = {
  wikiMeta: WikiMeta;
  /** 再生成。モデルは設定（Default / Chat & Synthesis）に従う — UI で個別選択させない */
  onRegenerate: () => void;
  onDelete: () => void;
  loading?: boolean;
  /** アーカイブ済みフラグ。true のとき編集系ボタンを抑制し、復元 UI を出す */
  archived?: boolean;
  /** アーカイブから復元するハンドラ（archived === true のときのみ有効） */
  onRestoreFromArchive?: () => void;
  /**
   * 世界モデル照合トリガ（world-model-grounding Phase 2 / PR 2A）。
   * 押されると蒸留 KB と照合し、verdict バッジを更新する想定。
   * 未指定時はボタンを出さない（grounding 未対応のコンテキスト用）。
   */
  onCheckWorldValidity?: () => void;
  /** 照合中。ボタンを disable してスピナー的に表示する。 */
  worldCheckLoading?: boolean;
  // 関連・文脈系の props（noteIndex / mediaIndex / onNavigateNote /
  // onClearWorldValidity / wikiId / allWikiMetas）は D2 配置で WikiContextDrawer
  // に移した。WikiBanner は identity（バッジ＋アクション）だけを担う。
};

function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function WikiBanner({
  wikiMeta,
  onRegenerate,
  onDelete,
  loading = false,
  archived = false,
  onRestoreFromArchive,
  onCheckWorldValidity,
  worldCheckLoading = false,
}: Props) {
  const t = useT();
  const kindLabel =
    wikiMeta.kind === "summary" ? t("wikiList.kindSummary")
    : wikiMeta.kind === "synthesis" ? t("wikiList.kindSynthesis")
    : wikiMeta.kind === "atom" ? t("wikiList.kindAtom")
    : t("wikiList.kindClaim");

  const [modeModal, setModeModal] = useState<SynthesisMode | null>(null);

  // 2026-05-22: D1 配置（透過 + 下 dashed）は右パネル展開時に視覚的な
  // 一体感が崩れたため、従来のカード型に戻す。将来 D2 配置を検討する。
  const containerStyle = {
    margin: "14px 32px 6px",
    borderRadius: "var(--r-3)",
    border: "1px solid var(--rule)",
    background: archived ? "var(--paper-3)" : "var(--paper-2)",
    padding: "10px 14px",
  };

  return (
    <div style={containerStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {/* AI バッジ — 緑の AI マーカーで「AI 生成」をアンカリングし、ピル外枠は控えめに */}
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
            lineHeight: 1.4,
            fontWeight: 500,
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
              fontFamily: "var(--mono)",
              fontWeight: 500,
              letterSpacing: "0.04em",
              flexShrink: 0,
            }}
          >
            AI
          </span>
          {kindLabel}
        </span>

        {/* 意味的な型のバッジ（提案 v4 Phase 1）— 推定できているときのみ表示。
            hypothesisStatus は UI フロー未整備のためバナーには出さない（データは保持）。 */}
        {wikiMeta.kind === "claim" && wikiMeta.claimRole?.map((role) => (
          <TypeBadge
            key={role}
            label={t(`wikiTypes.claimRole.${role}` as any)}
            title={t(`wikiTypes.claimRole.${role}` as any)}
          />
        ))}
        {wikiMeta.kind === "atom" && wikiMeta.atomType && (
          <TypeBadge
            label={t(`wikiTypes.atomType.${wikiMeta.atomType}` as any)}
            title={t(`wikiTypes.atomType.${wikiMeta.atomType}` as any)}
          />
        )}
        {wikiMeta.kind === "synthesis" && wikiMeta.synthesisMode && (
          <TypeBadge
            label={t(`wikiTypes.synthesisMode.${wikiMeta.synthesisMode}` as any)}
            title={t("synthesisMode.modal.learnMore" as any)}
            onClick={() => setModeModal(wikiMeta.synthesisMode ?? null)}
          />
        )}

        {/* 生成日 */}
        <span style={{ fontSize: 12, lineHeight: 1.4, color: "var(--ink-3)" }}>
          {formatDate(wikiMeta.generatedAt)}
        </span>

        {/* モデル名 */}
        {wikiMeta.generatedBy?.model && (
          <span
            style={{
              fontSize: 12,
              lineHeight: 1.4,
              color: "var(--ink-4)",
              fontFamily: "var(--mono)",
            }}
          >
            {wikiMeta.generatedBy.model}
          </span>
        )}

        {/* 信頼度チップ（Synthesis 等で誤差伝搬の指標として表示） */}
        {typeof wikiMeta.confidence === "number" && (
          <span
            title="Self-rated confidence at generation. Lower values mean upstream evidence was thin or conflicting."
            style={{
              fontSize: 12,
              lineHeight: 1.4,
              padding: "1px 8px",
              borderRadius: "var(--pill)",
              border: "1px solid var(--rule)",
              background: "var(--paper)",
              color:
                wikiMeta.confidence >= 0.85
                  ? "var(--forest-ink)"
                  : wikiMeta.confidence >= 0.7
                    ? "var(--ink-3)"
                    : "var(--ember, #b54708)",
              fontFamily: "var(--mono)",
            }}
          >
            conf {wikiMeta.confidence.toFixed(2)}
          </span>
        )}

        {/* 世界モデル照合の verdict バッジ（Phase 2 / PR 2A）。
            別レーン: epistemicStatus / hypothesisStatus には影響しない。
            checkedAt があって verdict なしのときも「照合済み / マッチなし」を薄く表示する
            （UX フィードバック: ボタン押下→何も起きないように見える事故を防ぐ）。 */}
        {wikiMeta.grounding?.validity?.verdict ? (
          <WorldVerdictBadge validity={wikiMeta.grounding.validity} />
        ) : wikiMeta.grounding?.validity?.checkedAt ? (
          <WorldCheckedNoMatchBadge validity={wikiMeta.grounding.validity} />
        ) : null}

        {/* Phase η: epistemicStatus バッジ — claim だけでなく atom / synthesis にも出す。
            Atomizer / Synthesizer が最低継承で値を引き継ぐ設計（document-types.ts）なので、
            wiki kind を問わず情報があるなら一目で読めるようにする。 */}
        {wikiMeta.epistemicStatus && (
          <EpistemicStatusBadge status={wikiMeta.epistemicStatus} />
        )}

        {/* Claim の corroboration バッジ — 複数の独立したノートが依拠して
            candidate → verified に昇格した claim にのみ出す。candidate は
            表示しない（概念過多を避ける段階的開示）。世界照合 verdict や
            epistemicStatus とは別レーン（DATA_MODEL.md §3.2）。 */}
        {wikiMeta.kind === "claim" && wikiMeta.status === "verified" && (
          <CorroboratedBadge />
        )}

        {/* Phase γ: modalQualifier バッジ — claim のみ（document-types.ts でも claim 専用）。
            system confidence とは別軸であることを Sparkles アイコン + italic で示唆。 */}
        {wikiMeta.kind === "claim" && wikiMeta.modalQualifier && (
          <ModalQualifierBadge qualifier={wikiMeta.modalQualifier} />
        )}

        {archived && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "1px 8px",
              borderRadius: "var(--pill)",
              background: "var(--paper)",
              border: "1px solid var(--rule)",
              color: "var(--ink-3)",
              fontSize: 12,
              lineHeight: 1.4,
              fontWeight: 500,
            }}
            title={t("archive.archivedHint")}
          >
            <Archive size={12} />
            {t("archive.archivedBadge")}
          </span>
        )}

        <div style={{ flex: 1 }} />

        {/* アクションボタン */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {archived && onRestoreFromArchive && (
            <button
              onClick={onRestoreFromArchive}
              disabled={loading}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 8px",
                borderRadius: "var(--r-1)",
                border: "1px solid var(--rule)",
                background: "var(--paper)",
                color: "var(--ink-2)",
                fontSize: 11,
                cursor: "pointer",
                opacity: loading ? 0.5 : 1,
              }}
              title={t("archive.restoreHint")}
            >
              <RotateCcw size={12} />
              {t("archive.restore")}
            </button>
          )}
          {!archived && (
          <>
          {/* 世界照合（Phase 2 / PR 2A）— 蒸留KB 突き合わせ。LLM 呼び出しなし。 */}
          {onCheckWorldValidity && (
            <button
              onClick={onCheckWorldValidity}
              disabled={loading || worldCheckLoading}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 8px",
                borderRadius: "var(--r-1)",
                border: "1px dashed var(--rule)",
                background: "var(--paper)",
                color: "var(--ink-2)",
                fontSize: 11,
                cursor: "pointer",
                opacity: loading || worldCheckLoading ? 0.5 : 1,
              }}
              title={t("wikiBanner.worldCheckHint")}
            >
              <Globe2 size={12} />
              {t("wikiBanner.worldCheck")}
            </button>
          )}

          {/* Regenerate — モデルは設定（Default / Chat & Synthesis）に従う */}
          <button
            onClick={onRegenerate}
            disabled={loading}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 8px",
              borderRadius: "var(--r-1)",
              border: "1px solid var(--rule)",
              background: "var(--paper)",
              color: "var(--ink-2)",
              fontSize: 11,
              cursor: "pointer",
              opacity: loading ? 0.5 : 1,
            }}
            title={t("wikiBanner.regenerateHint")}
          >
            <RefreshCw size={12} />
            {t("wikiBanner.regenerate")}
          </button>

          {/* Delete */}
          <button
            onClick={onDelete}
            disabled={loading}
            style={{
              padding: "4px 7px",
              borderRadius: "var(--r-1)",
              border: "none",
              background: "transparent",
              color: "var(--ink-3)",
              cursor: "pointer",
              opacity: loading ? 0.5 : 1,
              display: "inline-flex",
              alignItems: "center",
            }}
            title="Delete"
          >
            <Trash2 size={13} />
          </button>
          </>
          )}
        </div>
      </div>

      {/* 関連・文脈セクション（手順条件 / 派生元 / 世界照合詳細 / 同じ世界事実に接続した洞察 /
          Backing / Rebuttal）は D2 配置で本文下の WikiContextDrawer に移動した。
          identity（種別・確信度・世界照合バッジ＋アクション）だけを本文上に残す。 */}

      {/* Synthesis モード説明モーダル（Phase 5.4） */}
      <SynthesisModeModal
        open={modeModal !== null}
        mode={modeModal}
        onClose={() => setModeModal(null)}
      />
    </div>
  );
}

/**
 * WikiContextDrawer — D2 配置で本文「下」に展開する関連・文脈セクション群。
 * identity（WikiBanner）と対になり、「読んだ後に辿る」情報をまとめる:
 * 手順条件 / 派生元 / 世界照合 詳細 / 同じ世界事実に接続した洞察 / Backing / Rebuttal。
 *
 * これらは本文の上にあると縦の圧迫が強く、特に「同じ世界事実に接続した洞察」は
 * 常時展開なので本文を大きく押し下げていた。Wikipedia の「関連項目 / 出典」と同じく
 * 本文の後ろに置くのが情報アーキテクチャ的に自然、という判断（2026-06 D2 配置）。
 *
 * 表示すべきセクションが 1 つも無ければ null を返し、本文下に空の divider だけが
 * 出る事故を防ぐ（GroundingEdgesSection は siblings 0 件で null を返すため、
 * ここでも siblings 有無を先に数える）。
 */
export function WikiContextDrawer({
  wikiMeta,
  noteIndex,
  mediaIndex,
  onNavigateNote,
  onClearWorldValidity,
  wikiId,
  allWikiMetas,
  archived = false,
}: {
  wikiMeta: WikiMeta;
  noteIndex?: GraphiumIndex | null;
  mediaIndex?: MediaIndex | null;
  onNavigateNote?: (noteId: string) => void;
  onClearWorldValidity?: () => void;
  wikiId?: string;
  allWikiMetas?: Map<string, WikiMetaSummary>;
  archived?: boolean;
}) {
  const entryId = wikiMeta.grounding?.validity?.entryId;
  const hasGroundingSiblings = (() => {
    if (!entryId || !allWikiMetas) return false;
    for (const [id, m] of allWikiMetas) {
      if (id === wikiId) continue;
      if (m.groundingValidity?.entryId === entryId) return true;
    }
    return false;
  })();

  const showProcedure =
    wikiMeta.kind === "claim" &&
    !!wikiMeta.procedureContext &&
    hasProcedureContextContent(wikiMeta.procedureContext);
  const showDerivedFrom = hasDerivedFrom(wikiMeta);
  const showWorldDetail = !!wikiMeta.grounding?.validity?.checkedAt;
  const showBacking =
    wikiMeta.kind === "claim" && !!wikiMeta.backing && wikiMeta.backing.length > 0;
  const showRebuttal =
    !!wikiMeta.rebuttalConditions && wikiMeta.rebuttalConditions.length > 0;
  // Atom の構造の形（shape）。バッジで identity 層に出すと情報過多になるため、
  // 世界照合・派生元などと同じ context drawer 下部に控えめなテキストで置く。
  // transfer（越境転移）は表示しない — 「別分野への越境」を発想するのはユーザーの
  // 創造的な仕事であり、AI が先回りして示すとアンカリングになる。データは保持し、
  // 将来の発想（Idea）レイヤ（人間トリガー）で使う。
  const showAtomShape = wikiMeta.kind === "atom" && !!wikiMeta.shape;

  const hasAny =
    showProcedure ||
    showDerivedFrom ||
    showWorldDetail ||
    hasGroundingSiblings ||
    showBacking ||
    showRebuttal ||
    showAtomShape;
  if (!hasAny) return null;

  return (
    <div
      style={{
        marginTop: 28,
        paddingTop: 16,
        borderTop: "1px solid var(--rule)",
        opacity: archived ? 0.85 : 1,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {showProcedure && (
        <ProcedureContextSection ctx={wikiMeta.procedureContext!} />
      )}
      {showDerivedFrom && (
        <DerivedFromSection
          wikiMeta={wikiMeta}
          noteIndex={noteIndex ?? null}
          mediaIndex={mediaIndex ?? null}
          onNavigateNote={onNavigateNote}
        />
      )}
      {showWorldDetail && (
        <WorldGroundingDetailSection
          validity={wikiMeta.grounding!.validity!}
          onClear={onClearWorldValidity}
        />
      )}
      {entryId && allWikiMetas && (
        <GroundingEdgesSection
          entryId={entryId}
          currentWikiId={wikiId}
          allWikiMetas={allWikiMetas}
          onNavigateNote={onNavigateNote}
        />
      )}
      {showAtomShape && (
        <AtomShapeSection shape={wikiMeta.shape!} shapeFamily={wikiMeta.shapeFamily} />
      )}
      {showBacking && <BackingSection backing={wikiMeta.backing!} />}
      {showRebuttal && (
        <RebuttalConditionsSection conditions={wikiMeta.rebuttalConditions!} />
      )}
    </div>
  );
}

// Atom の構造の形（shape）— バッジにせず、世界照合・派生元と同じ context drawer に
// 「構造の形」ラベル + 平易語の 1 行で控えめに置く。backing / rebuttal と同じ neutral な
// dashed トーンに揃える。transfer はここには出さない（越境の発想はユーザーの仕事）。
function AtomShapeSection({
  shape,
  shapeFamily,
}: {
  shape: AtomShape;
  shapeFamily?: ShapeFamily;
}) {
  const t = useT();
  // family は保存があればそれを、無ければ form から決定論導出（既存 atom も表示できる）。
  const family = resolveShapeFamily(shape, shapeFamily);
  return (
    <div
      style={{
        marginTop: 6,
        padding: "6px 10px",
        borderRadius: "var(--r-2)",
        background: "var(--paper)",
        border: "1px dashed var(--rule)",
        fontSize: 14,
        lineHeight: 1.55,
        color: "var(--ink-2)",
        display: "flex",
        alignItems: "baseline",
        gap: 6,
      }}
    >
      <span style={{ color: "var(--ink-4)", fontWeight: 500, flexShrink: 0 }}>
        {t("wikiBanner.shapeTitle")}
      </span>
      <span>
        {family && family !== "other" && (
          <span style={{ color: "var(--ink-4)" }}>
            {t(`wikiTypes.shapeFamily.${family}` as any)}
            <span style={{ margin: "0 4px" }}>›</span>
          </span>
        )}
        {t(`wikiTypes.atomShape.${shape}` as any)}
      </span>
    </div>
  );
}

// 世界モデル照合 verdict バッジ（Phase 2 / PR 2A）。
// 色は既存パレットに揃え、confidence チップと並ぶ高さで控えめに表示する。
// verdict 別の意味は kickoff §1.1 を参照。i18n は wikiBanner.worldVerdict.* / worldCheckedBy / worldRationale。
function WorldVerdictBadge({
  validity,
}: {
  validity: NonNullable<NonNullable<WikiMeta["grounding"]>["validity"]>;
}) {
  const t = useT();
  const verdict = validity.verdict as GroundingValidityVerdict;
  const palette: Record<
    GroundingValidityVerdict,
    { color: string; bg: string; border: string }
  > = {
    established: {
      color: "var(--forest-ink)",
      bg: "var(--forest-soft, var(--paper))",
      border: "var(--forest, var(--rule))",
    },
    supported: {
      color: "var(--forest-ink)",
      bg: "var(--paper)",
      border: "var(--forest, var(--rule))",
    },
    weak: {
      color: "var(--amber-ink, #b45309)",
      bg: "var(--amber-soft, var(--paper))",
      border: "var(--amber, var(--rule))",
    },
    contested: {
      color: "var(--ember, #b54708)",
      bg: "var(--paper)",
      border: "var(--ember, var(--rule))",
    },
  };
  const p = palette[verdict];
  const label = t(`wikiBanner.worldVerdict.${verdict}` as any);
  const checkedBy = validity.checkedBy ?? "";
  const checkedAt = validity.checkedAt
    ? new Date(validity.checkedAt).toLocaleString()
    : "";
  const rationale = validity.rationale ?? "";
  // tooltip にすべての meta 情報を入れる（rationale → checkedBy → checkedAt）
  const titleParts: string[] = [`${t("wikiBanner.worldVerdictLabel")}: ${label}`];
  if (rationale) titleParts.push(`${t("wikiBanner.worldRationale")}: ${rationale}`);
  if (checkedBy) titleParts.push(`${t("wikiBanner.worldCheckedBy")}: ${checkedBy}`);
  if (checkedAt) titleParts.push(checkedAt);
  return (
    <span
      title={titleParts.join("\n")}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "1px 8px",
        borderRadius: "var(--pill)",
        border: `1px solid ${p.border}`,
        background: p.bg,
        color: p.color,
        fontSize: 12,
        lineHeight: 1.4,
        fontWeight: 500,
      }}
    >
      <Globe2 size={11} />
      {label}
    </span>
  );
}

// 世界照合 詳細セクション（PR 2A）。
// バッジが verdict だけを示すのに対して、こちらは「なぜそう判定したか」を読める。
// 派生元セクションと同じ折り畳みトーン（dashed border / デフォルト閉）。
function WorldGroundingDetailSection({
  validity,
  onClear,
}: {
  validity: NonNullable<NonNullable<WikiMeta["grounding"]>["validity"]>;
  onClear?: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const verdict = validity.verdict;
  const verdictLabel = verdict
    ? t(`wikiBanner.worldVerdict.${verdict}` as any)
    : t("wikiBanner.worldNoMatch");
  const checkedAt = validity.checkedAt
    ? new Date(validity.checkedAt).toLocaleString()
    : "";
  const checkedBy = validity.checkedBy ?? "";
  const sources = validity.sources ?? [];
  const matched = validity.matchedKeywords ?? [];
  // PR 2A は KB の keywords がヒットしたかどうかの「件数」を見せる。
  // %（score） は KB entry の keywords 総数に依存して見え方が変わるので、誤解防止のため
  // バッジ脇には出さない。score は型として保持（PR 2B 以降の LLM 評価で再利用予定）。
  return (
    <div
      style={{
        marginTop: 6,
        padding: open ? "6px 10px 8px" : "4px 10px",
        borderRadius: "var(--r-2)",
        background: "var(--paper)",
        border: "1px dashed var(--rule)",
        fontSize: 14,
        lineHeight: 1.55,
        color: "var(--ink-2)",
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "1px 4px",
          margin: 0,
          background: "transparent",
          border: "none",
          color: "var(--ink-2)",
          font: "inherit",
          cursor: "pointer",
        }}
        title={t("wikiBanner.worldDetailHint")}
      >
        <ChevronDown
          size={11}
          style={{
            transform: open ? "rotate(0)" : "rotate(-90deg)",
            transition: "transform 120ms",
          }}
        />
        <Globe2 size={11} />
        <span style={{ fontWeight: 500 }}>{t("wikiBanner.worldDetailTitle")}</span>
        <span style={{ color: "var(--ink-4)", fontWeight: 400 }}>· {verdictLabel}</span>
        {matched.length > 0 && (
          <span
            style={{ color: "var(--ink-4)", fontWeight: 400 }}
            title={t("wikiBanner.worldMatchedKeywordsHint")}
          >
            · {t("wikiBanner.worldMatchedKeywordsCount", {
              count: String(matched.length),
            })}
          </span>
        )}
      </button>
      {open && (
        <div style={{ marginTop: 4, lineHeight: 1.55 }}>
          {validity.rationale && (
            <div>
              <span style={{ color: "var(--ink-3)" }}>
                {t("wikiBanner.worldRationale")}:{" "}
              </span>
              {validity.rationale}
            </div>
          )}
          {matched.length > 0 && (
            <div>
              <span style={{ color: "var(--ink-3)" }}>
                {t("wikiBanner.worldMatchedKeywords")}:{" "}
              </span>
              {matched.map((kw, i) => (
                <span key={kw + i}>
                  {i > 0 && <span style={{ color: "var(--ink-4)" }}>, </span>}
                  <code
                    style={{
                      fontFamily: "var(--mono)",
                      background: "var(--paper-2, var(--paper))",
                      padding: "0 4px",
                      borderRadius: 2,
                    }}
                  >
                    {kw}
                  </code>
                </span>
              ))}
            </div>
          )}
          {sources.length > 0 && (
            <div>
              <span style={{ color: "var(--ink-3)" }}>
                {t("wikiBanner.worldSources")}:{" "}
              </span>
              {sources.map((s, i) => (
                <span key={i}>
                  {i > 0 && <span style={{ color: "var(--ink-4)" }}>; </span>}
                  {s.url ? (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: "var(--forest-ink, var(--ink-2))",
                        textDecoration: "underline",
                        textDecorationStyle: "dotted",
                      }}
                      title={s.url}
                    >
                      {s.ref}
                    </a>
                  ) : (
                    <span>{s.ref}</span>
                  )}
                  {s.note && (
                    <span style={{ color: "var(--ink-4)" }}> ({s.note})</span>
                  )}
                </span>
              ))}
            </div>
          )}
          <div style={{ color: "var(--ink-4)", marginTop: 2 }}>
            {checkedBy && (
              <>
                {t("wikiBanner.worldCheckedBy")}: {checkedBy}
              </>
            )}
            {checkedBy && checkedAt && " · "}
            {checkedAt}
          </div>
          {/* このノートの照合結果をクリア。間違った verdict / 幻覚 URL が焼き付いたとき、
              再 Check を待たずに消せるようにする（KB キャッシュとは別に、ノート側に保存された
              validity を attachValidity(meta, undefined) で剥がす）。 */}
          {onClear && (
            <button
              onClick={onClear}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                marginTop: 6,
                padding: "2px 8px",
                background: "transparent",
                border: "1px solid var(--rule)",
                borderRadius: "var(--r-1)",
                color: "var(--ink-3)",
                font: "inherit",
                fontSize: 12,
                cursor: "pointer",
              }}
              title={t("wikiBanner.worldClearHint")}
            >
              <Trash2 size={11} />
              {t("wikiBanner.worldClear")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// 同じ世界事実（KB entryId）に接続した他の洞察を列挙するセクション（world-grounding edge）。
// 「世界事実そのもの」でなく「自分の探究が世界と触れた境界（エッジ）」を見せるのが狙い。
// siblings が 0 件なら何も描かない（エッジが 1 本もないなら見せる価値がない）。
function GroundingEdgesSection({
  entryId,
  currentWikiId,
  allWikiMetas,
  onNavigateNote,
}: {
  entryId: string;
  currentWikiId?: string;
  allWikiMetas: Map<string, WikiMetaSummary>;
  onNavigateNote?: (noteId: string) => void;
}) {
  const t = useT();
  const siblings = useMemo(() => {
    const out: { id: string; title: string }[] = [];
    for (const [id, m] of allWikiMetas) {
      if (id === currentWikiId) continue;
      if (m.groundingValidity?.entryId === entryId) {
        out.push({ id, title: m.title });
      }
    }
    return out;
  }, [allWikiMetas, currentWikiId, entryId]);

  if (siblings.length === 0) return null;

  return (
    <div
      style={{
        marginTop: 6,
        padding: "6px 10px 8px",
        borderRadius: "var(--r-2)",
        background: "var(--paper)",
        border: "1px dashed var(--rule)",
        fontSize: 14,
        lineHeight: 1.55,
        color: "var(--ink-2)",
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontWeight: 500,
          marginBottom: 4,
        }}
        title={t("wikiBanner.worldEdgesHint")}
      >
        <Globe2 size={11} />
        <span>
          {t("wikiBanner.worldEdgesTitle", { count: String(siblings.length) })}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {siblings.map((s) => (
          <div key={s.id}>
            {onNavigateNote ? (
              <button
                onClick={() => onNavigateNote(`wiki:${s.id}`)}
                style={{
                  padding: 0,
                  margin: 0,
                  background: "transparent",
                  border: "none",
                  color: "var(--forest-ink, var(--ink-2))",
                  font: "inherit",
                  textAlign: "left",
                  textDecoration: "underline",
                  textDecorationStyle: "dotted",
                  cursor: "pointer",
                }}
              >
                {s.title}
              </button>
            ) : (
              <span>{s.title}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// 「照合済み・マッチなし」薄表示。
// verdict は付かなかったが、照合は走った（checkedAt あり）状態を可視化する。
// バッジは ink-4 に近い色で、確定verdict バッジとは明確に違うトーン。
function WorldCheckedNoMatchBadge({
  validity,
}: {
  validity: NonNullable<NonNullable<WikiMeta["grounding"]>["validity"]>;
}) {
  const t = useT();
  const checkedAt = validity.checkedAt
    ? new Date(validity.checkedAt).toLocaleString()
    : "";
  const checkedBy = validity.checkedBy ?? "";
  const titleParts: string[] = [t("wikiBanner.worldNoMatchHint")];
  if (checkedBy) titleParts.push(`${t("wikiBanner.worldCheckedBy")}: ${checkedBy}`);
  if (checkedAt) titleParts.push(checkedAt);
  return (
    <span
      title={titleParts.join("\n")}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "1px 8px",
        borderRadius: "var(--pill)",
        border: "1px dashed var(--rule)",
        background: "var(--paper)",
        color: "var(--ink-4)",
        fontSize: 11,
        lineHeight: 1.4,
        fontWeight: 400,
      }}
    >
      <Globe2 size={10} />
      {t("wikiBanner.worldNoMatch")}
    </span>
  );
}

// 派生元セクションのヘルパー: derivedFromNotes / derivedFromClaims / Phase δ
// relatedAtoms のいずれかに有効な ID が 1 件でも含まれているかを判定する。
// （旧 Phase ε derivedFromAtoms は撤退済み）
function hasDerivedFrom(meta: WikiMeta): boolean {
  const notes = (meta.derivedFromNotes ?? []).filter((id) => Boolean(id));
  const claims = (meta.derivedFromClaims ?? []).filter((id) => Boolean(id));
  const relatedAtoms = (meta.relatedAtoms ?? []).filter((r) => Boolean(r.atomId));
  return (
    notes.length > 0 ||
    claims.length > 0 ||
    relatedAtoms.length > 0
  );
}

type DerivedFromEntry = {
  /** クリック時に渡す ID（wiki エントリの場合は "wiki:" プレフィックスを付ける） */
  navigateId: string;
  /** UI に出すラベル（タイトルが解けない場合は ID） */
  label: string;
  /** タイトルを index から解決できたか。false なら「不明」扱いの薄い表示にする */
  resolved: boolean;
  /** 外部ソース（pdf: / url: / document: / chat:）。ノート遷移ではなく素材表示扱いにする */
  external?: boolean;
};

// 外部ソース ID（pdf:/url:/document:/chat:）のラベルを mediaIndex から解決する。
// pdf / document は mediaFileId、url はブックマーク URL でメディアを引く。
function resolveExternalLabel(
  kind: string,
  key: string,
  mediaIndex: MediaIndex | null,
): string {
  if (kind === "chat") return "AI Chat";
  if (mediaIndex) {
    if (kind === "url") {
      const m = mediaIndex.media.find((e) => e.type === "url" && e.url === key);
      if (m) return m.name || key;
      return key;
    }
    // pdf / document は fileId 一致で引く
    const m = mediaIndex.media.find((e) => e.fileId === key);
    if (m) return m.name;
  }
  if (kind === "url") return key;
  const labelPrefix = kind === "pdf" ? "PDF" : "Document";
  return `${labelPrefix} ${key.slice(0, 8)}`;
}

function resolveDerivedEntries(
  ids: readonly string[] | undefined,
  noteIndex: GraphiumIndex | null,
  mediaIndex: MediaIndex | null = null,
): DerivedFromEntry[] {
  if (!ids || ids.length === 0) return [];
  // 同一 ID の重複登録は表示上 1 件にまとめる（順序は最初の出現を保つ）。
  const seen = new Set<string>();
  const entries: DerivedFromEntry[] = [];
  const indexById = new Map<string, NoteIndexEntry>();
  if (noteIndex) {
    for (const entry of noteIndex.notes) indexById.set(entry.noteId, entry);
  }
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    // 外部ソース（pdf:/url:/document:/chat:）は素材として名前解決する。
    // これを noteIndex 解決より先に分岐しないと「(不明)」になる。
    const ext = parseExternalSource(id);
    if (ext) {
      entries.push({
        navigateId: id,
        label: resolveExternalLabel(ext.kind, ext.key, mediaIndex),
        resolved: true,
        external: true,
      });
      continue;
    }
    const entry = indexById.get(id);
    if (entry) {
      const isWiki = entry.source === "ai";
      entries.push({
        navigateId: isWiki ? `wiki:${entry.noteId}` : entry.noteId,
        label: entry.title || entry.noteId,
        resolved: true,
      });
    } else {
      // index に存在しない場合はゴミ箱・別ストア・古いデータの可能性。
      // ナビゲートしてもエラーになりうるので、resolved=false でテキスト表示のみ。
      entries.push({ navigateId: id, label: id, resolved: false });
    }
  }
  return entries;
}

// Phase δ: relatedAtoms 用の解決エントリ。base = DerivedFromEntry に
// relationType / citation を上乗せして表示するための内部型。
type RelatedAtomEntry = DerivedFromEntry & {
  relationType: AtomRelation["relationType"];
  citation: string;
};

function resolveRelatedAtomEntries(
  relations: readonly AtomRelation[] | undefined,
  noteIndex: GraphiumIndex | null,
): RelatedAtomEntry[] {
  if (!relations || relations.length === 0) return [];
  // 同一 atomId 重複は表示上 1 件にまとめる（resolveDerivedEntries と同じ流儀）。
  const seen = new Set<string>();
  const out: RelatedAtomEntry[] = [];
  const indexById = new Map<string, NoteIndexEntry>();
  if (noteIndex) {
    for (const entry of noteIndex.notes) indexById.set(entry.noteId, entry);
  }
  for (const r of relations) {
    if (!r.atomId || seen.has(r.atomId)) continue;
    seen.add(r.atomId);
    const indexEntry = indexById.get(r.atomId);
    if (indexEntry) {
      const isWiki = indexEntry.source === "ai";
      out.push({
        navigateId: isWiki ? `wiki:${indexEntry.noteId}` : indexEntry.noteId,
        label: indexEntry.title || indexEntry.noteId,
        resolved: true,
        relationType: r.relationType,
        citation: r.citation,
      });
    } else {
      out.push({
        navigateId: r.atomId,
        label: r.atomId,
        resolved: false,
        relationType: r.relationType,
        citation: r.citation,
      });
    }
  }
  return out;
}

function DerivedFromSection({
  wikiMeta,
  noteIndex,
  mediaIndex,
  onNavigateNote,
}: {
  wikiMeta: WikiMeta;
  noteIndex: GraphiumIndex | null;
  mediaIndex: MediaIndex | null;
  onNavigateNote?: (noteId: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  // derivedFromNotes には pdf:/url:/document:/chat: の外部ソースが混ざるため mediaIndex を渡す。
  const noteEntries = useMemo(
    () => resolveDerivedEntries(wikiMeta.derivedFromNotes, noteIndex, mediaIndex),
    [wikiMeta.derivedFromNotes, noteIndex, mediaIndex],
  );
  // derivedFromClaims は wiki(claim) の素 ID のみ。外部ソースは入らない。
  const claimEntries = useMemo(
    () => resolveDerivedEntries(wikiMeta.derivedFromClaims, noteIndex),
    [wikiMeta.derivedFromClaims, noteIndex],
  );
  // Phase δ: Atom 間 dimensional 関係。relationType と citation を上乗せして表示する。
  const relatedAtomEntries = useMemo(
    () => resolveRelatedAtomEntries(wikiMeta.relatedAtoms, noteIndex),
    [wikiMeta.relatedAtoms, noteIndex],
  );

  if (
    noteEntries.length === 0 &&
    claimEntries.length === 0 &&
    relatedAtomEntries.length === 0
  )
    return null;

  const totalCount =
    noteEntries.length +
    claimEntries.length +
    relatedAtomEntries.length;

  return (
    <div
      style={{
        marginTop: 6,
        padding: open ? "6px 10px 8px" : "4px 10px",
        borderRadius: "var(--r-2)",
        background: "var(--paper)",
        border: "1px dashed var(--rule)",
        fontSize: 14,
        lineHeight: 1.55,
        color: "var(--ink-2)",
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "1px 4px",
          margin: 0,
          background: "transparent",
          border: "none",
          color: "var(--ink-2)",
          font: "inherit",
          cursor: "pointer",
        }}
        title={t("wikiBanner.derivedFromHint")}
      >
        <ChevronDown
          size={11}
          style={{
            transform: open ? "rotate(0)" : "rotate(-90deg)",
            transition: "transform 120ms",
          }}
        />
        <span style={{ fontWeight: 500 }}>{t("wikiBanner.derivedFromTitle")}</span>
        <span style={{ color: "var(--ink-4)", fontWeight: 400 }}>({totalCount})</span>
      </button>
      {open && (
        <div style={{ marginTop: 4, lineHeight: 1.55 }}>
          {noteEntries.length > 0 && (
            <DerivedFromGroup
              label={t("wikiBanner.derivedFromNotesLabel")}
              entries={noteEntries}
              onNavigateNote={onNavigateNote}
              missingLabel={t("wikiBanner.derivedFromMissing")}
            />
          )}
          {claimEntries.length > 0 && (
            <DerivedFromGroup
              label={t("wikiBanner.derivedFromClaimsLabel")}
              entries={claimEntries}
              onNavigateNote={onNavigateNote}
              missingLabel={t("wikiBanner.derivedFromMissing")}
            />
          )}
          {/* Phase δ: Atom 間 dimensional 関係。relationType + citation を含めて
              読めるよう独自のグループで描画する（0-3 件）。 */}
          {relatedAtomEntries.length > 0 && (
            <RelatedAtomsGroup
              label={t("wikiBanner.relatedAtomsLabel")}
              entries={relatedAtomEntries}
              onNavigateNote={onNavigateNote}
              missingLabel={t("wikiBanner.derivedFromMissing")}
            />
          )}
        </div>
      )}
    </div>
  );
}

// Phase δ: Atom 間 dimensional 関係（axial coding）の表示グループ。
// 1 件ずつ「関係種別ピル + リンク + citation」を縦に並べる。
// DerivedFromGroup と違って citation が文として表示されるので、件数が 3 件しか
// 来ない quality-over-quantity ルールに対して読みやすさを優先する。
function RelatedAtomsGroup({
  label,
  entries,
  onNavigateNote,
  missingLabel,
}: {
  label: string;
  entries: RelatedAtomEntry[];
  onNavigateNote?: (noteId: string) => void;
  missingLabel: string;
}) {
  const t = useT();
  return (
    <div style={{ marginTop: 4 }}>
      <span style={{ color: "var(--ink-3)" }}>{label}: </span>
      <div style={{ marginTop: 2, display: "flex", flexDirection: "column", gap: 4 }}>
        {entries.map((entry, i) => {
          const relationLabel = t(
            `wikiTypes.atomRelation.${entry.relationType}` as never,
          );
          return (
            <div
              key={entry.navigateId + i}
              style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "baseline" }}
            >
              <span
                style={{
                  display: "inline-flex",
                  padding: "0 6px",
                  borderRadius: "var(--pill)",
                  background: "var(--paper)",
                  border: "1px solid var(--rule)",
                  color: "var(--ink-3)",
                  fontSize: 11,
                  lineHeight: 1.6,
                  whiteSpace: "nowrap",
                }}
                title={t("wikiBanner.relatedAtomsHint")}
              >
                {relationLabel}
              </span>
              {entry.resolved && onNavigateNote ? (
                <button
                  type="button"
                  onClick={() => onNavigateNote(entry.navigateId)}
                  style={{
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    margin: 0,
                    color: "var(--forest-ink, var(--ink-2))",
                    font: "inherit",
                    textDecoration: "underline",
                    textDecorationStyle: "dotted",
                    textDecorationColor: "var(--rule)",
                    cursor: "pointer",
                  }}
                  title={entry.label}
                >
                  {entry.label}
                </button>
              ) : entry.resolved ? (
                <span>{entry.label}</span>
              ) : (
                <span
                  style={{ color: "var(--ink-4)", fontStyle: "italic" }}
                  title={entry.navigateId}
                >
                  {missingLabel}
                </span>
              )}
              {entry.citation && (
                <span style={{ color: "var(--ink-3)", fontSize: 13 }}>
                  — {entry.citation}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DerivedFromGroup({
  label,
  entries,
  onNavigateNote,
  missingLabel,
}: {
  label: string;
  entries: DerivedFromEntry[];
  onNavigateNote?: (noteId: string) => void;
  missingLabel: string;
}) {
  return (
    <div>
      <span style={{ color: "var(--ink-3)" }}>{label}: </span>
      {entries.map((entry, i) => (
        <span key={entry.navigateId + i}>
          {i > 0 && <span style={{ color: "var(--ink-4)" }}>, </span>}
          {entry.external ? (
            // 外部ソース（Word/PDF/URL/チャット）は素材名をテキストで示す。
            // 深い系譜・素材を開く操作は右パネルの来歴タブが担う。
            <span title={entry.label}>{entry.label}</span>
          ) : entry.resolved && onNavigateNote ? (
            <button
              type="button"
              onClick={() => onNavigateNote(entry.navigateId)}
              style={{
                background: "transparent",
                border: "none",
                padding: 0,
                margin: 0,
                color: "var(--forest-ink, var(--ink-2))",
                font: "inherit",
                textDecoration: "underline",
                textDecorationStyle: "dotted",
                textDecorationColor: "var(--rule)",
                cursor: "pointer",
              }}
              title={entry.label}
            >
              {entry.label}
            </button>
          ) : entry.resolved ? (
            <span>{entry.label}</span>
          ) : (
            <span
              style={{ color: "var(--ink-4)", fontStyle: "italic" }}
              title={entry.navigateId}
            >
              {missingLabel}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

// 手順条件のサブセクション。デフォルトで折り畳み。
function hasProcedureContextContent(ctx: ProcedureContext): boolean {
  return Boolean(
    ctx.protocolFingerprint ||
      (ctx.keyParameters && ctx.keyParameters.length > 0) ||
      (ctx.keyTools && ctx.keyTools.length > 0) ||
      ctx.validityRange,
  );
}

function ProcedureContextSection({ ctx }: { ctx: ProcedureContext }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  return (
    <div
      style={{
        marginTop: 6,
        padding: open ? "6px 10px 8px" : "4px 10px",
        borderRadius: "var(--r-2)",
        background: "var(--paper)",
        border: "1px dashed var(--rule)",
        fontSize: 14,
        lineHeight: 1.55,
        color: "var(--ink-2)",
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "1px 4px",
          margin: 0,
          background: "transparent",
          border: "none",
          color: "var(--ink-2)",
          font: "inherit",
          cursor: "pointer",
        }}
        title={t("wikiBanner.procedureContextHint")}
      >
        <ChevronDown size={11} style={{ transform: open ? "rotate(0)" : "rotate(-90deg)", transition: "transform 120ms" }} />
        <span style={{ fontWeight: 500 }}>{t("wikiBanner.procedureContextTitle")}</span>
      </button>
      {open && (
        <div style={{ marginTop: 4, lineHeight: 1.55 }}>
          {ctx.protocolFingerprint && (
            <div>
              <span style={{ color: "var(--ink-3)" }}>{t("wikiBanner.procedureProtocol")}: </span>
              {ctx.protocolFingerprint}
            </div>
          )}
          {ctx.keyTools && ctx.keyTools.length > 0 && (
            <div>
              <span style={{ color: "var(--ink-3)" }}>{t("wikiBanner.procedureTools")}: </span>
              {ctx.keyTools.join(", ")}
            </div>
          )}
          {ctx.keyParameters && ctx.keyParameters.length > 0 && (
            <div>
              <span style={{ color: "var(--ink-3)" }}>{t("wikiBanner.procedureParameters")}: </span>
              {ctx.keyParameters.map((p, i) => (
                <span key={p.name + i}>
                  {i > 0 && ", "}
                  {p.name}={p.value}
                  <span style={{ color: "var(--ink-4)", fontSize: 10 }}> ({p.necessity})</span>
                </span>
              ))}
            </div>
          )}
          {ctx.validityRange && (
            <div>
              <span style={{ color: "var(--ink-3)" }}>{t("wikiBanner.procedureValidity")}: </span>
              {ctx.validityRange}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// Phase η: epistemicStatus を控えめなピルで表示する。
// 段階順: speculation < interpretation < observation < established。
// アイコンと色相で「地に足が付く度合い」を視覚化する（amber → sky → forest 系）。
// ──────────────────────────────────────────────
function EpistemicStatusBadge({ status }: { status: EpistemicStatus }) {
  const t = useT();
  const palette: Record<
    EpistemicStatus,
    { color: string; bg: string; border: string; Icon: typeof HelpCircle }
  > = {
    speculation: {
      color: "var(--amber-ink, #b45309)",
      bg: "var(--amber-soft, var(--paper))",
      border: "var(--amber, var(--rule))",
      Icon: HelpCircle,
    },
    interpretation: {
      color: "var(--sky-ink, var(--ink-2))",
      bg: "var(--sky-soft, var(--paper))",
      border: "var(--sky, var(--rule))",
      Icon: Lightbulb,
    },
    observation: {
      color: "var(--forest-ink)",
      bg: "var(--paper)",
      border: "var(--forest, var(--rule))",
      Icon: Eye,
    },
    established: {
      color: "var(--forest-ink)",
      bg: "var(--forest-soft, var(--paper))",
      border: "var(--forest, var(--rule))",
      Icon: ShieldCheck,
    },
  };
  const p = palette[status];
  const label = t(`wikiTypes.epistemicStatus.${status}` as never);
  const hint = t("wikiBanner.epistemicStatusHint");
  return (
    <span
      title={`${t("wikiBanner.epistemicStatusLabel")}: ${label}\n${hint}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "1px 8px",
        borderRadius: "var(--pill)",
        border: `1px solid ${p.border}`,
        background: p.bg,
        color: p.color,
        fontSize: 12,
        lineHeight: 1.4,
        fontWeight: 500,
      }}
    >
      <p.Icon size={11} />
      {label}
    </span>
  );
}

// ──────────────────────────────────────────────
// Claim corroboration バッジ: 複数の独立したノートが同じ知見に依拠した
// （candidate → verified に自動昇格した）ことを示す。世界照合 verdict とは別レーン。
// EpistemicStatusBadge の established（forest-soft のソフトピル）と隣接し得るため、
// 塗りつぶし forest で「別軸のバッジ」だと一目で区別できるようにする。
function CorroboratedBadge() {
  const t = useT();
  return (
    <span
      title={t("wikiBanner.corroboratedHint")}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "1px 8px",
        borderRadius: "var(--pill)",
        border: "1px solid var(--forest, var(--rule))",
        background: "var(--forest)",
        color: "var(--paper, #fff)",
        fontSize: 12,
        lineHeight: 1.4,
        fontWeight: 500,
      }}
    >
      <BadgeCheck size={11} />
      {t("wikiBanner.corroborated")}
    </span>
  );
}

// ──────────────────────────────────────────────
// Phase γ: modalQualifier（ユーザー主観の確からしさ表現）を控えめなピルで表示。
// system confidence とは別軸なので、混同しないように冒頭にスペードアイコンを付ける。
// ──────────────────────────────────────────────
function ModalQualifierBadge({ qualifier }: { qualifier: ModalQualifier }) {
  const t = useT();
  const palette: Record<ModalQualifier, { color: string; bg: string; border: string }> = {
    necessarily: {
      color: "var(--forest-ink)",
      bg: "var(--paper)",
      border: "var(--forest, var(--rule))",
    },
    probably: {
      color: "var(--sky-ink, var(--ink-2))",
      bg: "var(--paper)",
      border: "var(--sky, var(--rule))",
    },
    possibly: {
      color: "var(--amber-ink, #b45309)",
      bg: "var(--paper)",
      border: "var(--amber, var(--rule))",
    },
    rarely: {
      color: "var(--ember, #b54708)",
      bg: "var(--paper)",
      border: "var(--ember, var(--rule))",
    },
  };
  const p = palette[qualifier];
  const label = t(`wikiTypes.modalQualifier.${qualifier}` as never);
  const hint = t("wikiBanner.modalQualifierHint");
  return (
    <span
      title={`${t("wikiBanner.modalQualifierLabel")}: ${label}\n${hint}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "1px 8px",
        borderRadius: "var(--pill)",
        border: `1px solid ${p.border}`,
        background: p.bg,
        color: p.color,
        fontSize: 12,
        lineHeight: 1.4,
        fontWeight: 500,
        fontStyle: "italic",
      }}
    >
      <Sparkles size={10} />
      {label}
    </span>
  );
}

// ──────────────────────────────────────────────
// Phase γ: Backing セクション（Toulmin の Warrant 裏付け）。
// 折り畳みパターンは WorldGroundingDetailSection に揃える。
// source ごとにアイコンと色を変えて、教科書 / 外部論文 / 内部 Claim を一目で識別できるようにする。
// ──────────────────────────────────────────────
function BackingSection({ backing }: { backing: BackingEntry[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (backing.length === 0) return null;
  return (
    <div
      style={{
        marginTop: 6,
        padding: open ? "6px 10px 8px" : "4px 10px",
        borderRadius: "var(--r-2)",
        background: "var(--paper)",
        border: "1px dashed var(--rule)",
        fontSize: 14,
        lineHeight: 1.55,
        color: "var(--ink-2)",
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "1px 4px",
          margin: 0,
          background: "transparent",
          border: "none",
          color: "var(--ink-2)",
          font: "inherit",
          cursor: "pointer",
        }}
        title={t("wikiBanner.backingHint")}
      >
        <ChevronDown
          size={11}
          style={{
            transform: open ? "rotate(0)" : "rotate(-90deg)",
            transition: "transform 120ms",
          }}
        />
        <BookOpen size={11} />
        <span style={{ fontWeight: 500 }}>{t("wikiBanner.backingTitle")}</span>
        <span style={{ color: "var(--ink-4)", fontWeight: 400 }}>· {backing.length}</span>
      </button>
      {open && (
        <ul
          style={{
            marginTop: 6,
            paddingLeft: 16,
            lineHeight: 1.55,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {backing.map((b, i) => (
            <li key={i}>
              <BackingSourceChip source={b.source} />{" "}
              <span>{b.citation}</span>
              {b.url && (
                <>
                  {" "}
                  <a
                    href={b.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      color: "var(--sky-ink, var(--ink-2))",
                      textDecoration: "none",
                      fontFamily: "var(--mono)",
                    }}
                  >
                    <ExternalLink size={10} style={{ verticalAlign: "-1px" }} />
                  </a>
                </>
              )}
              {b.internalClaimId && (
                <span
                  style={{
                    marginLeft: 6,
                    color: "var(--ink-4)",
                    fontFamily: "var(--mono)",
                  }}
                >
                  <LinkIcon size={10} style={{ verticalAlign: "-1px" }} /> {b.internalClaimId}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BackingSourceChip({ source }: { source: string }) {
  const t = useT();
  // 既知 source は固定パレット。未知 source は中立的に。
  const palette: Record<string, { color: string; border: string; Icon: typeof BookOpen }> = {
    textbook: {
      color: "var(--forest-ink)",
      border: "var(--forest, var(--rule))",
      Icon: BookOpen,
    },
    "external-paper": {
      color: "var(--sky-ink, var(--ink-2))",
      border: "var(--sky, var(--rule))",
      Icon: ExternalLink,
    },
    "internal-claim": {
      color: "var(--ink-2)",
      border: "var(--rule)",
      Icon: LinkIcon,
    },
  };
  const p = palette[source] ?? {
    color: "var(--ink-2)",
    border: "var(--rule)",
    Icon: BookOpen,
  };
  const knownSources = ["textbook", "external-paper", "internal-claim"];
  const label = knownSources.includes(source)
    ? t(`wikiBanner.backingSource.${source}` as never)
    : source;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "0 6px",
        borderRadius: "var(--pill)",
        border: `1px solid ${p.border}`,
        background: "var(--paper)",
        color: p.color,
        fontSize: 10,
        lineHeight: 1.4,
        fontWeight: 500,
      }}
    >
      <p.Icon size={9} />
      {label}
    </span>
  );
}

// ──────────────────────────────────────────────
// Phase γ: Rebuttal Conditions セクション。
// 折り畳みは BackingSection と同じトーン。AlertTriangle で「成り立たない条件」を象徴。
// ──────────────────────────────────────────────
function RebuttalConditionsSection({ conditions }: { conditions: string[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (conditions.length === 0) return null;
  return (
    <div
      style={{
        marginTop: 6,
        padding: open ? "6px 10px 8px" : "4px 10px",
        borderRadius: "var(--r-2)",
        background: "var(--paper)",
        border: "1px dashed var(--rule)",
        fontSize: 14,
        lineHeight: 1.55,
        color: "var(--ink-2)",
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "1px 4px",
          margin: 0,
          background: "transparent",
          border: "none",
          color: "var(--ink-2)",
          font: "inherit",
          cursor: "pointer",
        }}
        title={t("wikiBanner.rebuttalHint")}
      >
        <ChevronDown
          size={11}
          style={{
            transform: open ? "rotate(0)" : "rotate(-90deg)",
            transition: "transform 120ms",
          }}
        />
        <AlertTriangle size={11} style={{ color: "var(--amber-ink, #b45309)" }} />
        <span style={{ fontWeight: 500 }}>{t("wikiBanner.rebuttalTitle")}</span>
        <span style={{ color: "var(--ink-4)", fontWeight: 400 }}>· {conditions.length}</span>
      </button>
      {open && (
        <ul
          style={{
            marginTop: 6,
            paddingLeft: 16,
            lineHeight: 1.55,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {conditions.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
