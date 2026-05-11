// Wiki ドキュメント用バナー
// エディタ上部に表示: AI 生成バッジ、アクションボタン

import { useState, useRef, useEffect } from "react";
import { RefreshCw, Trash2, ChevronDown, Archive, RotateCcw } from "lucide-react";
import type {
  AtomType,
  ClaimRole,
  HypothesisStatus,
  SynthesisMode,
  WikiMeta,
} from "../../lib/document-types";
import { useT } from "../../i18n";

// 提案 v4 Phase 1.x の型バッジ表示用ラベル。
// 内部キー (causal 等) と表示文字列 (Causal) の対応。
const CLAIM_ROLE_LABEL: Record<ClaimRole, string> = {
  finding: "Finding",
  decision: "Decision",
  anomaly: "Anomaly",
  question: "Question",
  setup: "Setup",
  interpretation: "Interpretation",
  issue: "Issue",
};

const ATOM_TYPE_LABEL: Record<AtomType, string> = {
  causal: "Causal",
  correlational: "Correlational",
  mechanistic: "Mechanistic",
  conditional: "Conditional",
  definitional: "Definitional",
  methodological: "Methodological",
  observational: "Observational",
  boundary: "Boundary",
};

const SYNTHESIS_MODE_LABEL: Record<SynthesisMode, string> = {
  deductive: "Deductive",
  inductive: "Inductive",
  abductive: "Abductive",
  analogical: "Analogical",
  dialectic: "Dialectic",
};

const HYPOTHESIS_STATUS_LABEL: Record<HypothesisStatus, string> = {
  speculative: "Speculative",
  tested: "Tested",
  confirmed: "Confirmed",
  refuted: "Refuted",
};

function TypeBadge({ label, title, tone = "neutral" }: { label: string; title?: string; tone?: "neutral" | "warn" }) {
  const color = tone === "warn" ? "var(--ember, #b54708)" : "var(--ink-2)";
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "1px 7px",
        borderRadius: "var(--pill)",
        background: "var(--paper)",
        border: "1px solid var(--rule)",
        color,
        fontSize: 10,
        fontWeight: 500,
      }}
    >
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
    wikiMeta.kind === "summary" ? "Summary"
    : wikiMeta.kind === "synthesis" ? "Synthesis"
    : wikiMeta.kind === "atom" ? "Atom"
    : "Claim";

  const [showModelPicker, setShowModelPicker] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);

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
        border: archived ? "1px solid var(--rule)" : "1px solid var(--forest)",
        background: archived ? "var(--paper-2, #f5f5f4)" : "var(--forest-soft)",
        padding: "10px 14px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {/* AI バッジ */}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 8px",
            borderRadius: "var(--pill)",
            background: "#ffffff",
            border: "1px solid var(--forest)",
            color: "var(--forest-ink)",
            fontSize: 10,
            fontWeight: 500,
          }}
        >
          <span
            style={{
              width: 14,
              height: 14,
              borderRadius: 3,
              background: "var(--forest)",
              color: "#fff",
              fontSize: 8,
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
          AI {kindLabel}
        </span>

        {/* 意味的な型のバッジ（提案 v4 Phase 1）— 推定できているときのみ表示 */}
        {wikiMeta.kind === "claim" && wikiMeta.claimRole?.map((role) => (
          <TypeBadge
            key={role}
            label={CLAIM_ROLE_LABEL[role] ?? role}
            title={`Research-process role: ${role}`}
          />
        ))}
        {wikiMeta.kind === "atom" && wikiMeta.atomType && (
          <TypeBadge
            label={ATOM_TYPE_LABEL[wikiMeta.atomType] ?? wikiMeta.atomType}
            title={`Atom type: ${wikiMeta.atomType}`}
          />
        )}
        {wikiMeta.kind === "synthesis" && wikiMeta.synthesisMode && (
          <TypeBadge
            label={SYNTHESIS_MODE_LABEL[wikiMeta.synthesisMode] ?? wikiMeta.synthesisMode}
            title={`Reasoning mode: ${wikiMeta.synthesisMode}`}
          />
        )}
        {wikiMeta.kind === "synthesis" && wikiMeta.hypothesisStatus && wikiMeta.hypothesisStatus !== "speculative" && (
          <TypeBadge
            label={HYPOTHESIS_STATUS_LABEL[wikiMeta.hypothesisStatus] ?? wikiMeta.hypothesisStatus}
            title={`Hypothesis status: ${wikiMeta.hypothesisStatus}`}
            tone={wikiMeta.hypothesisStatus === "refuted" ? "warn" : "neutral"}
          />
        )}

        {/* 生成日 */}
        <span style={{ fontSize: 10.5, color: "var(--ink-3)" }}>
          {formatDate(wikiMeta.generatedAt)}
        </span>

        {/* モデル名 */}
        {wikiMeta.generatedBy?.model && (
          <span
            style={{
              fontSize: 10.5,
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
              fontSize: 10,
              padding: "1px 6px",
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
              padding: "2px 8px",
              borderRadius: "var(--pill)",
              background: "var(--paper)",
              border: "1px solid var(--rule)",
              color: "var(--ink-3)",
              fontSize: 10,
              fontWeight: 500,
            }}
            title={t("archive.archivedHint")}
          >
            <Archive size={10} />
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
    </div>
  );
}
