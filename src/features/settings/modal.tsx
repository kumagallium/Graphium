// 設定モーダル（タブ構成: General / AI Setup）

import { useCallback, useEffect, useState } from "react";
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
} from "lucide-react";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@ui/modal";
import { Button } from "@ui/button";
import { Input } from "@ui/form-field";
import { loadSettings, saveSettings, type Settings, type CustomLabels } from "./store";
import {
  fetchModels,
  fetchProfiles,
  type ModelInfo,
  type ProfileInfo,
} from "../ai-assistant/api";
import { apiBase } from "../../lib/platform";
import { useLocale, type Locale } from "../../i18n";
import { CORE_LABELS, CORE_LABEL_PROV, type CoreLabel } from "../context-label/labels";

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

type Tab = "general" | "labels" | "ai-setup";

// ラベルタブで使う内部キーと i18n デフォルト名のマッピング
const LABEL_I18N_KEYS: Record<CoreLabel, string> = {
  "[手順]": "label.step",
  "[材料]": "label.material",
  "[ツール]": "label.tool",
  "[属性]": "label.attr",
  "[結果]": "label.result",
};

type SettingsModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { locale, setLocale, t } = useLocale();
  const [tab, setTab] = useState<Tab>("general");

  // 設定値
  const [model, setModel] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [profile, setProfile] = useState("");
  const [disabledTools, setDisabledTools] = useState<string[]>([]);
  const [registryUrl, setRegistryUrl] = useState("");
  const [customLabels, setCustomLabels] = useState<CustomLabels>({});

  // サーバーデータ
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const [modelsLoading, setModelsLoading] = useState(false);
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);

  // ヘルスチェック
  const [health, setHealth] = useState<HealthStatus>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  // ツール
  const [toolsData, setToolsData] = useState<ToolsResponse | null>(null);

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

  // ── データ取得 ──
  const refreshModels = useCallback(() => {
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
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const settings = loadSettings();
    setModel(settings.model);
    setEmbeddingModel(settings.embeddingModel ?? "");
    setProfile(settings.profile);
    setDisabledTools(settings.disabledTools ?? []);
    setRegistryUrl(settings.registryUrl ?? "");
    setCustomLabels(settings.customLabels ?? {});
    setSaved(false);
    setShowAddForm(false);
    setDeleteConfirm(null);
    setAddError("");

    refreshModels();

    setProfilesLoading(true);
    fetchProfiles()
      .then((res) => setProfiles(res.profiles))
      .catch(() => setProfiles([]))
      .finally(() => setProfilesLoading(false));

    // Registry URL ヘッダーを付与
    const regUrl = settings.registryUrl ?? "";
    const regHeaders: HeadersInit = regUrl ? { "X-Registry-URL": regUrl } : {};

    setHealthLoading(true);
    fetch(`${apiBase()}/health`, { headers: regHeaders })
      .then((r) => r.json())
      .then((data) => setHealth(data))
      .catch(() => setHealth(null))
      .finally(() => setHealthLoading(false));

    fetch(`${apiBase()}/tools`, { headers: regHeaders })
      .then((r) => r.json())
      .then((data) => setToolsData(data))
      .catch(() => setToolsData(null));
  }, [isOpen, refreshModels]);

  // ── モデル追加フロー ──
  const handleFetchAvailable = useCallback(async () => {
    // 既存プロバイダーモードの場合は source_model_id を使う
    if (addMode === "existing" && sourceModelId) {
      setFetchingAvailable(true);
      setAddError("");
      setAvailableModels([]);
      try {
        const res = await fetch(`${apiBase()}/models/available`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source_model_id: sourceModelId }),
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
  }, [addMode, sourceModelId, addProvider, addApiKey, addApiBase, t]);

  const handleAddModel = useCallback(async () => {
    const modelId = customModelId.trim() || selectedModelId;
    if (!modelId) {
      setAddError(t("settings.addModel.selectModel"));
      return;
    }
    setAdding(true);
    setAddError("");
    try {
      // 既存プロバイダーモードでは source_model_id を使い、apiKey は送信しない
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
  }, [addMode, sourceModelId, addProvider, addApiKey, addApiBase, selectedModelId, customModelId, modelDisplayName, refreshModels, t]);

  const handleDeleteModel = useCallback(async (id: string) => {
    try {
      await fetch(`${apiBase()}/models/${id}`, { method: "DELETE" });
      setDeleteConfirm(null);
      refreshModels();
    } catch {
      // 静かに失敗
    }
  }, [refreshModels]);

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
      const body: Record<string, string> = {};
      if (editName.trim()) body.model_name = editName.trim();
      if (editApiKey.trim()) body.api_key = editApiKey.trim();
      body.api_base = editApiBase.trim();
      await fetch(`${apiBase()}/models/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setEditingId(null);
      refreshModels();
    } catch {
      // 静かに失敗
    } finally {
      setEditSaving(false);
    }
  }, [editingId, editName, editApiKey, editApiBase, refreshModels]);

  // ── 保存 ──
  const handleSave = useCallback(() => {
    saveSettings({ model, embeddingModel, profile, disabledTools, registryUrl: registryUrl.trim().replace(/\/+$/, ""), customLabels });
    setSaved(true);
    setTimeout(() => onClose(), 600);
  }, [model, embeddingModel, profile, customLabels, onClose]);

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
        {(["general", "labels", "ai-setup"] as Tab[]).map((tabId) => (
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

            {/* プロファイル選択 */}
            <div>
              <label className="text-xs font-semibold text-foreground mb-1 block">
                {t("settings.profile")}
              </label>
              <div className="relative">
                <select
                  value={profile}
                  onChange={(e) => { setProfile(e.target.value); setSaved(false); }}
                  disabled={profilesLoading || profiles.length === 0}
                  className="w-full appearance-none rounded-md border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground transition-colors focus:border-primary focus:outline-none disabled:opacity-50"
                >
                  <option value="">
                    {profilesLoading ? t("settings.profileLoading") : profiles.length === 0 ? t("settings.profileNone") : t("settings.profileDefault")}
                  </option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.name}>{p.name} — {p.description}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">{t("settings.profileHelp")}</p>
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

            {/* バックエンド未接続時は案内のみ表示 */}
            {!healthLoading && !health ? (
              <div className="rounded-lg border border-dashed border-border p-4 text-center">
                <p className="text-xs text-muted-foreground">
                  {t("settings.health.unavailable")}
                </p>
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
                      <div className="space-y-1">
                        {providerGroups.map((g) => (
                          <button
                            key={g.representativeId}
                            onClick={() => {
                              setSourceModelId(g.representativeId);
                              setAddProvider(g.provider);
                              setAvailableModels([]);
                              setSelectedModelId("");
                              setCustomModelId("");
                              setAddError("");
                            }}
                            className={`w-full text-left px-3 py-2 text-xs rounded-md border transition-colors ${
                              sourceModelId === g.representativeId
                                ? "border-primary bg-primary/10 text-primary font-medium"
                                : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                            }`}
                          >
                            {g.label}
                          </button>
                        ))}
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
