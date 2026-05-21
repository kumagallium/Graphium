// Wiki ドキュメント用バナー
// エディタ上部に表示: AI 生成バッジ、アクションボタン

import { useMemo, useState } from "react";
import { RefreshCw, Trash2, ChevronDown, Archive, RotateCcw, Globe2 } from "lucide-react";
import type {
  GroundingValidityVerdict,
  ProcedureContext,
  SynthesisMode,
  WikiMeta,
} from "../../lib/document-types";
import type { GraphiumIndex, NoteIndexEntry } from "../navigation/index-file";
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
   * 派生元（derivedFromNotes / derivedFromClaims）のタイトル解決に使うインデックス。
   * 未指定や該当 ID が見つからない場合は ID を fallback として表示する。
   */
  noteIndex?: GraphiumIndex | null;
  /**
   * 派生元のリストエントリをクリックしたときの遷移ハンドラ。
   * Wiki エントリの場合は `wiki:` プレフィックス付きで渡す。未指定時はリンクではなく
   * 静的テキストとして表示する。
   * 規約: @mention / Graph ノードクリックと同じく既存の SidePeek で開く。
   * 深い系譜は右パネルの Graph→Lineage タブが受け持つので、ここは一次親に絞る。
   */
  onNavigateNote?: (noteId: string) => void;
  /**
   * 世界モデル照合トリガ（world-model-grounding Phase 2 / PR 2A）。
   * 押されると蒸留 KB と照合し、verdict バッジを更新する想定。
   * 未指定時はボタンを出さない（grounding 未対応のコンテキスト用）。
   */
  onCheckWorldValidity?: () => void;
  /** 照合中。ボタンを disable してスピナー的に表示する。 */
  worldCheckLoading?: boolean;
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
  noteIndex,
  onNavigateNote,
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

  return (
    <div
      style={{
        margin: "14px 32px 6px",
        borderRadius: "var(--r-3)",
        border: "1px solid var(--rule)",
        background: archived ? "var(--paper-3)" : "var(--paper-2)",
        padding: "10px 14px",
      }}
    >
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
            別レーン: epistemicStatus / hypothesisStatus には影響しない。 */}
        {wikiMeta.grounding?.validity?.verdict && (
          <WorldVerdictBadge validity={wikiMeta.grounding.validity} />
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

      {/* 手順条件（Phase 2.3）— Claim でのみ表示 (PR-B4.5: Atom/Synthesis は持たない設計に統一) */}
      {wikiMeta.kind === "claim" &&
        wikiMeta.procedureContext &&
        hasProcedureContextContent(wikiMeta.procedureContext) && (
        <ProcedureContextSection ctx={wikiMeta.procedureContext} />
      )}

      {/* 派生元セクション（world-model-grounding Phase 1）—
          derivedFromNotes / derivedFromClaims が空でないときだけ表示。
          スコアは付けず、どのノート/Claim から来たかを控えめに辿れるだけ。 */}
      {(hasDerivedFrom(wikiMeta)) && (
        <DerivedFromSection
          wikiMeta={wikiMeta}
          noteIndex={noteIndex ?? null}
          onNavigateNote={onNavigateNote}
        />
      )}

      {/* Synthesis モード説明モーダル（Phase 5.4） */}
      <SynthesisModeModal
        open={modeModal !== null}
        mode={modeModal}
        onClose={() => setModeModal(null)}
      />
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

// 派生元セクションのヘルパー: derivedFromNotes と derivedFromClaims の
// いずれかに有効な ID が 1 件でも含まれているかを判定する。
function hasDerivedFrom(meta: WikiMeta): boolean {
  const notes = (meta.derivedFromNotes ?? []).filter((id) => Boolean(id));
  const claims = (meta.derivedFromClaims ?? []).filter((id) => Boolean(id));
  return notes.length > 0 || claims.length > 0;
}

type DerivedFromEntry = {
  /** クリック時に渡す ID（wiki エントリの場合は "wiki:" プレフィックスを付ける） */
  navigateId: string;
  /** UI に出すラベル（タイトルが解けない場合は ID） */
  label: string;
  /** タイトルを index から解決できたか。false なら「不明」扱いの薄い表示にする */
  resolved: boolean;
};

function resolveDerivedEntries(
  ids: readonly string[] | undefined,
  noteIndex: GraphiumIndex | null,
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

function DerivedFromSection({
  wikiMeta,
  noteIndex,
  onNavigateNote,
}: {
  wikiMeta: WikiMeta;
  noteIndex: GraphiumIndex | null;
  onNavigateNote?: (noteId: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  const noteEntries = useMemo(
    () => resolveDerivedEntries(wikiMeta.derivedFromNotes, noteIndex),
    [wikiMeta.derivedFromNotes, noteIndex],
  );
  const claimEntries = useMemo(
    () => resolveDerivedEntries(wikiMeta.derivedFromClaims, noteIndex),
    [wikiMeta.derivedFromClaims, noteIndex],
  );

  if (noteEntries.length === 0 && claimEntries.length === 0) return null;

  const totalCount = noteEntries.length + claimEntries.length;

  return (
    <div
      style={{
        marginTop: 6,
        padding: open ? "6px 10px 8px" : "4px 10px",
        borderRadius: "var(--r-2)",
        background: "var(--paper)",
        border: "1px dashed var(--rule)",
        fontSize: 11,
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
        </div>
      )}
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
        fontSize: 11,
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
