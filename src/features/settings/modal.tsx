// 設定モーダル（タブ構成: General / AI Setup）

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Settings as SettingsIcon,
  ChevronDown,
  Plus,
  Trash2,
  Pencil,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  Wrench,
  RotateCcw,
  Tag,
  FolderOpen,
} from "lucide-react";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@ui/modal";
import { Button } from "@ui/button";
import { Input } from "@ui/form-field";
import { loadSettings, saveSettings, type Settings, type CustomLabels, getLLMModels, addLLMModel, removeLLMModel, type LLMModelConfig, type LatinFont, type JpFont, LATIN_FONTS, JP_FONTS, applyFontMode } from "./store";
import {
  fetchModels,
  type ModelInfo,
} from "../ai-assistant/api";
import { apiBase, isTauri } from "../../lib/platform";
import { restartSidecar, getSidecarState, getRecentSidecarLog } from "../../lib/sidecar";
import {
  getGraphiumRoot,
  setGraphiumRoot,
  pickGraphiumRoot,
  type GraphiumRootInfo,
} from "../../lib/graphium-root";
import { useLocale, type Locale } from "../../i18n";
import { CORE_LABELS, CORE_LABEL_PROV, type CoreLabel } from "../context-label/labels";
import type { WikiKind } from "../../lib/document-types";

// ── プロバイダー定義 ──
const PROVIDERS = [
  { id: "anthropic", name: "Anthropic" },
  { id: "openai", name: "OpenAI" },
  { id: "google", name: "Google Gemini" },
  { id: "openai-compatible", name: "OpenAI Compatible (Groq, Ollama, etc.)" },
] as const;

const API_BASE_HINTS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  google: "https://generativelanguage.googleapis.com",
  groq: "https://api.groq.com/openai/v1",
  ollama: "http://localhost:11434",
  "openai-compatible": "https://api.example.com/v1",
};

// ── ヘルスチェック型 ──
type HealthStatus = {
  status: string;
  components: Record<string, string>;
} | null;

// ── ツール型 ──
type ToolInfo = {
  name: string;
  display_name: string;
  description: string;
  tool_type: string;
  status: string;
  icon: string;
};

type ToolsResponse = {
  tools: ToolInfo[];
  sources: {
    crucible: { url: string; status: string; server_count: number };
  };
};

type Tab = "general" | "labels" | "ai-setup" | "maintenance";

// Settings → Maintenance タブで使う Wiki サマリー
export type WikiSummaryForSettings = {
  id: string;
  title: string;
  kind: WikiKind;
  model?: string;
};

export type RegenerateWikiHandler = (
  wikiId: string,
  options?: { model?: string },
) => Promise<{ ok: boolean; error?: string }>;

type BulkFailedItem = { id: string; title: string; error?: string };
type BulkProgress = {
  done: number;
  total: number;
  failed: number;
  current?: string;
  failedItems: BulkFailedItem[];
};

// ラベルタブで使う内部キーと i18n デフォルト名のマッピング
const LABEL_I18N_KEYS: Record<CoreLabel, string> = {
  procedure: "label.step",
  material: "label.material",
  tool: "label.tool",
  attribute: "label.attr",
  result: "label.result",
};

type SettingsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  /** Maintenance タブの一括 Regenerate 用 Wiki 一覧 */
  wikiSummaries?: WikiSummaryForSettings[];
  /** Maintenance タブから 1 件ずつ呼ばれる再生成ハンドラ */
  onRegenerateWiki?: RegenerateWikiHandler;
};

