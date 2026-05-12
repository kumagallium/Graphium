// Wiki ドキュメント用バナー
// エディタ上部に表示: AI 生成バッジ、アクションボタン

import { useState, useRef, useEffect } from "react";
import { RefreshCw, Trash2, ChevronDown, Archive, RotateCcw } from "lucide-react";
import type { ProcedureContext, SynthesisMode, WikiMeta } from "../../lib/document-types";
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

export type RegenerateOptions = {
  /** 使用するモデル名（空文字 = 現在のデフォルト） */
  model: string;
};

type ModelOption = {
  name: string;
  provider: string;
};

type Props = {
  wikiMeta: WikiMeta;
  onRegenerate: (options?: RegenerateOptions) => void;
  onDelete: () => void;
  loading?: boolean;
  /** アーカイブ済みフラグ。true のとき編集系ボタンを抑制し、復元 UI を出す */
  archived?: boolean;
  /** アーカイブから復元するハンドラ（archived === true のときのみ有効） */
  onRestoreFromArchive?: () => void;
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
}: Props) {
  const t = useT();
  const kindLabel =
    wikiMeta.kind === "summary" ? t("wikiList.kindSummary")
    : wikiMeta.kind === "synthesis" ? t("wikiList.kindSynthesis")
    : wikiMeta.kind === "atom" ? t("wikiList.kindAtom")
    : t("wikiList.kindClaim");

  const [showModelPicker, setShowModelPicker] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const [modeModal, setModeModal] = useState<SynthesisMode | null>(null);

  useEffect(() => {
    if (!showModelPicker) return;
    const handleClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowModelPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showModelPicker]);

  const handleOpenPicker = async () => {
    if (showModelPicker) {
      setShowModelPicker(false);
      return;
    }
    try {
      const { apiBase, isTauri } = await import("../../lib/platform");
      if (!isTauri()) {
        const { getLLMModels } = await import("../settings/store");
        const localModels = getLLMModels();
        setModels(localModels.map((m) => ({ name: m.name, provider: m.provider })));
        setDefaultModel(localModels[0]?.name ?? "");
      } else {
        const res = await fetch(`${apiBase()}/models`);
        if (res.ok) {
          const data = await res.json() as { models: ModelOption[]; default: string };
          setModels(data.models);
          setDefaultModel(data.default);
        }
      }
    } catch {
      // 取得失敗時は空リスト
    }
    setShowModelPicker(true);
  };

  const handleSelectModel = (modelName: string) => {
    setShowModelPicker(false);
    onRegenerate({ model: modelName });
  };

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
          {/* Regenerate ▾ */}
          <div style={{ position: "relative" }} ref={pickerRef}>
            <button
              onClick={handleOpenPicker}
              disabled={loading}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 2,
                padding: "4px 8px",
                borderRadius: "var(--r-1)",
                border: "1px solid var(--rule)",
                background: "var(--paper)",
                color: "var(--ink-2)",
                fontSize: 11,
                cursor: "pointer",
                opacity: loading ? 0.5 : 1,
              }}
              title="Regenerate with model selection"
            >
              <RefreshCw size={12} />
              <ChevronDown size={10} />
            </button>

            {showModelPicker && (
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: "calc(100% + 4px)",
                  minWidth: 220,
                  background: "var(--paper)",
                  border: "1px solid var(--rule)",
                  borderRadius: "var(--r-2)",
                  boxShadow: "var(--shadow-2)",
                  zIndex: 50,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: "7px 12px",
                    fontSize: 11,
                    color: "var(--ink-3)",
                    borderBottom: "1px solid var(--rule-2)",
                  }}
                >
                  Regenerate with…
                </div>
                {models.map((m) => (
                  <button
                    key={m.name}
                    onClick={() => handleSelectModel(m.name)}
                    className={`wiki-banner-dropdown-item${m.name === wikiMeta.generatedBy?.model ? " is-current" : ""}`}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "7px 12px",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 11.5,
                      color: "var(--ink)",
                      cursor: "pointer",
                      border: "none",
                      font: "inherit",
                    }}
                  >
                    <span style={{ flex: 1 }}>{m.name}</span>
                    {m.name === defaultModel && (
                      <span
                        style={{
                          fontSize: 9,
                          fontFamily: "var(--mono)",
                          color: "var(--ink-3)",
                          flexShrink: 0,
                        }}
                      >
                        (default)
                      </span>
                    )}
                    {m.name === wikiMeta.generatedBy?.model && (
                      <span
                        style={{
                          fontSize: 9,
                          fontFamily: "var(--mono)",
                          color: "var(--forest-ink)",
                          flexShrink: 0,
                        }}
                      >
                        current
                      </span>
                    )}
                  </button>
                ))}
                {models.length === 0 && (
                  <div
                    style={{
                      padding: "10px 12px",
                      fontSize: 11,
                      color: "var(--ink-3)",
                    }}
                  >
                    No models configured
                  </div>
                )}
              </div>
            )}
          </div>

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

      {/* Synthesis モード説明モーダル（Phase 5.4） */}
      <SynthesisModeModal
        open={modeModal !== null}
        mode={modeModal}
        onClose={() => setModeModal(null)}
      />
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
