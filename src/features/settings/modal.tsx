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
import { loadSettings, saveSettings, type Settings, type CustomLabels, type ExperimentalSettings, getLLMModels, addLLMModel, removeLLMModel, type LLMModelConfig, type LatinFont, type JpFont, LATIN_FONTS, JP_FONTS, applyFontMode } from "./store";
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
import { fetchCapabilities, setServerStorageToken } from "../../lib/storage/providers/server-fs";
import { AiUpgradeNotice } from "../../components/AiUpgradeNotice";
import { Globe2 } from "lucide-react";
import { loadKb, type KbFile, type KbEntry } from "../world-grounding";
import type { GroundingValidityVerdict } from "../../lib/document-types";
import {
  loadAuthorIdentity,
  saveAuthorIdentity,
  validateAuthorIdentity,
} from "../identity";
import {
  getSharedRoot,
  setSharedRoot,
  getBlobRoot,
  setBlobRoot,
  pickSharedRoot,
  pickBlobRoot,
  testSharedConnection,
  testBlobConnection,
  type ConnectionTestResult,
} from "../../lib/storage/shared";

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

type Tab = "display" | "storage" | "ai" | "labels" | "experimental" | "grounding" | "maintenance";

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

export type DiscoveryProgressInfo = {
  iteration: number;
  createdSoFar: number;
  /** Phase 1 クラスタサンプリング: 現在の iter のクラスタ情報。未設定なら旧表示。 */
  clusterLabel?: string;
  clusterTotal?: number;
  clusterSize?: number;
  /** クラスタに含まれるアイテム名のプレビュー（先頭 N 件）。中身が見えない問題への対策。 */
  clusterMemberTitles?: string[];
};
export type DiscoveryHandler = (
  onProgress?: (info: DiscoveryProgressInfo) => void,
) => Promise<{ ok: boolean; created: number; iterations: number; error?: string }>;

type BulkFailedItem = { id: string; title: string; error?: string };
type BulkProgress = {
  done: number;
  total: number;
  failed: number;
  current?: string;
  currentModel?: string;
  failedItems: BulkFailedItem[];
};

// ラベルタブで使う内部キーと i18n デフォルト名のマッピング
const LABEL_I18N_KEYS: Record<CoreLabel, string> = {
  procedure: "label.step",
  plan: "label.plan",
  result: "label.result",
  material: "label.material",
  tool: "label.tool",
  attribute: "label.attr",
  output: "label.output",
};

type SettingsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  /** Maintenance タブの一括 Regenerate 用 Wiki 一覧 */
  wikiSummaries?: WikiSummaryForSettings[];
  /** Maintenance タブから 1 件ずつ呼ばれる再生成ハンドラ */
  onRegenerateWiki?: RegenerateWikiHandler;
  /** Maintenance タブの「Atom を発見」ハンドラ（atomLayer 有効時のみ表示）。
   *  全 Concept を見渡し、複数 Concept にまたがる共通抽象を auto-loop で発見する。 */
  onRunAtomizeDiscovery?: DiscoveryHandler;
  /** Maintenance タブの「Synthesis を発見」ハンドラ（synthesis 有効時のみ表示）。
   *  全 Atom を見渡し、Atom 同士の結合から立ち上がる新しい洞察を auto-loop で発見する。 */
  onRunSynthesisDiscovery?: DiscoveryHandler;
  /** 全 Wiki の embedding を再生成する。AI チャットでの引用検索（Retriever）の精度を回復させたい時に使う。 */
  onReembedAllWikis?: (onProgress: (done: number, total: number) => void) => Promise<void>;
};