export function SettingsModal({ isOpen, onClose, wikiSummaries, onRegenerateWiki }: SettingsModalProps) {
  const { locale, setLocale, t } = useLocale();
  const [tab, setTab] = useState<Tab>("general");

  // 設定値
  const [model, setModel] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [chatSynthesisModel, setChatSynthesisModel] = useState("");
  const [autoIngestChat, setAutoIngestChat] = useState(true);
  const [disabledTools, setDisabledTools] = useState<string[]>([]);
  const [registryUrl, setRegistryUrl] = useState("");
  const [customLabels, setCustomLabels] = useState<CustomLabels>({});
  const [latinFont, setLatinFont] = useState<LatinFont>("");
  const [jpFont, setJpFont] = useState<JpFont>("");

  // サーバーデータ
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const [modelsLoading, setModelsLoading] = useState(false);

  // ヘルスチェック
  const [health, setHealth] = useState<HealthStatus>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  // sidecar 再起動（Tauri 環境のみ）
  const [restartingSidecar, setRestartingSidecar] = useState(false);
  const [sidecarError, setSidecarError] = useState<string | null>(null);
  const [sidecarLog, setSidecarLog] = useState<string[]>([]);
  const [showSidecarLog, setShowSidecarLog] = useState(false);

  // ローカル保存先（Tauri 環境のみ）
  const [graphiumRoot, setGraphiumRootState] = useState<GraphiumRootInfo | null>(null);
  const [rootBusy, setRootBusy] = useState(false);
  const [rootError, setRootError] = useState<string | null>(null);

  // ツール
  const [toolsData, setToolsData] = useState<ToolsResponse | null>(null);

  // Maintenance タブ — Wiki 一括 Regenerate
  const [bulkKinds, setBulkKinds] = useState<Set<WikiKind>>(new Set(["concept", "summary", "synthesis"]));
  const [bulkModelOverride, setBulkModelOverride] = useState("");
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<BulkProgress | null>(null);
  const cancelBulkRef = useRef(false);

  // モデル追加フォーム
  const [showAddForm, setShowAddForm] = useState(false);
  const [addMode, setAddMode] = useState<"new" | "existing">("new");
  const [sourceModelId, setSourceModelId] = useState<string | null>(null);
  const [addProvider, setAddProvider] = useState("anthropic");
  const [addApiKey, setAddApiKey] = useState("");
  const [addApiBase, setAddApiBase] = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [fetchingAvailable, setFetchingAvailable] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [customModelId, setCustomModelId] = useState("");
  const [modelDisplayName, setModelDisplayName] = useState("");
  const [addError, setAddError] = useState("");
  const [adding, setAdding] = useState(false);

  // 既存プロバイダーグループ（provider + apiBase でグループ化）
  type ProviderGroup = { provider: string; apiBase: string; label: string; representativeId: string };
  const providerGroups: ProviderGroup[] = (() => {
    const seen = new Map<string, ProviderGroup>();
    for (const m of models) {
      const key = `${m.provider}::${m.api_base}`;
      if (!seen.has(key)) {
        const providerName = PROVIDERS.find((p) => p.id === m.provider)?.name ?? m.provider;
        const label = m.api_base ? `${providerName} (${m.api_base})` : providerName;
        seen.set(key, { provider: m.provider, apiBase: m.api_base, label, representativeId: m.id });
      }
    }
    return Array.from(seen.values());
  })();

  // 削除確認
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // 編集
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editApiKey, setEditApiKey] = useState("");
  const [editApiBase, setEditApiBase] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // 保存
  const [saved, setSaved] = useState(false);

  // Web モード判定（非 Tauri = Web）
  const isWebMode = !isTauri();

  // LLMModelConfig → ModelInfo 変換（Web モード用）
  const toModelInfo = (m: LLMModelConfig): ModelInfo => ({
    name: m.name,
    provider: m.provider,
    model_id: m.modelId,
    api_base: m.apiBase ?? "",
    supports_function_calling: true,
    id: m.id,
  });

  // ── データ取得 ──
  const refreshModels = useCallback(() => {
    if (isWebMode) {
      // Web モード: localStorage から読み込み
      const llmModels = getLLMModels();
      setModels(llmModels.map(toModelInfo));
      setDefaultModel(llmModels[0]?.name ?? "");
      return;
    }
    setModelsLoading(true);
    fetchModels()
      .then((res) => {
        setModels(res.models);
        setDefaultModel(res.default);
      })
      .catch(() => {
        setModels([]);
        setDefaultModel("");
      })
      .finally(() => setModelsLoading(false));
  }, [isWebMode]);

  const refreshHealth = useCallback((headers?: HeadersInit) => {
    setHealthLoading(true);
    fetch(`${apiBase()}/health`, { headers })
      .then((r) => r.json())
      .then((data) => setHealth(data))
      .catch(() => setHealth(null))
      .finally(() => setHealthLoading(false));
  }, []);

  const handleRestartSidecar = useCallback(async () => {
    if (!isTauri()) return;
    setRestartingSidecar(true);
    setSidecarError(null);
    setSidecarLog([]);
    setShowSidecarLog(false);
    try {
      const ok = await restartSidecar();
      if (ok) {
        const regUrl = loadSettings().registryUrl ?? "";
        const regHeaders: HeadersInit = regUrl ? { "X-Registry-URL": regUrl } : {};
        refreshHealth(regHeaders);
      } else {
        const s = getSidecarState();
        setSidecarError(s.lastError ?? t("settings.health.unknownError"));
        setSidecarLog(getRecentSidecarLog());
      }
    } catch (e) {
      setSidecarError(e instanceof Error ? e.message : String(e));
    } finally {
      setRestartingSidecar(false);
    }
  }, [refreshHealth, t]);

  useEffect(() => {
    if (!isOpen) return;
    const settings = loadSettings();
    setModel(settings.model);
    setEmbeddingModel(settings.embeddingModel ?? "");
    setChatSynthesisModel(settings.chatSynthesisModel ?? "");
    setAutoIngestChat(settings.autoIngestChat ?? true);
    setDisabledTools(settings.disabledTools ?? []);
    setRegistryUrl(settings.registryUrl ?? "");
    setCustomLabels(settings.customLabels ?? {});
    setLatinFont(settings.latinFont ?? "");
    setJpFont(settings.jpFont ?? "");
    setSaved(false);
    setShowAddForm(false);
    setDeleteConfirm(null);
    setAddError("");

    refreshModels();

    // Registry URL ヘッダーを付与
    const regUrl = settings.registryUrl ?? "";
    const regHeaders: HeadersInit = regUrl ? { "X-Registry-URL": regUrl } : {};

    refreshHealth(regHeaders);

    fetch(`${apiBase()}/tools`, { headers: regHeaders })
      .then((r) => r.json())
      .then((data) => setToolsData(data))
      .catch(() => setToolsData(null));

    // Tauri 環境: ローカル保存先を取得
    if (isTauri()) {
      setRootError(null);
      getGraphiumRoot()
        .then((info) => setGraphiumRootState(info))
        .catch((err) => {
          setGraphiumRootState(null);
          setRootError(err instanceof Error ? err.message : String(err));
        });
    } else {
      setGraphiumRootState(null);
    }
  }, [isOpen, refreshModels]);

  const handlePickGraphiumRoot = useCallback(async () => {
    setRootBusy(true);
    setRootError(null);
    try {
      const picked = await pickGraphiumRoot(graphiumRoot?.current);
      if (!picked) return;
      const info = await setGraphiumRoot(picked);
      setGraphiumRootState(info);
    } catch (err) {
      setRootError(err instanceof Error ? err.message : String(err));
    } finally {
      setRootBusy(false);
    }
  }, [graphiumRoot]);

  const handleResetGraphiumRoot = useCallback(async () => {
    setRootBusy(true);
    setRootError(null);
    try {
      const info = await setGraphiumRoot(null);
      setGraphiumRootState(info);
    } catch (err) {
      setRootError(err instanceof Error ? err.message : String(err));
    } finally {
      setRootBusy(false);
    }
  }, []);

  // ── モデル追加フロー ──
  const handleFetchAvailable = useCallback(async () => {
    // 既存プロバイダーモードの場合
    if (addMode === "existing" && sourceModelId) {
      setFetchingAvailable(true);
      setAddError("");
      setAvailableModels([]);
      try {
        // Web モード: localStorage からキーを取得してリクエストに含める
        let reqBody: Record<string, string | undefined>;
        if (isWebMode) {
          const source = getLLMModels().find((m) => m.id === sourceModelId);
          if (!source) throw new Error("モデルが見つかりません");
          reqBody = { provider: source.provider, api_key: source.apiKey, api_base: source.apiBase ?? undefined };
        } else {
          reqBody = { source_model_id: sourceModelId };
        }
        const res = await fetch(`${apiBase()}/models/available`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reqBody),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Error ${res.status}`);
        }
        const data = await res.json();
        setAvailableModels(data.models ?? []);
        if (data.models?.length > 0) {
          setSelectedModelId(data.models[0]);
          setModelDisplayName(data.models[0]);
        }
      } catch (err) {
        setAddError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setFetchingAvailable(false);
      }
      return;
    }

    // 新規プロバイダーモード
    if (!addApiKey.trim()) {
      setAddError(t("settings.addModel.apiKeyRequired"));
      return;
    }
    setFetchingAvailable(true);
    setAddError("");
    setAvailableModels([]);
    try {
      const body: Record<string, string> = {
        provider: addProvider,
        api_key: addApiKey.trim(),
      };
      if (addApiBase.trim()) body.api_base = addApiBase.trim();
      const res = await fetch(`${apiBase()}/models/available`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Error ${res.status}`);
      }
      const data = await res.json();
      setAvailableModels(data.models ?? []);
      if (data.models?.length > 0) {
        setSelectedModelId(data.models[0]);
        setModelDisplayName(data.models[0]);
      }
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setFetchingAvailable(false);
    }
  }, [isWebMode, addMode, sourceModelId, addProvider, addApiKey, addApiBase, t]);

  const handleAddModel = useCallback(async () => {
    const modelId = customModelId.trim() || selectedModelId;
    if (!modelId) {
      setAddError(t("settings.addModel.selectModel"));
      return;
    }
    setAdding(true);
    setAddError("");
    try {
      if (isWebMode) {
        // Web モード: localStorage に保存
        // 既存プロバイダーモードでは既存モデルの API キーを再利用
        let apiKey = addApiKey.trim();
        let apiBaseVal = addApiBase.trim() || null;
        if (addMode === "existing" && sourceModelId) {
          const source = getLLMModels().find((m) => m.id === sourceModelId);
          if (source) {
            apiKey = source.apiKey;
            apiBaseVal = apiBaseVal || source.apiBase;
          }
        }
        addLLMModel({
          name: modelDisplayName.trim() || modelId,
          provider: addProvider,
          modelId: modelId,
          apiKey,
          apiBase: apiBaseVal,
        });
      } else {
        // Desktop/Docker: サーバー API 経由
        const reqBody: Record<string, string | undefined> = {
          model_name: modelDisplayName.trim() || modelId,
          provider: addProvider,
          model_id: modelId,
        };
        if (addMode === "existing" && sourceModelId) {
          reqBody.source_model_id = sourceModelId;
        } else {
          reqBody.api_key = addApiKey.trim();
          reqBody.api_base = addApiBase.trim() || undefined;
        }

        const res = await fetch(`${apiBase()}/models`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reqBody),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Error ${res.status}`);
        }
      }
      // 成功 → フォームリセット、一覧更新
      setShowAddForm(false);
      setAddMode("new");
      setSourceModelId(null);
      setAddProvider("anthropic");
      setAddApiKey("");
      setAddApiBase("");
      setAvailableModels([]);
      setSelectedModelId("");
      setCustomModelId("");
      setModelDisplayName("");
      refreshModels();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setAdding(false);
    }
  }, [isWebMode, addMode, sourceModelId, addProvider, addApiKey, addApiBase, selectedModelId, customModelId, modelDisplayName, refreshModels, t]);

  const handleDeleteModel = useCallback(async (id: string) => {
    try {
      if (isWebMode) {
        removeLLMModel(id);
      } else {
        await fetch(`${apiBase()}/models/${id}`, { method: "DELETE" });
      }
      setDeleteConfirm(null);
      refreshModels();
    } catch {
      // 静かに失敗
    }
  }, [isWebMode, refreshModels]);

  const handleStartEdit = useCallback((m: ModelInfo) => {
    setEditingId(m.id);
    setEditName(m.name);
    setEditApiKey("");
    setEditApiBase(m.api_base);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingId) return;
    setEditSaving(true);
    try {
      if (isWebMode) {
        // Web モード: localStorage を直接更新
        const allModels = getLLMModels();
        const idx = allModels.findIndex((m) => m.id === editingId);
        if (idx >= 0) {
          if (editName.trim()) allModels[idx].name = editName.trim();
          if (editApiKey.trim()) allModels[idx].apiKey = editApiKey.trim();
          allModels[idx].apiBase = editApiBase.trim() || null;
          localStorage.setItem("graphium-llm-models", JSON.stringify(allModels));
        }
      } else {
        const body: Record<string, string> = {};
        if (editName.trim()) body.model_name = editName.trim();
        if (editApiKey.trim()) body.api_key = editApiKey.trim();
        body.api_base = editApiBase.trim();
        await fetch(`${apiBase()}/models/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      setEditingId(null);
      refreshModels();
    } catch {
      // 静かに失敗
    } finally {
      setEditSaving(false);
    }
  }, [isWebMode, editingId, editName, editApiKey, editApiBase, refreshModels]);

  // ── 保存 ──
  const handleSave = useCallback(() => {
    saveSettings({ model, embeddingModel, chatSynthesisModel, autoIngestChat, disabledTools, registryUrl: registryUrl.trim().replace(/\/+$/, ""), customLabels, latinFont, jpFont });
    applyFontMode(latinFont, jpFont);
    setSaved(true);
    setTimeout(() => onClose(), 600);
  }, [model, embeddingModel, chatSynthesisModel, autoIngestChat, disabledTools, registryUrl, customLabels, latinFont, jpFont, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSave();
      }
    },
    [handleSave],
  );

  // ── ステータスアイコン ──
  function StatusIcon({ status }: { status: string }) {
    if (status === "ok") return <CheckCircle size={14} className="text-green-600" />;
    if (status === "degraded") return <AlertCircle size={14} className="text-amber-500" />;
    return <XCircle size={14} className="text-red-500" />;
  }

  return (
    <Modal open={isOpen} onClose={onClose}>
      <ModalHeader onClose={onClose}>
        <span className="flex items-center gap-2">
          <SettingsIcon size={16} className="text-muted-foreground" />
          {t("settings.title")}
        </span>
      </ModalHeader>

      {/* タブ */}
      <div className="flex border-b border-border px-6">
        {(["general", "labels", "ai-setup", "maintenance"] as Tab[]).map((tabId) => (
          <button
            key={tabId}
            onClick={() => setTab(tabId)}
            className={`px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
              tab === tabId
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t(`settings.tab.${tabId === "ai-setup" ? "aiSetup" : tabId}`)}
          </button>
        ))}
      </div>

      <ModalBody className="w-full min-w-[460px] max-w-lg" onKeyDown={handleKeyDown}>
        {/* ── General タブ ── */}
        {tab === "general" && (
          <div className="space-y-4">
            {/* ── Display & Locale ── */}
            <div className="text-[11px] font-semibold tracking-wide uppercase text-muted-foreground/80 border-b border-border pb-1">
              {t("settings.section.display")}
            </div>
            {/* 言語 */}
            <div>
              <label className="text-xs font-semibold text-foreground mb-1 block">
                {t("settings.language")}
              </label>
              <div className="flex gap-2">
                {(["en", "ja"] as Locale[]).map((loc) => (
                  <button
                    key={loc}
                    onClick={() => setLocale(loc)}
                    className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                      locale === loc
                        ? "border-primary bg-primary/10 text-primary font-medium"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {loc === "en" ? "English" : "日本語"}
                  </button>
                ))}
              </div>
            </div>

            {/* 読みやすさ（フォント） — ラテン用と日本語用を独立に設定 */}
            <div>
              <label className="text-xs font-semibold text-foreground mb-1 block">
                {t("settings.font")}
              </label>
              <div className="space-y-2">
                {/* ラテン文字用 */}
                <div>
                  <div className="text-[11px] text-muted-foreground mb-1">{t("settings.fontLatin")}</div>
                  <div className="relative">
                    <select
                      value={latinFont}
                      onChange={(e) => {
                        const next = e.target.value as LatinFont;
                        setLatinFont(next);
                        applyFontMode(next, jpFont);
                        setSaved(false);
                      }}
                      className="w-full appearance-none rounded-md border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
                      style={{
                        fontFamily: latinFont === "lexend"
                          ? "'Lexend', system-ui, sans-serif"
                          : latinFont === "atkinson-next"
                            ? "'Atkinson Hyperlegible Next', system-ui, sans-serif"
                            : latinFont === "atkinson-next-mixed"
                              ? "'Inter Numerals', 'Atkinson Hyperlegible Next', system-ui, sans-serif"
                              : "'Inter', system-ui, sans-serif",
                      }}
                    >
                      {LATIN_FONTS.map((mode) => {
                        const labelKey = mode === ""
                          ? "settings.fontLatinDefault"
                          : mode === "atkinson-next-mixed"
                            ? "settings.fontAtkinsonNextMixed"
                            : mode === "atkinson-next"
                              ? "settings.fontAtkinsonNext"
                              : "settings.fontLexend";
                        return (
                          <option key={mode || "default"} value={mode}>
                            {t(labelKey)}
                          </option>
                        );
                      })}
                    </select>
                    <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </div>
                {/* 日本語用 */}
                <div>
                  <div className="text-[11px] text-muted-foreground mb-1">{t("settings.fontJp")}</div>
                  <div className="relative">
                    <select
                      value={jpFont}
                      onChange={(e) => {
                        const next = e.target.value as JpFont;
                        setJpFont(next);
                        applyFontMode(latinFont, next);
                        setSaved(false);
                      }}
                      className="w-full appearance-none rounded-md border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
                      style={{
                        fontFamily: jpFont === "biz-udp"
                          ? "'BIZ UDPGothic', system-ui, sans-serif"
                          : jpFont === "zen-kaku"
                            ? "'Zen Kaku Gothic New', system-ui, sans-serif"
                            : "system-ui, sans-serif",
                      }}
                    >
                      {JP_FONTS.map((mode) => {
                        const labelKey = mode === ""
                          ? "settings.fontJpDefault"
                          : mode === "zen-kaku"
                            ? "settings.fontZenKaku"
                            : "settings.fontBizUDP";
                        return (
                          <option key={mode || "default"} value={mode}>
                            {t(labelKey)}
                          </option>
                        );
                      })}
                    </select>
                    <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">{t("settings.fontHelp")}</p>
            </div>

            {/* ── AI ── */}
            <div className="text-[11px] font-semibold tracking-wide uppercase text-muted-foreground/80 border-b border-border pb-1 pt-2">
              {t("settings.section.ai")}
            </div>
            {/* モデル選択 */}
            <div>
              <label className="text-xs font-semibold text-foreground mb-1 block">
                {t("settings.model")}
              </label>
              <div className="relative">
                <select
                  value={model}
                  onChange={(e) => { setModel(e.target.value); setSaved(false); }}
                  disabled={modelsLoading || models.length === 0}
                  className="w-full appearance-none rounded-md border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground transition-colors focus:border-primary focus:outline-none disabled:opacity-50"
                >
                  <option value="">
                    {modelsLoading ? t("settings.modelLoading") : models.length === 0 ? t("settings.modelNone") : t("settings.modelDefault", { name: defaultModel })}
                  </option>
                  {models.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name}{m.name === defaultModel ? ` (${t("settings.modelDefaultLabel")})` : ""}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">{t("settings.modelHelp")}</p>
            </div>

            {/* Embedding モデル選択 */}
            <div>
              <label className="text-xs font-semibold text-foreground mb-1 block">
                Embedding Model
              </label>
              <div className="relative">
                <select
                  value={embeddingModel}
                  onChange={(e) => { setEmbeddingModel(e.target.value); setSaved(false); }}
                  disabled={modelsLoading || models.length === 0}
                  className="w-full appearance-none rounded-md border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground transition-colors focus:border-primary focus:outline-none disabled:opacity-50"
                >
                  <option value="">
                    {models.length === 0 ? "No models" : "Same as chat model"}
                  </option>
                  {models.filter((m) => m.provider === "openai" || m.provider === "openai-compatible").map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                Embedding requires OpenAI or OpenAI-compatible provider. Leave empty to use text-match fallback.
              </p>
            </div>

            {/* Chat & Synthesis モデル選択（対話と統合用 — default より上のモデルを当てる場面用） */}
            <div>
              <label className="text-xs font-semibold text-foreground mb-1 block">
                {t("settings.chatSynthesisModel")}
              </label>
              <div className="relative">
                <select
                  value={chatSynthesisModel}
                  onChange={(e) => { setChatSynthesisModel(e.target.value); setSaved(false); }}
                  disabled={modelsLoading || models.length === 0}
                  className="w-full appearance-none rounded-md border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground transition-colors focus:border-primary focus:outline-none disabled:opacity-50"
                >
                  <option value="">
                    {models.length === 0 ? t("settings.modelNone") : t("settings.chatSynthesisModelSameAsDefault")}
                  </option>
                  {models.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                {t("settings.chatSynthesisModelHelp")}
              </p>
            </div>

            {/* チャットの自動 Wiki 取り込み */}
            <div>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoIngestChat}
                  onChange={(e) => { setAutoIngestChat(e.target.checked); setSaved(false); }}
                  className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                />
                <span className="flex-1">
                  <span className="text-xs font-semibold text-foreground block">
                    {t("settings.autoIngestChat")}
                  </span>
                  <span className="text-xs text-muted-foreground mt-0.5 block">
                    {t("settings.autoIngestChatHelp")}
                  </span>
                </span>
              </label>
            </div>

            {/* ── Storage（デスクトップ版のみ） ── */}
            {isTauri() && (
              <div className="text-[11px] font-semibold tracking-wide uppercase text-muted-foreground/80 border-b border-border pb-1 pt-2">
                {t("settings.section.storage")}
              </div>
            )}
            {/* ローカル保存先（デスクトップ版のみ） */}
            {isTauri() && (
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <FolderOpen size={14} className="text-muted-foreground" />
                  <label className="text-xs font-semibold text-foreground">
                    {t("settings.saveDir.title")}
                  </label>
                </div>
                <p className="text-xs text-muted-foreground mb-2">
                  {t("settings.saveDir.help")}
                </p>
                {graphiumRoot ? (
                  <div className="rounded-md border border-border bg-background px-3 py-2 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {t("settings.saveDir.currentLabel")}
                        </div>
                        <div className="text-xs font-mono text-foreground break-all">
                          {graphiumRoot.current}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handlePickGraphiumRoot}
                        disabled={rootBusy}
                        className="shrink-0"
                      >
                        {rootBusy ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          t("settings.saveDir.change")
                        )}
                      </Button>
                    </div>
                    {graphiumRoot.isCustom && (
                      <div className="flex items-center justify-between gap-2 pt-1 border-t border-border">
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            {t("settings.saveDir.defaultLabel")}
                          </div>
                          <div className="text-xs font-mono text-muted-foreground break-all">
                            {graphiumRoot.defaultRoot}
                          </div>
                        </div>
                        <button
                          onClick={handleResetGraphiumRoot}
                          disabled={rootBusy}
                          className="shrink-0 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
                        >
                          <RotateCcw size={12} />
                          {t("settings.saveDir.reset")}
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground py-1">
                    <Loader2 size={12} className="inline animate-spin mr-1" />
                    ...
                  </div>
                )}
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 flex items-start gap-1">
                  <AlertCircle size={12} className="mt-0.5 shrink-0" />
                  <span>{t("settings.saveDir.warning")}</span>
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("settings.saveDir.restartNote")}
                </p>
                {rootError && (
                  <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                    <AlertCircle size={12} /> {rootError}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Labels タブ ── */}
        {tab === "labels" && (
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <Tag size={14} className="text-muted-foreground" />
                <label className="text-xs font-semibold text-foreground">
                  {t("settings.labels.title")}
                </label>
              </div>
              <p className="text-xs text-muted-foreground mb-3">{t("settings.labels.help")}</p>

              <div className="space-y-2">
                {CORE_LABELS.map((label) => (
                  <div key={label} className="flex items-center gap-3">
                    <div className="w-28 shrink-0">
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {CORE_LABEL_PROV[label]}
                      </span>
                    </div>
                    <Input
                      type="text"
                      value={customLabels[label] ?? ""}
                      onChange={(e) => {
                        setCustomLabels((prev) => {
                          const next = { ...prev };
                          if (e.target.value.trim()) {
                            next[label] = e.target.value.trim();
                          } else {
                            delete next[label];
                          }
                          return next;
                        });
                        setSaved(false);
                      }}
                      placeholder={t(LABEL_I18N_KEYS[label])}
                      className="flex-1"
                    />
                  </div>
                ))}
              </div>

              {Object.keys(customLabels).length > 0 && (
                <button
                  onClick={() => { setCustomLabels({}); setSaved(false); }}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-3 transition-colors"
                >
                  <RotateCcw size={12} /> {t("settings.labels.reset")}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── AI Setup タブ ── */}
        {tab === "ai-setup" && (
          <div className="space-y-5">
            {/* 接続状態パネル */}
            <div className="rounded-lg border border-border p-3">
              <h3 className="text-xs font-semibold text-foreground mb-2">{t("settings.health.title")}</h3>
              {healthLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 size={14} className="animate-spin" /> {t("settings.health.checking")}
                </div>
              ) : health ? (
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {Object.entries(health.components).map(([name, status]) => (
                    <div key={name} className="flex items-center gap-1.5 text-xs text-foreground">
                      <StatusIcon status={status} />
                      <span className="capitalize">{name}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-red-500">
                  <XCircle size={14} />
                  {t("settings.health.unavailable")}
                </div>
              )}
            </div>

            {/* バックエンド未接続時は案内 + 再起動オプション */}
            {!healthLoading && !health ? (
              <div className="rounded-lg border border-dashed border-border p-4 space-y-3">
                <p className="text-xs text-muted-foreground text-center">
                  {t("settings.health.unavailable")}
                </p>
                {isTauri() && (
                  <div className="flex flex-col items-center gap-2">
                    <Button
                      size="sm"
                      onClick={handleRestartSidecar}
                      disabled={restartingSidecar}
                    >
                      {restartingSidecar ? (
                        <><Loader2 size={12} className="animate-spin mr-1.5" />{t("settings.health.restarting")}</>
                      ) : (
                        <><RotateCcw size={12} className="mr-1.5" />{t("settings.health.restart")}</>
                      )}
                    </Button>
                    {sidecarError && (
                      <div className="w-full rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs">
                        <div className="flex items-start gap-1.5 text-red-600 dark:text-red-400">
                          <AlertCircle size={12} className="mt-0.5 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="font-medium mb-0.5">{t("settings.health.restartFailed")}</div>
                            <div className="text-foreground/80 break-words">{sidecarError}</div>
                            {sidecarLog.length > 0 && (
                              <button
                                onClick={() => setShowSidecarLog((v) => !v)}
                                className="mt-1 text-[11px] text-muted-foreground hover:text-foreground underline"
                              >
                                {showSidecarLog ? t("settings.health.hideLog") : t("settings.health.showLog")}
                              </button>
                            )}
                            {showSidecarLog && sidecarLog.length > 0 && (
                              <pre className="mt-1.5 text-[10px] bg-background/50 rounded p-1.5 overflow-auto max-h-32 font-mono whitespace-pre-wrap">{sidecarLog.join("\n")}</pre>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : <>

            {/* 登録済みモデル一覧 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-foreground">{t("settings.models.title")}</h3>
                {!showAddForm && (
                  <button
                    onClick={() => { setShowAddForm(true); setAddMode(models.length > 0 ? "existing" : "new"); }}
                    className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                  >
                    <Plus size={14} /> {t("settings.models.add")}
                  </button>
                )}
              </div>

              {modelsLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                  <Loader2 size={14} className="animate-spin" /> {t("settings.models.loading")}
                </div>
              ) : models.length === 0 && !showAddForm ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-center">
                  <p className="text-xs text-muted-foreground mb-2">{t("settings.models.empty")}</p>
                  <button
                    onClick={() => { setShowAddForm(true); setAddMode(models.length > 0 ? "existing" : "new"); }}
                    className="text-xs text-primary hover:text-primary/80 font-medium"
                  >
                    <Plus size={12} className="inline mr-1" />{t("settings.models.addFirst")}
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {models.map((m) => editingId === m.id ? (
                    <div key={m.id} className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
                      <div>
                        <label className="text-xs font-medium text-foreground mb-1 block">{t("settings.addModel.displayName")}</label>
                        <Input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-foreground mb-1 block">{t("settings.models.editApiKey")}</label>
                        <Input type="password" value={editApiKey} onChange={(e) => setEditApiKey(e.target.value)} placeholder={t("settings.models.editApiKeyPlaceholder")} className="font-mono text-sm" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-foreground mb-1 block">API Base URL</label>
                        <Input type="url" value={editApiBase} onChange={(e) => setEditApiBase(e.target.value)} placeholder={API_BASE_HINTS[m.provider] ?? ""} />
                      </div>
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => setEditingId(null)} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1">{t("common.cancel")}</button>
                        <Button size="sm" onClick={handleSaveEdit} disabled={editSaving}>
                          {editSaving ? <Loader2 size={12} className="animate-spin" /> : t("common.save")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div key={m.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                      <div className="min-w-0 mr-2">
                        <span className="text-sm font-medium text-foreground">{m.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">{m.provider} / {m.model_id}</span>
                      </div>
                      {deleteConfirm === m.id ? (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => handleDeleteModel(m.id)}
                            className="text-xs text-red-600 hover:text-red-700 font-medium px-2 py-0.5"
                          >
                            {t("settings.models.confirmDelete")}
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="text-xs text-muted-foreground hover:text-foreground px-2 py-0.5"
                          >
                            {t("common.cancel")}
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            onClick={() => handleStartEdit(m)}
                            className="text-muted-foreground hover:text-primary transition-colors p-1"
                            aria-label={t("settings.models.edit")}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(m.id)}
                            className="text-muted-foreground hover:text-red-500 transition-colors p-1"
                            aria-label={t("settings.models.delete")}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* モデル追加フォーム */}
            {showAddForm && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
                <h4 className="text-xs font-semibold text-foreground">{t("settings.addModel.title")}</h4>

                {/* モード切り替え（既存プロバイダーがある場合のみ表示） */}
                {providerGroups.length > 0 && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setAddMode("existing");
                        setAvailableModels([]);
                        setSelectedModelId("");
                        setCustomModelId("");
                        setAddError("");
                      }}
                      className={`flex-1 px-3 py-1.5 text-xs rounded-md border transition-colors ${
                        addMode === "existing"
                          ? "border-primary bg-primary/10 text-primary font-medium"
                          : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {t("settings.addModel.useExisting")}
                    </button>
                    <button
                      onClick={() => {
                        setAddMode("new");
                        setSourceModelId(null);
                        setAvailableModels([]);
                        setSelectedModelId("");
                        setCustomModelId("");
                        setAddError("");
                      }}
                      className={`flex-1 px-3 py-1.5 text-xs rounded-md border transition-colors ${
                        addMode === "new"
                          ? "border-primary bg-primary/10 text-primary font-medium"
                          : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {t("settings.addModel.newProvider")}
                    </button>
                  </div>
                )}

                {/* 既存プロバイダーモード */}
                {addMode === "existing" && providerGroups.length > 0 ? (
                  <>
                    <div>
                      <label className="text-xs font-medium text-foreground mb-1 block">{t("settings.addModel.selectProvider")}</label>
                      <div className="relative">
                        <select
                          value={sourceModelId ?? ""}
                          onChange={(e) => {
                            const id = e.target.value;
                            const g = providerGroups.find((g) => g.representativeId === id);
                            setSourceModelId(id || null);
                            if (g) setAddProvider(g.provider);
                            setAvailableModels([]);
                            setSelectedModelId("");
                            setCustomModelId("");
                            setAddError("");
                          }}
                          className="w-full appearance-none rounded-md border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground focus:border-primary focus:outline-none"
                        >
                          <option value="">{t("settings.addModel.selectProviderPlaceholder")}</option>
                          {providerGroups.map((g) => (
                            <option key={g.representativeId} value={g.representativeId}>
                              {g.label}
                            </option>
                          ))}
                        </select>
                        <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      </div>
                    </div>

                    <Button
                      size="sm"
                      onClick={handleFetchAvailable}
                      disabled={fetchingAvailable || !sourceModelId}
                      className="w-full"
                    >
                      {fetchingAvailable ? (
                        <><Loader2 size={14} className="animate-spin mr-1" /> {t("settings.addModel.fetching")}</>
                      ) : (
                        t("settings.addModel.fetchModels")
                      )}
                    </Button>
                  </>
                ) : (
                  <>
                    {/* 新規プロバイダーモード: プロバイダー + API キー */}
                    <div>
                      <label className="text-xs font-medium text-foreground mb-1 block">{t("settings.addModel.provider")}</label>
                      <div className="relative">
                        <select
                          value={addProvider}
                          onChange={(e) => {
                            setAddProvider(e.target.value);
                            setAvailableModels([]);
                            setSelectedModelId("");
                            setCustomModelId("");
                            setAddError("");
                          }}
                          className="w-full appearance-none rounded-md border border-border bg-background px-3 py-2 pr-8 text-sm"
                        >
                          {PROVIDERS.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                        <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-foreground mb-1 block">{t("settings.addModel.apiKey")}</label>
                      <Input
                        type="password"
                        value={addApiKey}
                        onChange={(e) => setAddApiKey(e.target.value)}
                        placeholder="sk-..."
                        className="font-mono text-sm"
                      />
                    </div>

                    {/* API Base URL（openai-compatible の場合は必須、他はオプション） */}
                    <div>
                      <label className="text-xs font-medium text-foreground mb-1 block">
                        API Base URL
                        {addProvider === "openai-compatible" && <span className="text-red-500 ml-1">*</span>}
                      </label>
                      <Input
                        type="url"
                        value={addApiBase}
                        onChange={(e) => setAddApiBase(e.target.value)}
                        placeholder={API_BASE_HINTS[addProvider] ?? ""}
                      />
                    </div>

                    <Button
                      size="sm"
                      onClick={handleFetchAvailable}
                      disabled={fetchingAvailable || !addApiKey.trim()}
                      className="w-full"
                    >
                      {fetchingAvailable ? (
                        <><Loader2 size={14} className="animate-spin mr-1" /> {t("settings.addModel.fetching")}</>
                      ) : (
                        t("settings.addModel.fetchModels")
                      )}
                    </Button>
                  </>
                )}

                {/* ステップ2: モデル選択 */}
                {availableModels.length > 0 && (
                  <>
                    <div>
                      <label className="text-xs font-medium text-foreground mb-1 block">{t("settings.addModel.selectModel")}</label>
                      <div className="relative">
                        <select
                          value={selectedModelId}
                          onChange={(e) => {
                            setSelectedModelId(e.target.value);
                            setModelDisplayName(e.target.value);
                            setCustomModelId("");
                          }}
                          className="w-full appearance-none rounded-md border border-border bg-background px-3 py-2 pr-8 text-sm"
                        >
                          {availableModels.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                        <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-foreground mb-1 block">{t("settings.addModel.customId")}</label>
                      <Input
                        type="text"
                        value={customModelId}
                        onChange={(e) => {
                          setCustomModelId(e.target.value);
                          if (e.target.value) setModelDisplayName(e.target.value);
                        }}
                        placeholder={t("settings.addModel.customIdPlaceholder")}
                      />
                    </div>

                    <div>
                      <label className="text-xs font-medium text-foreground mb-1 block">{t("settings.addModel.displayName")}</label>
                      <Input
                        type="text"
                        value={modelDisplayName}
                        onChange={(e) => setModelDisplayName(e.target.value)}
                        placeholder={selectedModelId}
                      />
                    </div>

                    <Button
                      size="sm"
                      onClick={handleAddModel}
                      disabled={adding || !(customModelId.trim() || selectedModelId)}
                      className="w-full"
                    >
                      {adding ? (
                        <><Loader2 size={14} className="animate-spin mr-1" /> {t("settings.addModel.adding")}</>
                      ) : (
                        t("settings.addModel.addButton")
                      )}
                    </Button>
                  </>
                )}

                {addError && (
                  <p className="text-xs text-red-500 flex items-center gap-1">
                    <AlertCircle size={12} /> {addError}
                  </p>
                )}

                <button
                  onClick={() => {
                    setShowAddForm(false);
                    setAddMode("new");
                    setSourceModelId(null);
                    setAddError("");
                    setAvailableModels([]);
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground w-full text-center"
                >
                  {t("common.cancel")}
                </button>
              </div>
            )}

            {/* MCP ツール状態 */}
            {/* Crucible Registry URL */}
            <div>
              <label className="text-xs font-semibold text-foreground mb-1 block">
                {t("settings.registry.title")}
              </label>
              <Input
                type="url"
                value={registryUrl}
                onChange={(e) => { setRegistryUrl(e.target.value); setSaved(false); }}
                placeholder={t("settings.registry.placeholder")}
              />
              <p className="text-xs text-muted-foreground mt-1.5">{t("settings.registry.help")}</p>
            </div>

            {/* ツール一覧 */}
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Wrench size={14} className="text-muted-foreground" />
                <h3 className="text-xs font-semibold text-foreground">{t("settings.tools.title")}</h3>
              </div>
              {toolsData ? (
                toolsData.tools.length > 0 ? (
                  <div className="space-y-1.5">
                    {toolsData.tools.map((tool) => {
                      const isDisabled = disabledTools.includes(tool.name);
                      return (
                        <div key={tool.name} className="flex items-center gap-2 text-xs text-foreground">
                          <button
                            onClick={() => {
                              setDisabledTools((prev) =>
                                isDisabled
                                  ? prev.filter((n) => n !== tool.name)
                                  : [...prev, tool.name],
                              );
                              setSaved(false);
                            }}
                            role="switch"
                            aria-checked={!isDisabled}
                            aria-label={isDisabled ? t("settings.tools.enable") : t("settings.tools.disable")}
                            className="shrink-0 inline-flex items-center rounded-full border border-border transition-colors w-8 h-[18px]"
                            style={{
                              backgroundColor: !isDisabled && (tool.status === "running" || tool.tool_type === "skill") ? "#4B7A52" : "#d5e0d7",
                            }}
                          >
                            <span
                              className="block w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform duration-200"
                              style={{
                                transform: !isDisabled ? "translateX(15px)" : "translateX(1px)",
                              }}
                            />
                          </button>
                          <span className={isDisabled ? "opacity-50" : ""}>
                            {tool.icon ? `${tool.icon} ` : ""}{tool.display_name || tool.name}
                          </span>
                          <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted">{tool.tool_type}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("settings.tools.empty")}</p>
                )
              ) : (
                <p className="text-xs text-muted-foreground">{t("settings.tools.loading")}</p>
              )}
              <p className="text-xs text-muted-foreground mt-1.5">
                {t("settings.tools.help")}
              </p>
            </div>

            </>}
          </div>
        )}

        {/* ── Maintenance タブ ── */}
        {tab === "maintenance" && (
          <MaintenanceTab
            t={t}
            wikiSummaries={wikiSummaries ?? []}
            onRegenerateWiki={onRegenerateWiki}
            availableModels={models}
            defaultModel={defaultModel}
            bulkKinds={bulkKinds}
            setBulkKinds={setBulkKinds}
            bulkModelOverride={bulkModelOverride}
            setBulkModelOverride={setBulkModelOverride}
            bulkRunning={bulkRunning}
            setBulkRunning={setBulkRunning}
            bulkProgress={bulkProgress}
            setBulkProgress={setBulkProgress}
            cancelBulkRef={cancelBulkRef}
          />
        )}
      </ModalBody>

      <ModalFooter>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" onClick={handleSave}>
          {saved ? t("common.saved") : t("common.save")}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// ── Maintenance タブ ──
// Knowledge レイヤのメンテナンス操作。今は Wiki 一括 Regenerate のみ
type MaintenanceTabProps = {
  t: (key: string) => string;
  wikiSummaries: WikiSummaryForSettings[];
  onRegenerateWiki?: RegenerateWikiHandler;
  availableModels: ModelInfo[];
  defaultModel: string;
  bulkKinds: Set<WikiKind>;
  setBulkKinds: (s: Set<WikiKind>) => void;
  bulkModelOverride: string;
  setBulkModelOverride: (s: string) => void;
  bulkRunning: boolean;
  setBulkRunning: (b: boolean) => void;
  bulkProgress: BulkProgress | null;
  setBulkProgress: (p: BulkProgress | null) => void;
  cancelBulkRef: { current: boolean };
};

function MaintenanceTab({
  t,
  wikiSummaries,
  onRegenerateWiki,
  availableModels,
  defaultModel,
  bulkKinds,
  setBulkKinds,
  bulkModelOverride,
  setBulkModelOverride,
  bulkRunning,
  setBulkRunning,
  bulkProgress,
  setBulkProgress,
  cancelBulkRef,
}: MaintenanceTabProps) {
  const KINDS: WikiKind[] = ["concept", "summary", "synthesis"];
  const [cancelling, setCancelling] = useState(false);

  const targets = useMemo(
    () => wikiSummaries.filter((w) => bulkKinds.has(w.kind)),
    [wikiSummaries, bulkKinds],
  );

  const toggleKind = (k: WikiKind) => {
    const next = new Set(bulkKinds);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setBulkKinds(next);
  };

  const runRegenerate = async (items: { id: string; title: string }[]) => {
    if (!onRegenerateWiki || bulkRunning || items.length === 0) return;
    const confirmMsg = t("settings.maintenance.confirm").replace("{count}", String(items.length));
    if (!window.confirm(confirmMsg)) return;

    setBulkRunning(true);
    setCancelling(false);
    cancelBulkRef.current = false;
    setBulkProgress({ done: 0, total: items.length, failed: 0, failedItems: [] });

    let done = 0;
    let failed = 0;
    const failedItems: BulkFailedItem[] = [];
    for (const w of items) {
      if (cancelBulkRef.current) break;
      setBulkProgress({ done, total: items.length, failed, current: w.title, failedItems });
      const result = await onRegenerateWiki(w.id, bulkModelOverride.trim() ? { model: bulkModelOverride.trim() } : undefined);
      if (!result.ok) {
        failed += 1;
        failedItems.push({ id: w.id, title: w.title, error: result.error });
      }
      done += 1;
      setBulkProgress({ done, total: items.length, failed, failedItems });
    }

    setBulkRunning(false);
    setCancelling(false);
  };

  const handleRun = () => runRegenerate(targets.map((w) => ({ id: w.id, title: w.title })));
  const handleRetryFailed = () => {
    if (!bulkProgress) return;
    runRegenerate(bulkProgress.failedItems.map((f) => ({ id: f.id, title: f.title })));
  };

  const handleCancel = () => {
    cancelBulkRef.current = true;
    setCancelling(true);
  };

  const kindLabel = (k: WikiKind) =>
    k === "concept" ? t("settings.maintenance.kind.concept")
    : k === "summary" ? t("settings.maintenance.kind.summary")
    : t("settings.maintenance.kind.synthesis");

  return (
    <div className="space-y-5">
      <div>
        <div className="text-xs font-semibold text-foreground mb-1">
          {t("settings.maintenance.regenAll.title")}
        </div>
        <p className="text-xs text-muted-foreground">
          {t("settings.maintenance.regenAll.help")}
        </p>
      </div>

      {/* kind フィルタ */}
      <div>
        <label className="text-xs font-semibold text-foreground mb-1 block">
          {t("settings.maintenance.kindFilter")}
        </label>
        <div className="flex gap-2 flex-wrap">
          {KINDS.map((k) => {
            const count = wikiSummaries.filter((w) => w.kind === k).length;
            const checked = bulkKinds.has(k);
            return (
              <button
                key={k}
                type="button"
                disabled={bulkRunning}
                onClick={() => toggleKind(k)}
                className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                  checked
                    ? "border-primary bg-primary/10 text-primary font-medium"
                    : "border-border text-muted-foreground hover:text-foreground"
                } ${bulkRunning ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                {kindLabel(k)} <span className="opacity-70">({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* モデル指定（任意） */}
      <div>
        <label className="text-xs font-semibold text-foreground mb-1 block">
          {t("settings.maintenance.modelOverride")}
        </label>
        <div className="relative">
          <select
            value={bulkModelOverride}
            onChange={(e) => setBulkModelOverride(e.target.value)}
            disabled={bulkRunning}
            className="w-full appearance-none rounded-md border border-border bg-background px-3 py-1.5 pr-8 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
          >
            <option value="">
              {t("settings.maintenance.modelOverrideDefault")}
              {defaultModel ? ` (${defaultModel})` : ""}
            </option>
            {availableModels.map((m) => (
              <option key={m.id || m.name} value={m.name}>
                {m.name}
                {m.provider ? ` — ${m.provider}` : ""}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground"
          />
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {t("settings.maintenance.modelOverrideHelp")}
        </p>
      </div>

      {/* 対象件数 */}
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
        <div className="text-xs">
          <span className="font-semibold text-foreground">
            {t("settings.maintenance.target")}: {targets.length}
          </span>
          <span className="text-muted-foreground ml-2">
            / {t("settings.maintenance.total")}: {wikiSummaries.length}
          </span>
        </div>
      </div>

      {/* 進捗表示 */}
      {bulkProgress && (
        <div className="rounded-md border border-border bg-background px-3 py-2 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">
              {bulkProgress.done} / {bulkProgress.total}
              {bulkProgress.failed > 0 && (
                <span className="text-red-500 ml-2">
                  ({t("settings.maintenance.failed")}: {bulkProgress.failed})
                </span>
              )}
            </span>
            {bulkRunning && (
              <Button variant="ghost" size="sm" onClick={handleCancel} disabled={cancelling}>
                {cancelling ? t("settings.maintenance.cancelling") : t("common.cancel")}
              </Button>
            )}
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${(bulkProgress.done / Math.max(1, bulkProgress.total)) * 100}%` }}
            />
          </div>
          {bulkProgress.current && bulkRunning && (
            <div className="text-[11px] text-muted-foreground truncate">
              {t("settings.maintenance.current")}: {bulkProgress.current}
            </div>
          )}
          {cancelling && bulkRunning && (
            <div className="text-[11px] text-amber-600">
              {t("settings.maintenance.cancellingHint")}
            </div>
          )}
          {!bulkRunning && bulkProgress.done > 0 && (
            <div className="text-[11px] text-muted-foreground">
              {t("settings.maintenance.done")}
            </div>
          )}
        </div>
      )}

      {/* 失敗 Wiki 一覧 + リトライ */}
      {bulkProgress && !bulkRunning && bulkProgress.failedItems.length > 0 && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 space-y-2">
          <div className="text-xs font-semibold text-red-700 dark:text-red-400">
            {t("settings.maintenance.failedList")} ({bulkProgress.failedItems.length})
          </div>
          <ul className="space-y-1 max-h-40 overflow-y-auto">
            {bulkProgress.failedItems.map((f) => (
              <li key={f.id} className="text-[11px]">
                <span className="text-foreground">{f.title}</span>
                {f.error && (
                  <span className="text-muted-foreground ml-2">— {f.error}</span>
                )}
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleRetryFailed}
            disabled={!onRegenerateWiki}
          >
            {t("settings.maintenance.retryFailed")}
          </Button>
        </div>
      )}

      {/* 実行 */}
      <div>
        <Button
          size="sm"
          onClick={handleRun}
          disabled={bulkRunning || targets.length === 0 || !onRegenerateWiki}
        >
          {bulkRunning
            ? t("settings.maintenance.running")
            : t("settings.maintenance.regenerate")}
        </Button>
        {!onRegenerateWiki && (
          <p className="text-xs text-muted-foreground mt-1.5">
            {t("settings.maintenance.unavailable")}
          </p>
        )}
      </div>
    </div>
  );
}
