// Wiki ドキュメント用バナー
// エディタ上部に表示: AI 生成バッジ、由来ノート、アクションボタン

import { useState, useRef, useEffect } from "react";
import { Bot, RefreshCw, Trash2, ChevronDown } from "lucide-react";
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

/** 日付をフォーマット */
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
  const kindLabel = wikiMeta.kind === "summary" ? "Summary" : wikiMeta.kind === "synthesis" ? "Synthesis" : "Concept";

  // モデル選択ドロップダウンの状態
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);

  // ドロップダウン外クリックで閉じる
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

  // モデルリスト取得
  const handleOpenPicker = async () => {
    if (showModelPicker) {
      setShowModelPicker(false);
      return;
    }
    try {
      // Web モード: localStorage からモデル一覧を取得
      const { apiBase, isTauri } = await import("../../lib/platform");
      if (!isTauri()) {
        const { getLLMModels } = await import("../settings/store");
        const localModels = getLLMModels();
        setModels(localModels.map((m) => ({ name: m.name, provider: m.provider, model_id: m.modelId })));
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
    <div className="mx-4 mt-2 mb-1 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        {/* AI バッジ */}
        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
          <Bot size={12} />
          AI {kindLabel}
        </span>

        {/* 生成日 */}
        <span className="text-[10px] text-muted-foreground">
          {formatDate(wikiMeta.generatedAt)}
        </span>

        {/* モデル */}
        {wikiMeta.generatedBy?.model && (
          <span className="text-[10px] text-muted-foreground/60">
            {wikiMeta.generatedBy.model}
          </span>
        )}

        <div className="flex-1" />

        {/* アクションボタン */}
        <div className="flex items-center gap-1">
          {/* Regenerate ボタン + モデル選択ドロップダウン */}
          <div className="relative" ref={pickerRef}>
            <button
              onClick={handleOpenPicker}
              disabled={loading}
              className="inline-flex items-center gap-0.5 rounded px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
              title="Regenerate with model selection"
            >
              <RefreshCw size={12} />
              <ChevronDown size={10} />
            </button>

            {showModelPicker && (
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-lg border bg-popover shadow-lg">
                <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground border-b">
                  Regenerate with...
                </div>
                {models.map((m) => (
                  <button
                    key={m.name}
                    onClick={() => handleSelectModel(m.name)}
                    className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-muted transition-colors flex items-center gap-2"
                  >
                    <span className="truncate">{m.name}</span>
                    {m.name === defaultModel && (
                      <span className="text-[9px] text-muted-foreground/60 shrink-0">(default)</span>
                    )}
                    {m.name === wikiMeta.generatedBy?.model && (
                      <span className="text-[9px] text-primary/60 shrink-0">current</span>
                    )}
                  </button>
                ))}
                {models.length === 0 && (
                  <div className="px-3 py-2 text-[10px] text-muted-foreground">
                    No models configured
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            onClick={onDelete}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
            title="Delete"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* 由来ノート */}
      {wikiMeta.derivedFromNotes.length > 0 && (
        <div className="mt-1 text-[10px] text-muted-foreground/70">
          Source: {wikiMeta.derivedFromNotes.length} note(s)
        </div>
      )}
    </div>
  );
}