export function SettingsModal({ isOpen, onClose, wikiSummaries, onRegenerateWiki, onRunAtomizeDiscovery, onRunSynthesisDiscovery, onReembedAllWikis }: SettingsModalProps) {
  const { locale, setLocale, t } = useLocale();
  const [tab, setTab] = useState<Tab>("display");

  // 設定値
  const [model, setModel] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState("");
  // 埋め込みモデル接続テストの結果。保存前に、選んだモデルが実際に
  // /v1/embeddings に対応するかを 1 リクエストで確認できる。
  const [embTestState, setEmbTestState] = useState<{
    status: "idle" | "running" | "success" | "error";
    message?: string;
    dimensions?: number;
  }>({ status: "idle" });
  const [chatSynthesisModel, setChatSynthesisModel] = useState("");
  const [disabledTools, setDisabledTools] = useState<string[]>([]);
  const [registryUrl, setRegistryUrl] = useState("");
  const [customLabels, setCustomLabels] = useState<CustomLabels>({});
  const [latinFont, setLatinFont] = useState<LatinFont>("");
  const [jpFont, setJpFont] = useState<JpFont>("");
  const [experimental, setExperimental] = useState<ExperimentalSettings>({ atomLayer: false, synthesis: false });

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

  // AuthorIdentity（team-shared-storage Phase 0）
  const [authorName, setAuthorName] = useState("");
  const [authorEmail, setAuthorEmail] = useState("");
  const [identitySaved, setIdentitySaved] = useState(false);
  const [identityError, setIdentityError] = useState<string | null>(null);

  // Shared / Blob storage（team-shared-storage Phase 1c、Tauri 専用）
  const [sharedRoot, setSharedRootState] = useState<string>("");
  const [blobRoot, setBlobRootState] = useState<string>("");
  const [sharedTestResult, setSharedTestResult] = useState<ConnectionTestResult | null>(null);
  const [blobTestResult, setBlobTestResult] = useState<ConnectionTestResult | null>(null);
  const [sharedTestRunning, setSharedTestRunning] = useState(false);
  const [blobTestRunning, setBlobTestRunning] = useState(false);

  // サーバーストレージ機能（Docker / セルフホスト Web）
  const [serverCaps, setServerCaps] = useState<{ serverStorage: boolean; requiresAuth: boolean } | null>(null);
  const [serverToken, setServerTokenInput] = useState<string>(() => {
    if (typeof localStorage === "undefined") return "";
    return localStorage.getItem("graphium_server_token") ?? "";
  });
  const [serverTokenSaved, setServerTokenSaved] = useState(false);

  // ツール
  const [toolsData, setToolsData] = useState<ToolsResponse | null>(null);

  // Maintenance タブ — Wiki 一括 Regenerate
  const [bulkKinds, setBulkKinds] = useState<Set<WikiKind>>(new Set(["claim", "summary", "atom", "synthesis"]));
  const [bulkModelOverride, setBulkModelOverride] = useState("");
  const [bulkSynthesisModelOverride, setBulkSynthesisModelOverride] = useState("");
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<BulkProgress | null>(null);
  const cancelBulkRef = useRef(false);

  // Maintenance タブ — 既存 Concept をまたぐ Atom 候補を発見（atomLayer 有効時のみ）
  type DiscoveryUiState = {
    status: "running" | "done" | "error";
    inputCount: number;
    iteration?: number;
    created?: number;
    iterations?: number;
    error?: string;
    clusterLabel?: string;
    clusterTotal?: number;
    clusterSize?: number;
    clusterMemberTitles?: string[];
  };
  const [atomizeRunning, setAtomizeRunning] = useState(false);
  const [atomizeProgress, setAtomizeProgress] = useState<DiscoveryUiState | null>(null);
  // Maintenance タブ — Atom をまたぐ Synthesis 候補を発見（synthesis 有効時のみ）
  const [synthesisRunning, setSynthesisRunning] = useState(false);
  const [synthesisProgress, setSynthesisProgress] = useState<DiscoveryUiState | null>(null);

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
    setDisabledTools(settings.disabledTools ?? []);
    setRegistryUrl(settings.registryUrl ?? "");
    setCustomLabels(settings.customLabels ?? {});
    setLatinFont(settings.latinFont ?? "");
    setJpFont(settings.jpFont ?? "");
    setExperimental(settings.experimental ?? { atomLayer: false, synthesis: false });
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

    // AuthorIdentity を読み込む
    const identity = loadAuthorIdentity();
    setAuthorName(identity?.name ?? "");
    setAuthorEmail(identity?.email ?? "");
    setIdentitySaved(false);
    setIdentityError(null);

    // Shared / Blob root を読み込む
    setSharedRootState(getSharedRoot() ?? "");
    setBlobRootState(getBlobRoot() ?? "");
    setSharedTestResult(null);
    setBlobTestResult(null);

    // Web/Docker: サーバーストレージ機能を検出
    if (!isTauri()) {
      fetchCapabilities()
        .then((caps) => setServerCaps(caps))
        .catch(() => setServerCaps(null));
    }
  }, [isOpen, refreshModels]);

  const handleSaveIdentity = useCallback(() => {
    setIdentityError(null);
    setIdentitySaved(false);
    const validation = validateAuthorIdentity({ name: authorName, email: authorEmail });
    if (!validation.ok) {
      setIdentityError(t(`settings.identity.error.${validation.field}`));
      return;
    }
    try {
      saveAuthorIdentity({ name: authorName, email: authorEmail });
      setIdentitySaved(true);
    } catch (e) {
      setIdentityError(e instanceof Error ? e.message : String(e));
    }
  }, [authorName, authorEmail, t]);

  const handlePickSharedRoot = useCallback(async () => {
    try {
      const picked = await pickSharedRoot(sharedRoot || undefined);
      if (picked) {
        setSharedRoot(picked);
        setSharedRootState(picked);
        setSharedTestResult(null);
      }
    } catch (e) {
      setSharedTestResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }, [sharedRoot]);

  const handleClearSharedRoot = useCallback(() => {
    setSharedRoot(null);
    setSharedRootState("");
    setSharedTestResult(null);
  }, []);

  const handleTestSharedConnection = useCallback(async () => {
    if (!sharedRoot) return;
    setSharedTestRunning(true);
    setSharedTestResult(null);
    try {
      const identity = loadAuthorIdentity();
      if (!identity) {
        setSharedTestResult({
          ok: false,
          error: t("settings.shared.identityRequired"),
        });
        return;
      }
      const result = await testSharedConnection(sharedRoot, identity);
      setSharedTestResult(result);
    } finally {
      setSharedTestRunning(false);
    }
  }, [sharedRoot, t]);

  const handlePickBlobRoot = useCallback(async () => {
    try {
      const picked = await pickBlobRoot(blobRoot || undefined);
      if (picked) {
        setBlobRoot(picked);
        setBlobRootState(picked);
        setBlobTestResult(null);
      }
    } catch (e) {
      setBlobTestResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }, [blobRoot]);

  const handleClearBlobRoot = useCallback(() => {
    setBlobRoot(null);
    setBlobRootState("");
    setBlobTestResult(null);
  }, []);

  const handleTestBlobConnection = useCallback(async () => {
    if (!blobRoot) return;
    setBlobTestRunning(true);
    setBlobTestResult(null);
    try {
      const result = await testBlobConnection(blobRoot);
      setBlobTestResult(result);
    } finally {
      setBlobTestRunning(false);
    }
  }, [blobRoot]);

  const handleSaveServerToken = useCallback(() => {
    setServerStorageToken(serverToken.trim() || null);
    setServerTokenSaved(true);
    // 自動でリロードして新トークンで初期化させる
    setTimeout(() => {
      window.location.reload();
    }, 600);
  }, [serverToken]);

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
  // 埋め込みモデルへの接続テスト。/api/embeddings/test に 1 リクエスト送って、
  // 成功なら次元数を、失敗ならプロバイダーが返したエラー文をそのまま表示する。
  // モデル設定が未保存でも、UI の選択値を直接 X-LLM-API-Key として注入してテストする。
  const handleTestEmbedding = useCallback(async () => {
    setEmbTestState({ status: "running" });
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (embeddingModel) {
        const cfg = getLLMModels().find((m) => m.name === embeddingModel);
        if (cfg) {
          headers["X-LLM-API-Key"] = JSON.stringify({
            provider: cfg.provider,
            modelId: cfg.modelId,
            apiKey: cfg.apiKey,
            apiBase: cfg.apiBase,
            name: cfg.name,
          });
        }
      }
      // embeddingModel 未選択 (= chat と同じ) の場合は header を付けず、サーバー側の
      // default model でテストする。Tauri モードでは models.json から取られる。

      const res = await fetch(`${apiBase()}/embeddings/test`, {
        method: "POST",
        headers,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Error ${res.status}`);
      }
      setEmbTestState({
        status: "success",
        dimensions: typeof data.dimensions === "number" ? data.dimensions : undefined,
      });
    } catch (err) {
      setEmbTestState({
        status: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }, [embeddingModel]);

  // embedding モデル選択を変えたら、過去のテスト結果は無効化する。
  useEffect(() => {
    if (embTestState.status !== "idle") setEmbTestState({ status: "idle" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embeddingModel]);

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
    saveSettings({ model, embeddingModel, chatSynthesisModel, disabledTools, registryUrl: registryUrl.trim().replace(/\/+$/, ""), customLabels, latinFont, jpFont, experimental });
    applyFontMode(latinFont, jpFont);
    setSaved(true);
    setTimeout(() => onClose(), 600);
  }, [model, embeddingModel, chatSynthesisModel, disabledTools, registryUrl, customLabels, latinFont, jpFont, experimental, onClose]);

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
        {(["display", "storage", "ai", "labels", "experimental", "grounding", "maintenance"] as Tab[]).map((tabId) => {
          const labelKey =
            tabId === "display" ? "settings.section.display"
            : tabId === "storage" ? "settings.section.storage"
            : tabId === "ai" ? "settings.section.ai"
            : tabId === "labels" ? "settings.tab.labels"
            : tabId === "experimental" ? "settings.tab.experimental"
            : tabId === "grounding" ? "settings.tab.grounding"
            : "settings.tab.maintenance";
          return (
            <button
              key={tabId}
              onClick={() => setTab(tabId)}
              className={`px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
                tab === tabId
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(labelKey)}
            </button>
          );
        })}
      </div>

      <ModalBody className="w-full min-w-[460px] max-w-lg" onKeyDown={handleKeyDown}>
        {/* ── Display タブ ── */}
        {tab === "display" && (
          <div className="space-y-4">
            {/* 言語 */}
            <div>
              <label className="text-xs font-semibold text-foreground mb-2 block">
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
              <label className="text-xs font-semibold text-foreground mb-2 block">
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
              <p className="text-xs text-muted-foreground mt-2">{t("settings.fontHelp")}</p>
            </div>
          </div>
        )}

        {/* ── AI タブ：利用設定 ── */}
        {tab === "ai" && (
          <div className="space-y-4">
            {/* モデル選択 */}
            <div>
              <label className="text-xs font-semibold text-foreground mb-2 block">
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
              <p className="text-xs text-muted-foreground mt-2">{t("settings.modelHelp")}</p>
            </div>

            {/* Embedding モデル選択 */}
            <div>
              <label className="text-xs font-semibold text-foreground mb-2 block">
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
              {/* 接続テストボタンと結果表示 */}
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={handleTestEmbedding}
                  disabled={embTestState.status === "running" || (models.length === 0)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border bg-background text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {embTestState.status === "running"
                    ? t("settings.embeddingModel.testing")
                    : t("settings.embeddingModel.test")}
                </button>
                {embTestState.status === "success" && (
                  <span className="text-xs text-emerald-700 dark:text-emerald-400">
                    ✓ {embTestState.dimensions
                      ? t("settings.embeddingModel.testSuccess", { dimensions: String(embTestState.dimensions) })
                      : t("settings.embeddingModel.testSuccessNoDim")}
                  </span>
                )}
                {embTestState.status === "error" && (
                  <span className="text-xs text-amber-700 dark:text-amber-400 break-all">
                    ⚠ {embTestState.message ?? "Unknown error"}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Embedding requires OpenAI or OpenAI-compatible provider. Leave empty to use text-match fallback.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t("settings.embeddingModel.note")}
              </p>
            </div>

            {/* Chat & Synthesis モデル選択（対話と統合用 — default より上のモデルを当てる場面用） */}
            <div>
              <label className="text-xs font-semibold text-foreground mb-2 block">
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
              <p className="text-xs text-muted-foreground mt-2">
                {t("settings.chatSynthesisModelHelp")}
              </p>
            </div>

          </div>
        )}

        {/* ── Storage タブ ── */}
        {tab === "storage" && (
          <div className="space-y-4">
            {/* AuthorIdentity（team-shared-storage Phase 0） */}
            <div>
              <label className="text-xs font-semibold text-foreground mb-1 block">
                {t("settings.identity.title")}
              </label>
              <p className="text-xs text-muted-foreground mb-2">
                {t("settings.identity.help")}
              </p>
              <div className="space-y-2">
                <div>
                  <div className="text-[11px] text-muted-foreground mb-1">
                    {t("settings.identity.name")}
                  </div>
                  <Input
                    type="text"
                    value={authorName}
                    onChange={(e) => {
                      setAuthorName(e.target.value);
                      setIdentitySaved(false);
                      setIdentityError(null);
                    }}
                    placeholder={t("settings.identity.namePlaceholder")}
                    autoComplete="name"
                  />
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground mb-1">
                    {t("settings.identity.email")}
                  </div>
                  <Input
                    type="email"
                    value={authorEmail}
                    onChange={(e) => {
                      setAuthorEmail(e.target.value);
                      setIdentitySaved(false);
                      setIdentityError(null);
                    }}
                    placeholder={t("settings.identity.emailPlaceholder")}
                    autoComplete="email"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={handleSaveIdentity}
                    disabled={!authorName.trim() || !authorEmail.trim()}
                  >
                    {t("settings.identity.save")}
                  </Button>
                  {identitySaved && (
                    <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                      <CheckCircle size={12} className="text-green-600" />
                      {t("settings.identity.saved")}
                    </span>
                  )}
                </div>
                {identityError && (
                  <p className="text-xs text-red-500 flex items-center gap-1">
                    <AlertCircle size={12} /> {identityError}
                  </p>
                )}
              </div>
            </div>

            {/* サーバーストレージ（Docker / セルフホスト Web のみ） */}
            {!isTauri() && serverCaps?.serverStorage && (
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <FolderOpen size={14} className="text-muted-foreground" />
                  <label className="text-xs font-semibold text-foreground">
                    {t("settings.serverStorage.title")}
                  </label>
                </div>
                <p className="text-xs text-muted-foreground mb-2">
                  {t("settings.serverStorage.help")}
                </p>
                {serverCaps.requiresAuth ? (
                  <div className="space-y-2">
                    <Input
                      type="password"
                      value={serverToken}
                      onChange={(e) => { setServerTokenInput(e.target.value); setServerTokenSaved(false); }}
                      placeholder={t("settings.serverStorage.tokenPlaceholder")}
                      autoComplete="off"
                    />
                    <div className="flex items-center gap-2">
                      <Button size="sm" onClick={handleSaveServerToken} disabled={!serverToken}>
                        {t("settings.serverStorage.save")}
                      </Button>
                      {serverTokenSaved && (
                        <span className="text-xs text-muted-foreground">
                          {t("settings.serverStorage.savedReloading")}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("settings.serverStorage.tokenHelp")}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t("settings.serverStorage.noAuth")}
                  </p>
                )}
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

            {/* Shared storage（team-shared-storage Phase 1c、Tauri 専用） */}
            {isTauri() ? (
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <FolderOpen size={14} className="text-muted-foreground" />
                  <label className="text-xs font-semibold text-foreground">
                    {t("settings.shared.title")}
                  </label>
                </div>
                <p className="text-xs text-muted-foreground mb-2">
                  {t("settings.shared.help")}
                </p>

                {/* Shared root */}
                <div className="rounded-md border border-border bg-background px-3 py-2 space-y-2">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t("settings.shared.rootLabel")}
                  </div>
                  {sharedRoot ? (
                    <div className="text-xs font-mono text-foreground break-all">{sharedRoot}</div>
                  ) : (
                    <div className="text-xs text-muted-foreground italic">
                      {t("settings.shared.notSet")}
                    </div>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button size="sm" variant="ghost" onClick={handlePickSharedRoot}>
                      {sharedRoot ? t("settings.shared.change") : t("settings.shared.pick")}
                    </Button>
                    {sharedRoot && (
                      <>
                        <Button
                          size="sm"
                          onClick={handleTestSharedConnection}
                          disabled={sharedTestRunning}
                        >
                          {sharedTestRunning ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            t("settings.shared.test")
                          )}
                        </Button>
                        <button
                          onClick={handleClearSharedRoot}
                          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                        >
                          <RotateCcw size={12} />
                          {t("settings.shared.clear")}
                        </button>
                      </>
                    )}
                  </div>
                  {sharedTestResult && (
                    <div className="text-xs">
                      {sharedTestResult.ok ? (
                        <p className="flex items-center gap-1 text-green-600">
                          <CheckCircle size={12} />
                          {t("settings.shared.testOk")}
                        </p>
                      ) : (
                        <p className="flex items-start gap-1 text-red-500">
                          <AlertCircle size={12} className="mt-0.5 shrink-0" />
                          <span className="break-all">{sharedTestResult.error}</span>
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Blob root */}
                <div className="rounded-md border border-border bg-background px-3 py-2 space-y-2 mt-2">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t("settings.shared.blobRootLabel")}
                  </div>
                  {blobRoot ? (
                    <div className="text-xs font-mono text-foreground break-all">{blobRoot}</div>
                  ) : (
                    <div className="text-xs text-muted-foreground italic">
                      {t("settings.shared.notSet")}
                    </div>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button size="sm" variant="ghost" onClick={handlePickBlobRoot}>
                      {blobRoot ? t("settings.shared.change") : t("settings.shared.pick")}
                    </Button>
                    {blobRoot && (
                      <>
                        <Button
                          size="sm"
                          onClick={handleTestBlobConnection}
                          disabled={blobTestRunning}
                        >
                          {blobTestRunning ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            t("settings.shared.test")
                          )}
                        </Button>
                        <button
                          onClick={handleClearBlobRoot}
                          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                        >
                          <RotateCcw size={12} />
                          {t("settings.shared.clear")}
                        </button>
                      </>
                    )}
                  </div>
                  {blobTestResult && (
                    <div className="text-xs">
                      {blobTestResult.ok ? (
                        <p className="flex items-center gap-1 text-green-600">
                          <CheckCircle size={12} />
                          {t("settings.shared.testOk")}
                        </p>
                      ) : (
                        <p className="flex items-start gap-1 text-red-500">
                          <AlertCircle size={12} className="mt-0.5 shrink-0" />
                          <span className="break-all">{blobTestResult.error}</span>
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <p className="text-xs text-muted-foreground mt-2">
                  {t("settings.shared.note")}
                </p>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <FolderOpen size={14} className="text-muted-foreground" />
                  <label className="text-xs font-semibold text-foreground">
                    {t("settings.shared.title")}
                  </label>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("settings.shared.desktopOnly")}
                </p>
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

        {/* ── AI タブ：モデル管理 ── */}
        {tab === "ai" && (
          <div className="space-y-5 mt-6 pt-6 border-t border-border">
            {/* AI バックエンド未接続時はアップグレード CTA を表示 */}
            {!healthLoading && !health && (
              <AiUpgradeNotice variant="card" />
            )}

            {/* バックエンド未接続時は案内のみ。詳細はメンテナンスタブで確認・再起動 */}
            {!healthLoading && !health ? (
              <div className="rounded-lg border border-dashed border-border p-4">
                <p className="text-xs text-muted-foreground text-center">
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
                        <label className="text-xs font-medium text-foreground mb-2 block">{t("settings.addModel.displayName")}</label>
                        <Input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-foreground mb-2 block">{t("settings.models.editApiKey")}</label>
                        <Input type="password" value={editApiKey} onChange={(e) => setEditApiKey(e.target.value)} placeholder={t("settings.models.editApiKeyPlaceholder")} className="font-mono text-sm" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-foreground mb-2 block">API Base URL</label>
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
                      <label className="text-xs font-medium text-foreground mb-2 block">{t("settings.addModel.selectProvider")}</label>
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
                      <label className="text-xs font-medium text-foreground mb-2 block">{t("settings.addModel.provider")}</label>
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
                      <label className="text-xs font-medium text-foreground mb-2 block">{t("settings.addModel.apiKey")}</label>
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
                      <label className="text-xs font-medium text-foreground mb-2 block">
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
                      <label className="text-xs font-medium text-foreground mb-2 block">{t("settings.addModel.selectModel")}</label>
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
                      <label className="text-xs font-medium text-foreground mb-2 block">{t("settings.addModel.customId")}</label>
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
                      <label className="text-xs font-medium text-foreground mb-2 block">{t("settings.addModel.displayName")}</label>
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
              <label className="text-xs font-semibold text-foreground mb-2 block">
                {t("settings.registry.title")}
              </label>
              <Input
                type="url"
                value={registryUrl}
                onChange={(e) => { setRegistryUrl(e.target.value); setSaved(false); }}
                placeholder={t("settings.registry.placeholder")}
              />
              <p className="text-xs text-muted-foreground mt-2">{t("settings.registry.help")}</p>
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
              <p className="text-xs text-muted-foreground mt-2">
                {t("settings.tools.help")}
              </p>
            </div>

            </>}
          </div>
        )}

        {/* ── Experimental タブ ── */}
        {tab === "experimental" && (
          <div className="space-y-5">
            <div className="rounded-lg border border-border p-3">
              <h3 className="text-xs font-semibold text-foreground mb-1">
                {t("settings.experimental.title")}
              </h3>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {t("settings.experimental.intro")}
              </p>
            </div>

            <div className="space-y-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={experimental.atomLayer}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setExperimental((prev) => ({
                      atomLayer: next,
                      // Atom OFF にするとき Synthesis も強制 OFF（依存関係）
                      synthesis: next ? prev.synthesis : false,
                    }));
                    setSaved(false);
                  }}
                />
                <span className="flex-1">
                  <span className="block text-xs font-semibold text-foreground">
                    {t("settings.experimental.atom.title")}
                  </span>
                  <span className="block text-[11px] text-muted-foreground leading-relaxed mt-0.5">
                    {t("settings.experimental.atom.help")}
                  </span>
                </span>
              </label>

              <label className={`flex items-start gap-3 ${experimental.atomLayer ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}>
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={experimental.synthesis}
                  disabled={!experimental.atomLayer}
                  onChange={(e) => {
                    setExperimental((prev) => ({ ...prev, synthesis: e.target.checked }));
                    setSaved(false);
                  }}
                />
                <span className="flex-1">
                  <span className="block text-xs font-semibold text-foreground">
                    {t("settings.experimental.synthesis.title")}
                  </span>
                  <span className="block text-[11px] text-muted-foreground leading-relaxed mt-0.5">
                    {t("settings.experimental.synthesis.help")}
                  </span>
                </span>
              </label>
            </div>
          </div>
        )}

        {/* ── Grounding KB タブ（world-model-grounding Phase 2 / PR 2A） ── */}
        {tab === "grounding" && <GroundingKbTab />}

        {/* ── Maintenance タブ ── */}
        {tab === "maintenance" && (
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

            {/* バックエンド未接続時の再起動オプション (Tauri のみ) */}
            {!healthLoading && !health && isTauri() && (
              <div className="rounded-lg border border-dashed border-border p-4 space-y-3">
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
              </div>
            )}

            <MaintenanceTab
              t={t}
              wikiSummaries={wikiSummaries ?? []}
              onRegenerateWiki={onRegenerateWiki}
              onRunAtomizeDiscovery={onRunAtomizeDiscovery}
              onRunSynthesisDiscovery={onRunSynthesisDiscovery}
              atomLayerEnabled={experimental.atomLayer}
              synthesisLayerEnabled={experimental.atomLayer && experimental.synthesis}
              availableModels={models}
              defaultModel={model || defaultModel}
              chatSynthesisModel={chatSynthesisModel}
              bulkKinds={bulkKinds}
              setBulkKinds={setBulkKinds}
              bulkModelOverride={bulkModelOverride}
              setBulkModelOverride={setBulkModelOverride}
              bulkSynthesisModelOverride={bulkSynthesisModelOverride}
              setBulkSynthesisModelOverride={setBulkSynthesisModelOverride}
              bulkRunning={bulkRunning}
              setBulkRunning={setBulkRunning}
              bulkProgress={bulkProgress}
              setBulkProgress={setBulkProgress}
              cancelBulkRef={cancelBulkRef}
              atomizeRunning={atomizeRunning}
              setAtomizeRunning={setAtomizeRunning}
              atomizeProgress={atomizeProgress}
              setAtomizeProgress={setAtomizeProgress}
              synthesisRunning={synthesisRunning}
              setSynthesisRunning={setSynthesisRunning}
              synthesisProgress={synthesisProgress}
              setSynthesisProgress={setSynthesisProgress}
              onReembedAllWikis={onReembedAllWikis}
            />
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

// ── Maintenance タブ ──
// Knowledge レイヤのメンテナンス操作。今は Wiki 一括 Regenerate のみ
type DiscoveryRunState = {
  status: "running" | "done" | "error";
  /** 入力アイテム数（Concept 数 / Atom 数） */
  inputCount: number;
  iteration?: number;
  created?: number;
  iterations?: number;
  error?: string;
  /** Phase 1 クラスタサンプリング: 現在の iter のクラスタ情報。未設定なら旧表示。 */
  clusterLabel?: string;
  clusterTotal?: number;
  clusterSize?: number;
  clusterMemberTitles?: string[];
};

type MaintenanceTabProps = {
  t: (key: string) => string;
  wikiSummaries: WikiSummaryForSettings[];
  onRegenerateWiki?: RegenerateWikiHandler;
  onRunAtomizeDiscovery?: DiscoveryHandler;
  onRunSynthesisDiscovery?: DiscoveryHandler;
  atomLayerEnabled: boolean;
  synthesisLayerEnabled: boolean;
  availableModels: ModelInfo[];
  defaultModel: string;
  chatSynthesisModel: string;
  bulkKinds: Set<WikiKind>;
  setBulkKinds: (s: Set<WikiKind>) => void;
  bulkModelOverride: string;
  setBulkModelOverride: (s: string) => void;
  bulkSynthesisModelOverride: string;
  setBulkSynthesisModelOverride: (s: string) => void;
  bulkRunning: boolean;
  setBulkRunning: (b: boolean) => void;
  bulkProgress: BulkProgress | null;
  setBulkProgress: (p: BulkProgress | null) => void;
  cancelBulkRef: { current: boolean };
  atomizeRunning: boolean;
  setAtomizeRunning: (b: boolean) => void;
  atomizeProgress: DiscoveryRunState | null;
  setAtomizeProgress: (p: DiscoveryRunState | null) => void;
  synthesisRunning: boolean;
  setSynthesisRunning: (b: boolean) => void;
  synthesisProgress: DiscoveryRunState | null;
  setSynthesisProgress: (p: DiscoveryRunState | null) => void;
  onReembedAllWikis?: (onProgress: (done: number, total: number) => void) => Promise<void>;
};

function MaintenanceTab({
  t,
  wikiSummaries,
  onRegenerateWiki,
  onRunAtomizeDiscovery,
  onRunSynthesisDiscovery,
  atomLayerEnabled,
  synthesisLayerEnabled,
  availableModels,
  defaultModel,
  chatSynthesisModel,
  bulkKinds,
  setBulkKinds,
  bulkModelOverride,
  setBulkModelOverride,
  bulkSynthesisModelOverride,
  setBulkSynthesisModelOverride,
  bulkRunning,
  setBulkRunning,
  bulkProgress,
  setBulkProgress,
  cancelBulkRef,
  atomizeRunning,
  setAtomizeRunning,
  atomizeProgress,
  setAtomizeProgress,
  synthesisRunning,
  setSynthesisRunning,
  synthesisProgress,
  setSynthesisProgress,
  onReembedAllWikis,
}: MaintenanceTabProps) {
  const KINDS: WikiKind[] = ["claim", "summary", "atom", "synthesis"];
  const [cancelling, setCancelling] = useState(false);
  const [reembedRunning, setReembedRunning] = useState(false);
  const [reembedProgress, setReembedProgress] = useState<{ done: number; total: number } | null>(null);
  const [reembedError, setReembedError] = useState<string | null>(null);

  // 表示値: 明示的に指定されていなければ設定の現在値をライブで反映する
  const effectiveDefaultModel = bulkModelOverride || defaultModel;
  const effectiveSynthesisModel =
    bulkSynthesisModelOverride || chatSynthesisModel || defaultModel;

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
      const kind = wikiSummaries.find((s) => s.id === w.id)?.kind;
      const modelForKind = kind === "synthesis" ? effectiveSynthesisModel : effectiveDefaultModel;
      setBulkProgress({ done, total: items.length, failed, current: w.title, currentModel: modelForKind, failedItems });
      const result = await onRegenerateWiki(w.id, modelForKind ? { model: modelForKind } : undefined);
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
    k === "claim" ? t("settings.maintenance.kind.claim")
    : k === "summary" ? t("settings.maintenance.kind.summary")
    : k === "atom" ? t("settings.maintenance.kind.atom")
    : t("settings.maintenance.kind.synthesis");

  // ── Atom 候補の発見（auto-loop: 0 件返却 or 上限まで自動継続）──
  const conceptCount = wikiSummaries.filter((w) => w.kind === "claim").length;
  const atomCount = wikiSummaries.filter((w) => w.kind === "atom").length;
  const handleRunAtomizeDiscovery = async () => {
    if (!onRunAtomizeDiscovery || atomizeRunning) return;
    if (conceptCount < 2) return;
    if (!window.confirm(t("settings.maintenance.atomize.confirm").replace("{count}", String(conceptCount)))) return;

    setAtomizeRunning(true);
    setAtomizeProgress({ status: "running", inputCount: conceptCount, iteration: 1, created: 0 });

    const result = await onRunAtomizeDiscovery((info) => {
      setAtomizeProgress({
        status: "running",
        inputCount: conceptCount,
        iteration: info.iteration,
        created: info.createdSoFar,
        clusterLabel: info.clusterLabel,
        clusterTotal: info.clusterTotal,
        clusterSize: info.clusterSize,
        clusterMemberTitles: info.clusterMemberTitles,
      });
    });
    if (result.ok) {
      setAtomizeProgress({ status: "done", inputCount: conceptCount, created: result.created, iterations: result.iterations });
    } else {
      setAtomizeProgress({ status: "error", inputCount: conceptCount, error: result.error });
    }
    setAtomizeRunning(false);
  };

  // ── Synthesis 候補の発見（同じ auto-loop パターン。Atom が 3 件以上必要）──
  const handleRunSynthesisDiscovery = async () => {
    if (!onRunSynthesisDiscovery || synthesisRunning) return;
    if (atomCount < 3) return;
    if (!window.confirm(t("settings.maintenance.synthesize.confirm").replace("{count}", String(atomCount)))) return;

    setSynthesisRunning(true);
    setSynthesisProgress({ status: "running", inputCount: atomCount, iteration: 1, created: 0 });

    const result = await onRunSynthesisDiscovery((info) => {
      setSynthesisProgress({
        status: "running",
        inputCount: atomCount,
        iteration: info.iteration,
        created: info.createdSoFar,
        clusterLabel: info.clusterLabel,
        clusterTotal: info.clusterTotal,
        clusterSize: info.clusterSize,
        clusterMemberTitles: info.clusterMemberTitles,
      });
    });
    if (result.ok) {
      setSynthesisProgress({ status: "done", inputCount: atomCount, created: result.created, iterations: result.iterations });
    } else {
      setSynthesisProgress({ status: "error", inputCount: atomCount, error: result.error });
    }
    setSynthesisRunning(false);
  };

  return (
    <div className="space-y-5">
      {/* Atom 候補の発見（atomLayer 有効時のみ表示）。
          全 Concept をまたぐ共通抽象を auto-loop で discover する。 */}
      {atomLayerEnabled && onRunAtomizeDiscovery && (
        <DiscoveryCard
          t={t}
          titleKey="settings.maintenance.atomize.title"
          helpKey="settings.maintenance.atomize.help"
          inputCount={conceptCount}
          minInput={2}
          progress={atomizeProgress}
          running={atomizeRunning}
          onRun={handleRunAtomizeDiscovery}
          discoveringKey="settings.maintenance.atomize.discovering"
          doneKey="settings.maintenance.atomize.doneCount"
          runKey="settings.maintenance.atomize.run"
          runningKey="settings.maintenance.atomize.running"
        />
      )}

      {/* Synthesis 候補の発見（synthesis 有効時のみ表示）。
          全 Atom をまたぐ新しい洞察を auto-loop で discover する。 */}
      {synthesisLayerEnabled && onRunSynthesisDiscovery && (
        <DiscoveryCard
          t={t}
          titleKey="settings.maintenance.synthesize.title"
          helpKey="settings.maintenance.synthesize.help"
          inputCount={atomCount}
          minInput={3}
          progress={synthesisProgress}
          running={synthesisRunning}
          onRun={handleRunSynthesisDiscovery}
          discoveringKey="settings.maintenance.synthesize.discovering"
          doneKey="settings.maintenance.synthesize.doneCount"
          runKey="settings.maintenance.synthesize.run"
          runningKey="settings.maintenance.synthesize.running"
        />
      )}

      {/* 全 Wiki の embedding を再生成。
          AI チャットの Retriever が引用元を検索するための embedding を IndexedDB に作り直す。
          既存ユーザーの wiki が embedding 機能導入前に作られていた場合や、Embedding model を切り替えた直後に使う。 */}
      {onReembedAllWikis && wikiSummaries.length > 0 && (
        <div className="rounded-lg border border-border p-3 space-y-3">
          <div>
            <div className="text-xs font-semibold text-foreground mb-1">
              Re-embed all Wikis
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              AI チャットの引用検索（Retriever）が動かないときに使う。全 Wiki の埋め込みを作り直して IndexedDB に保存する。
            </p>
          </div>
          {reembedProgress && reembedRunning && (
            <div className="text-[11px] text-muted-foreground">
              Embedding... {reembedProgress.done} / {reembedProgress.total}
            </div>
          )}
          {reembedProgress && !reembedRunning && !reembedError && (
            <div className="text-[11px] text-emerald-600 dark:text-emerald-400">
              Done. {reembedProgress.done} / {reembedProgress.total} wikis embedded.
            </div>
          )}
          {reembedError && (
            <div className="text-[11px] text-red-600 dark:text-red-400">
              {reembedError}
            </div>
          )}
          <Button
            size="sm"
            disabled={reembedRunning}
            onClick={async () => {
              const total = wikiSummaries.length;
              const confirmed = window.confirm(
                `Re-embed all ${total} wikis? This may take a while and consumes embedding API tokens.`,
              );
              if (!confirmed) return;
              setReembedRunning(true);
              setReembedError(null);
              setReembedProgress({ done: 0, total });
              try {
                await onReembedAllWikis((done, t) => setReembedProgress({ done, total: t }));
              } catch (e) {
                setReembedError(e instanceof Error ? e.message : String(e));
              } finally {
                setReembedRunning(false);
              }
            }}
          >
            {reembedRunning ? (
              <><Loader2 size={12} className="animate-spin mr-1.5" />Re-embedding...</>
            ) : (
              `Re-embed ${wikiSummaries.length} wiki${wikiSummaries.length === 1 ? "" : "s"}`
            )}
          </Button>
        </div>
      )}

      {/* Wiki 一括 Regenerate（Atomize と視覚的に揃えるためカード化） */}
      <div className="rounded-lg border border-border p-3 space-y-4">
        <div>
          <div className="text-xs font-semibold text-foreground mb-1">
            {t("settings.maintenance.regenAll.title")}
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {t("settings.maintenance.regenAll.help")}
          </p>
        </div>

      {/* kind フィルタ */}
      <div>
        <label className="text-xs font-semibold text-foreground mb-2 block">
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

      {/* モデル指定（kind 別） */}
      <div className="space-y-3">
        {/* Concept / Summary（Ingest モデル） */}
        <div>
          <label className="text-xs font-semibold text-foreground mb-2 block">
            {t("settings.maintenance.conceptSummaryModel")}
          </label>
          <div className="relative">
            <select
              value={effectiveDefaultModel}
              onChange={(e) => setBulkModelOverride(e.target.value)}
              disabled={bulkRunning}
              className="w-full appearance-none rounded-md border border-border bg-background px-3 py-1.5 pr-8 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            >
              {availableModels.length === 0 && <option value="">{t("settings.modelNone")}</option>}
              {availableModels.map((m) => (
                <option key={m.id || m.name} value={m.name}>
                  {m.name}
                  {m.provider ? ` — ${m.provider}` : ""}
                  {m.name === defaultModel ? ` (${t("settings.modelDefaultLabel")})` : ""}
                </option>
              ))}
            </select>
            <ChevronDown
              size={14}
              className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground"
            />
          </div>
        </div>

        {/* Synthesis / Atom（どちらも Chat & Synthesis モデルを使用）*/}
        <div>
          <label className="text-xs font-semibold text-foreground mb-2 block">
            {t("settings.maintenance.synthesisAtomModel")}
          </label>
          <div className="relative">
            <select
              value={effectiveSynthesisModel}
              onChange={(e) => setBulkSynthesisModelOverride(e.target.value)}
              disabled={bulkRunning}
              className="w-full appearance-none rounded-md border border-border bg-background px-3 py-1.5 pr-8 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            >
              {availableModels.length === 0 && <option value="">{t("settings.modelNone")}</option>}
              {availableModels.map((m) => (
                <option key={m.id || m.name} value={m.name}>
                  {m.name}
                  {m.provider ? ` — ${m.provider}` : ""}
                  {m.name === (chatSynthesisModel || defaultModel) ? " (現在の設定)" : ""}
                </option>
              ))}
            </select>
            <ChevronDown
              size={14}
              className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground"
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
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
              {bulkProgress.currentModel && (
                <span className="ml-2 opacity-70">— {bulkProgress.currentModel}</span>
              )}
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
          <p className="text-xs text-muted-foreground mt-2">
            {t("settings.maintenance.unavailable")}
          </p>
        )}
      </div>
      </div>
    </div>
  );
}

// ── 共通: Discovery カード（Atom / Synthesis で共有）──
// auto-loop の進捗表示（イテレーション数 / 累積件数）を担う。
// 入力アイテム数（Concept 数 or Atom 数）と最低必要数だけ差し替えれば再利用できる。
type DiscoveryCardProps = {
  t: (key: string) => string;
  titleKey: string;
  helpKey: string;
  inputCount: number;
  minInput: number;
  progress: DiscoveryRunState | null;
  running: boolean;
  onRun: () => void;
  discoveringKey: string;
  doneKey: string;
  runKey: string;
  runningKey: string;
};

function DiscoveryCard({
  t,
  titleKey,
  helpKey,
  inputCount,
  minInput,
  progress,
  running,
  onRun,
  discoveringKey,
  doneKey,
  runKey,
  runningKey,
}: DiscoveryCardProps) {
  return (
    <div className="rounded-lg border border-border p-3 space-y-3">
      <div>
        <div className="text-xs font-semibold text-foreground mb-1">
          {t(titleKey)}
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {t(helpKey).replace("{count}", String(inputCount))}
        </p>
      </div>

      {progress && (
        <div className="rounded-md border border-border bg-background px-3 py-2 text-xs space-y-1">
          {progress.status === "running" && (
            <div className="flex flex-col gap-1 text-muted-foreground">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse shrink-0" />
                <span>
                  {t(discoveringKey).replace("{count}", String(progress.inputCount))}
                  {progress.iteration !== undefined && (
                    <span className="ml-2 opacity-70">
                      (iter {progress.iteration}{progress.clusterTotal ? `/${progress.clusterTotal}` : ""}{progress.created ? ` / created ${progress.created}` : ""})
                    </span>
                  )}
                </span>
              </div>
              {progress.clusterLabel && (
                <div className="ml-4 text-[11px] opacity-80 break-words">
                  cluster: 「{progress.clusterLabel}」{progress.clusterSize ? ` (${progress.clusterSize})` : ""}
                </div>
              )}
              {progress.clusterMemberTitles && progress.clusterMemberTitles.length > 0 && (
                <details className="ml-4 text-[11px] opacity-70">
                  <summary className="cursor-pointer select-none">
                    members ({progress.clusterMemberTitles.length})
                  </summary>
                  <ul className="mt-1 ml-2 list-disc list-inside space-y-0.5 max-h-40 overflow-y-auto">
                    {progress.clusterMemberTitles.map((title, idx) => (
                      <li key={`${idx}-${title}`} className="break-words">{title}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          {progress.status === "done" && (
            <div className="text-foreground">
              {t(doneKey).replace("{count}", String(progress.created ?? 0))}
              {progress.iterations !== undefined && (
                <span className="ml-2 text-muted-foreground opacity-70">
                  ({progress.iterations} iter)
                </span>
              )}
            </div>
          )}
          {progress.status === "error" && (
            <div className="text-red-500">
              {t("settings.maintenance.failed")}: {progress.error ?? "unknown"}
            </div>
          )}
        </div>
      )}

      <Button size="sm" onClick={onRun} disabled={running || inputCount < minInput}>
        {running ? t(runningKey) : t(runKey)}
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Grounding KB タブ（world-model-grounding Phase 2 / PR 2A）
// 蒸留 KB の中身を確認・チューニング用のデバッグビューアー。
// 編集 UI は付けず、JSON 直編集 → リロードを促す（PR 2A スコープ）。
// ─────────────────────────────────────────────────────────────

const KB_DOMAINS = ["materials"] as const;
type KbDomain = (typeof KB_DOMAINS)[number];

const VERDICT_FILTERS: Array<"all" | GroundingValidityVerdict> = [
  "all",
  "established",
  "supported",
  "weak",
  "contested",
];

function GroundingKbTab() {
  const { t } = useLocale();
  const [domain, setDomain] = useState<KbDomain>("materials");
  const [kb, setKb] = useState<KbFile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | GroundingValidityVerdict>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const baseUrl =
      typeof import.meta !== "undefined" && import.meta.env?.BASE_URL
        ? import.meta.env.BASE_URL
        : "/";
    loadKb(domain, baseUrl)
      .then((file) => {
        if (cancelled) return;
        if (!file) {
          setError("KB not found or invalid");
          setKb(null);
        } else {
          setKb(file);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setKb(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [domain]);

  const filtered: KbEntry[] = useMemo(() => {
    if (!kb) return [];
    const q = query.trim().toLowerCase();
    return kb.entries.filter((e) => {
      if (filter !== "all" && e.verdict !== filter) return false;
      if (!q) return true;
      const hay = `${e.id} ${e.claim} ${e.rationale} ${e.keywords.join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
  }, [kb, filter, query]);

  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground">
        {t("settings.grounding.intro")}
      </div>

      {/* ドメインセレクタ（PR 2A は materials のみ） */}
      <div className="flex items-center gap-2">
        <label className="text-xs font-semibold text-foreground">
          {t("settings.grounding.domain")}:
        </label>
        <select
          value={domain}
          onChange={(e) => setDomain(e.target.value as KbDomain)}
          className="text-xs rounded border border-border bg-background px-2 py-1"
        >
          {KB_DOMAINS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        {kb && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {t("settings.grounding.count", { count: String(kb.entries.length) })}
          </span>
        )}
      </div>

      {/* フィルタ chips */}
      <div className="flex items-center gap-2 flex-wrap">
        {VERDICT_FILTERS.map((v) => (
          <button
            key={v}
            onClick={() => setFilter(v)}
            className={`px-2 py-1 text-[11px] rounded border transition-colors ${
              filter === v
                ? "border-primary text-primary bg-primary/10"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {v === "all"
              ? t("settings.grounding.filterAll")
              : t(`wikiBanner.worldVerdict.${v}` as any)}
          </button>
        ))}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("settings.grounding.searchPlaceholder")}
          className="ml-auto px-2 py-1 text-xs rounded border border-border bg-background w-48"
        />
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          {t("settings.grounding.loading")}
        </div>
      )}
      {error && (
        <div className="text-xs text-red-500">
          {t("settings.grounding.loadError")}: {error}
        </div>
      )}

      {kb && !loading && filtered.length === 0 && (
        <div className="text-xs text-muted-foreground py-4">
          {t("settings.grounding.empty")}
        </div>
      )}

      <div className="space-y-2 max-h-[420px] overflow-auto">
        {filtered.map((entry) => (
          <KbEntryRow key={entry.id} entry={entry} />
        ))}
      </div>

      <div className="text-[11px] text-muted-foreground border-t border-border pt-3">
        {t("settings.grounding.editHint")}{" "}
        <code className="text-[10px] bg-muted px-1 rounded">
          public/grounding-kb/{domain}.v1.json
        </code>
      </div>
    </div>
  );
}

function KbEntryRow({ entry }: { entry: KbEntry }) {
  const { t } = useLocale();
  const palette: Record<GroundingValidityVerdict, string> = {
    established: "text-emerald-700 bg-emerald-500/10",
    supported: "text-emerald-600 bg-emerald-500/5",
    weak: "text-amber-700 bg-amber-500/10",
    contested: "text-rose-700 bg-rose-500/10",
  };
  return (
    <div className="rounded border border-border p-2 text-xs">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
            palette[entry.verdict]
          }`}
        >
          <Globe2 size={9} />
          {t(`wikiBanner.worldVerdict.${entry.verdict}` as any)}
        </span>
        <code className="text-[10px] text-muted-foreground">{entry.id}</code>
      </div>
      <div className="text-foreground mb-1">{entry.claim}</div>
      <div className="text-muted-foreground mb-1">{entry.rationale}</div>
      <div className="flex items-start gap-1 flex-wrap">
        <span className="text-[10px] text-muted-foreground">keywords:</span>
        {entry.keywords.map((k, i) => (
          <code key={k + i} className="text-[10px] bg-muted px-1 rounded">
            {k}
          </code>
        ))}
      </div>
      {entry.sources && entry.sources.length > 0 && (
        <div className="flex items-start gap-1 flex-wrap mt-1">
          <span className="text-[10px] text-muted-foreground">sources:</span>
          {entry.sources.map((s, i) => (
            <span key={i} className="text-[10px]">
              {s.url ? (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                  title={s.url}
                >
                  {s.ref}
                </a>
              ) : (
                s.ref
              )}
              {i < entry.sources!.length - 1 && (
                <span className="text-muted-foreground">; </span>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
