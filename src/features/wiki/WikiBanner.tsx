// Wiki ドキュメント用バナー
// エディタ上部に表示: AI 生成バッジ、アクションボタン

import { useState, useRef, useEffect } from "react";
import { RefreshCw, Trash2, ChevronDown } from "lucide-react";
import type { WikiMeta } from "../../lib/document-types";

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
}: Props) {
  const kindLabel =
    wikiMeta.kind === "summary"
      ? "Summary"
      : wikiMeta.kind === "synthesis"
        ? "Synthesis"
        : "Concept";

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
        border: "1px solid var(--forest)",
        background: "var(--forest-soft)",
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

        <div style={{ flex: 1 }} />

        {/* アクションボタン */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
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
        </div>
      </div>
    </div>
  );
}
