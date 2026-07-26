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
  Plug,
  X,
  RotateCcw,
  Tag,
  FolderOpen,
  Info,
  Download,
} from "lucide-react";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@ui/modal";
import { Button } from "@ui/button";
import { Input } from "@ui/form-field";
import { loadSettings, saveSettings, type Settings, type CustomLabels, type ExperimentalSettings, getLLMModels, addLLMModel, removeLLMModel, type LLMModelConfig, type LatinFont, type JpFont, LATIN_FONTS, JP_FONTS, applyFontMode, type McpServerEntry, type McpTransport, type SavedRegistry, detectMcpTransport, parseMcpServersJson } from "./store";
import {
  fetchModels,
  type ModelInfo,
} from "../ai-assistant/api";
import { apiBase, isTauri } from "../../lib/platform";
import { aiErrorFromResponse, localizeAiError } from "../../lib/ai-error";
import { getAppVersion, checkForUpdates, type CheckResult } from "../../lib/updater";
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
import { getActiveProvider } from "../../lib/storage/registry";
import {
  exportAllNotesAsMarkdownZip,
  exportBackupZip,
  type BulkExportResult,
} from "../markdown-export";
import { AiUpgradeNotice } from "../../components/AiUpgradeNotice";
import { Globe2 } from "lucide-react";
import {
  clearKbCache,
  loadKb,
  removeFromKbCache,
  type KbEntry,
  type KbFile,
} from "../world-grounding";
import type { GroundingValidityVerdict } from "../../lib/document-types";
import {
  loadAuthorIdentity,
  saveAuthorIdentity,
  validateAuthorIdentity,
} from "../identity";
import { UsageTab } from "./UsageTab";
import { lookupModelPrice, type PricingEntry } from "../../lib/model-pricing";
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
  { id: "claude-subscription", name: "Claude (Subscription · Claude Code)" },
] as const;

// claude-subscription はモデル一覧 API を持たない（Claude Code に models コマンドが無く、
// この経路は API キーも持たないため /v1/models も叩けない）。
// エイリアス（sonnet/opus/haiku）だけを提示する。これらは Claude Code 側で「その時点の
// 最新版」に解決されるため、固定版 ID をハードコードすると自動更新できず劣化するのを避ける。
// どうしても版を固定したい上級者は「手動でモデル ID を入力」欄でフルネームを指定できる。
const CLAUDE_SUBSCRIPTION_MODELS = ["sonnet", "opus", "haiku"] as const;

const API_BASE_HINTS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  google: "https://generativelanguage.googleapis.com",
  groq: "https://api.groq.com/openai/v1",
  ollama: "http://localhost:11434",
  "openai-compatible": "https://api.example.com/v1",
  // claude-subscription では apiBase を「claude CLI の絶対パス」として流用する（通常は自動検出）。
  "claude-subscription": "auto-detected — leave blank unless not found",
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
  /** mcp_server の解決済みエンドポイント URL（「レジストリから追加」のピック用） */
  mcp_url?: string;
  transport?: McpTransport;
};

type ToolsResponse = {
  tools: ToolInfo[];
  sources: {
    crucible: { url: string; status: string; server_count: number };
  };
};

type Tab = "display" | "storage" | "ai" | "grounding" | "maintenance" | "usage" | "about";

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
  /** 任意オプション。テーマ駆動 Synthesizer など、handler によっては未使用。 */
  options?: { theme?: string },
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
  /** 開いたときに最初に表示するタブ（未指定なら前回のタブ / display）。 */
  initialTab?: string;
  /** Maintenance タブの一括 Regenerate 用 Wiki 一覧 */
  wikiSummaries?: WikiSummaryForSettings[];
  /** Maintenance タブから 1 件ずつ呼ばれる再生成ハンドラ */
  onRegenerateWiki?: RegenerateWikiHandler;
  /** Maintenance タブの「Atom を発見」ハンドラ（atomLayer 有効時のみ表示）。
   *  全 Concept を見渡し、複数 Concept にまたがる共通抽象を auto-loop で発見する。 */
  onRunAtomizeDiscovery?: DiscoveryHandler;
  /** 全 Wiki の embedding を再生成する。AI チャットでの引用検索（Retriever）の精度を回復させたい時に使う。 */
  onReembedAllWikis?: (onProgress: (done: number, total: number) => void) => Promise<void>;
};

export function SettingsModal({ isOpen, onClose, initialTab, wikiSummaries, onRegenerateWiki, onRunAtomizeDiscovery, onReembedAllWikis }: SettingsModalProps) {
  const { locale, setLocale, t } = useLocale();
  const [tab, setTab] = useState<Tab>("display");
  // initialTab 指定で開かれたら、そのタブに切り替える（AI 未設定バナーの「Set up AI」等）。
  useEffect(() => {
    if (isOpen && initialTab) setTab(initialTab as Tab);
  }, [isOpen, initialTab]);

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
  // PR 2B v2: groundingModel は型に残すが UI からは外し（Chat & Ideas モデル直接使用）、
  // saveSettings には localStorage 既存値をそのまま書き戻す pass-through 用に保持する
  const [groundingModelStored, setGroundingModelStored] = useState("");
  const [disabledTools, setDisabledTools] = useState<string[]>([]);
  const [registryUrl, setRegistryUrl] = useState("");
  // 手動登録の MCP サーバー（Crucible 非依存の接続経路）
  const [mcpServers, setMcpServers] = useState<McpServerEntry[]>([]);
  const [showMcpForm, setShowMcpForm] = useState(false);
  // 追加フォームの入力モード（paste = JSON コピペ / manual = フォーム / registry = レジストリから選ぶ）
  const [mcpAddMode, setMcpAddMode] = useState<"paste" | "manual" | "registry">("paste");
  const [mcpJson, setMcpJson] = useState("");
  const [mcpJsonError, setMcpJsonError] = useState<"" | "invalid-json" | "no-servers">("");
  // 追加/編集フォーム: 供給源の種別（stdio = ローカル spawn / remote = HTTP）
  const [mcpType, setMcpType] = useState<"stdio" | "remote">("stdio");
  const [mcpEditingId, setMcpEditingId] = useState<string | null>(null); // null = 新規追加
  const [mcpName, setMcpName] = useState("");
  // stdio 用フィールド
  const [mcpCommand, setMcpCommand] = useState("");
  const [mcpArgs, setMcpArgs] = useState("");   // 1 行 1 引数
  const [mcpEnv, setMcpEnv] = useState("");     // 1 行 KEY=value
  // remote 用フィールド
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpTransport, setMcpTransport] = useState<McpTransport>("sse");
  const [mcpTransportTouched, setMcpTransportTouched] = useState(false);
  const [mcpApiKey, setMcpApiKey] = useState("");
  // 「レジストリから追加」ブラウズ用
  const [savedRegistries, setSavedRegistries] = useState<SavedRegistry[]>([]);
  const [mcpBrowseUrl, setMcpBrowseUrl] = useState("");
  const [mcpBrowseKey, setMcpBrowseKey] = useState("");
  const [mcpCandidates, setMcpCandidates] = useState<ToolInfo[] | "loading" | "error" | null>(null);
  const [customLabels, setCustomLabels] = useState<CustomLabels>({});
  const [latinFont, setLatinFont] = useState<LatinFont>("");
  const [jpFont, setJpFont] = useState<JpFont>("");
  const [experimental, setExperimental] = useState<ExperimentalSettings>({ atomLayer: false, synthesis: false, autoGrounding: false });
  // 来歴ラベル機能（手順の PROV 化のためのラベルづけ）の有効/無効
  const [enableProvLabels, setEnableProvLabels] = useState<boolean>(false);

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

  // エクスポート / バックアップ（ストレージタブ）
  const [exportBusy, setExportBusy] = useState<"markdown" | "backup" | null>(null);
  const [exportResult, setExportResult] = useState<BulkExportResult | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // サーバーストレージ機能（Docker / セルフホスト Web）
  const [serverCaps, setServerCaps] = useState<{ serverStorage: boolean; requiresAuth: boolean } | null>(null);
  const [serverToken, setServerTokenInput] = useState<string>(() => {
    if (typeof localStorage === "undefined") return "";
    return localStorage.getItem("graphium_server_token") ?? "";
  });
  const [serverTokenSaved, setServerTokenSaved] = useState(false);

  // ツール

  // Maintenance タブ — Wiki 一括 Regenerate
  const [bulkKinds, setBulkKinds] = useState<Set<WikiKind>>(new Set(["claim", "summary", "atom"]));
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

  // モデル追加フォーム
  const [showAddForm, setShowAddForm] = useState(false);
  // claude-subscription 1-click（desktop で CLI 検出時のみ提示）
  const [claudeCliAvailable, setClaudeCliAvailable] = useState(false);
  // CLI にログイン中のアカウント（登録済みサブスクモデルに「どのアカウントで推論されるか」を表示）
  const [claudeCliAccount, setClaudeCliAccount] = useState<{
    email: string | null;
    organization: string | null;
  } | null>(null);
  // CLAUDE_CODE_OAUTH_TOKEN 設定時は CLI がログインよりトークンを優先するため表示を切り替える
  const [claudeTokenFromEnv, setClaudeTokenFromEnv] = useState(false);
  const [registeringSubscription, setRegisteringSubscription] = useState(false);
  const [subscriptionError, setSubscriptionError] = useState("");
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
  // 単価入力。空文字なら「未設定」扱い（コスト計算スキップ）。
  const [editRateInput, setEditRateInput] = useState("");
  const [editRateOutput, setEditRateOutput] = useState("");
  // 単価の通貨。デフォルト USD。さくら AI 等の円建てモデルでは JPY を選ぶ。
  const [editRateCurrency, setEditRateCurrency] = useState<"usd" | "jpy">("usd");
  // 既知モデルの参考価格。プロバイダー API では取れないので、内蔵テーブルから引く。
  const [editSuggestedRate, setEditSuggestedRate] = useState<PricingEntry | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  // 保存
  const [saved, setSaved] = useState(false);

  // Web モード判定（非 Tauri = Web）
  const isWebMode = !isTauri();

  // LLMModelConfig → ModelInfo 変換（Web モード用）
  // rate を落とすと handleStartEdit で既存値が読み出せず「保存しても反映されない」ように見えるため、
  // localStorage 側の camelCase → ModelInfo 側の snake_case に変換して必ず引き継ぐ。
  const toModelInfo = (m: LLMModelConfig): ModelInfo => ({
    name: m.name,
    provider: m.provider,
    model_id: m.modelId,
    api_base: m.apiBase ?? "",
    supports_function_calling: true,
    id: m.id,
    rate: m.rate
      ? {
          input: m.rate.input,
          output: m.rate.output,
          cache_read: m.rate.cacheRead,
          cache_write: m.rate.cacheWrite,
          currency: m.rate.currency ?? "usd",
        }
      : undefined,
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
    setGroundingModelStored(settings.groundingModel ?? "");
    setDisabledTools(settings.disabledTools ?? []);
    setRegistryUrl(settings.registryUrl ?? "");
    setMcpServers(settings.mcpServers ?? []);
    setSavedRegistries(settings.savedRegistries ?? []);
    setShowMcpForm(false);
    setMcpAddMode("paste");
    setMcpJson("");
    setMcpJsonError("");
    setMcpType("stdio");
    setMcpEditingId(null);
    setMcpName("");
    setMcpCommand("");
    setMcpArgs("");
    setMcpEnv("");
    setMcpUrl("");
    setMcpTransport("sse");
    setMcpTransportTouched(false);
    setMcpApiKey("");
    setMcpBrowseUrl("");
    setMcpBrowseKey("");
    setMcpCandidates(null);
    setCustomLabels(settings.customLabels ?? {});
    setLatinFont(settings.latinFont ?? "");
    setJpFont(settings.jpFont ?? "");
    setExperimental(settings.experimental ?? { atomLayer: false, synthesis: false, autoGrounding: false });
    setEnableProvLabels(settings.enableProvLabels ?? false);
    setSaved(false);
    setShowAddForm(false);
    setDeleteConfirm(null);
    setAddError("");

    refreshModels();

    refreshHealth();

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

  // ── エクスポート / バックアップ（ストレージタブ） ──
  // アクティブな StorageProvider から全ノートを読み出して zip を組み立てる。
  // 個々のノートの失敗は BulkExportResult.failed に集計され、全体は続行する。
  const handleBulkExport = useCallback(async (kind: "markdown" | "backup") => {
    setExportBusy(kind);
    setExportResult(null);
    setExportError(null);
    try {
      const provider = getActiveProvider();
      const result = kind === "markdown"
        ? await exportAllNotesAsMarkdownZip(provider)
        : await exportBackupZip(provider);
      setExportResult(result);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExportBusy(null);
    }
  }, []);

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
            rate: cfg.rate,
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
          if (!source) throw new Error(t("settings.ai.modelNotFound"));
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
          // { error, code } を code 付き Error に変換（INVALID_API_KEY 等を i18n 表示するため）
          throw await aiErrorFromResponse(res, `Error ${res.status}`);
        }
        const data = await res.json();
        setAvailableModels(data.models ?? []);
        if (data.models?.length > 0) {
          setSelectedModelId(data.models[0]);
          setModelDisplayName(data.models[0]);
        }
      } catch (err) {
        setAddError(localizeAiError(err));
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
        // { error, code } を code 付き Error に変換（INVALID_API_KEY 等を i18n 表示するため）
        throw await aiErrorFromResponse(res, `Error ${res.status}`);
      }
      const data = await res.json();
      setAvailableModels(data.models ?? []);
      if (data.models?.length > 0) {
        setSelectedModelId(data.models[0]);
        setModelDisplayName(data.models[0]);
      }
    } catch (err) {
      setAddError(localizeAiError(err));
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

  // desktop（サーバー経路）で Claude Code CLI が使えるかを確認し、使えるなら
  // 「Claude サブスクを使う」1-click を出す。web（localStorage 経路）では出さない。
  useEffect(() => {
    if (isWebMode || !isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase()}/models/claude-cli-status`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setClaudeCliAvailable(!!data.available);
          setClaudeCliAccount(data.account ?? null);
          setClaudeTokenFromEnv(data.token_source === "env");
        }
      } catch { /* 検出できなければ提示しないだけ */ }
    })();
    return () => { cancelled = true; };
  }, [isWebMode, isOpen]);

  // claude-subscription（sonnet）を 1 件登録する。API キー不要（サーバー側の CLI 認証を使う）。
  const handleUseClaudeSubscription = useCallback(async () => {
    setRegisteringSubscription(true);
    setSubscriptionError("");
    try {
      const res = await fetch(`${apiBase()}/models`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model_name: t("settings.models.claudeSubscriptionName"),
          provider: "claude-subscription",
          model_id: "sonnet",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Error ${res.status}`);
      }
      refreshModels();
    } catch (err) {
      setSubscriptionError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setRegisteringSubscription(false);
    }
  }, [t, refreshModels]);

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
    setEditRateInput(m.rate ? String(m.rate.input) : "");
    setEditRateOutput(m.rate ? String(m.rate.output) : "");
    setEditRateCurrency(m.rate?.currency === "jpy" ? "jpy" : "usd");
    setEditSuggestedRate(lookupModelPrice(m.provider, m.model_id));
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingId) return;
    setEditSaving(true);
    try {
      // 単価入力をパース。両方未入力なら rate 未設定として保存（コスト計算スキップ）。
      const rateInputNum = editRateInput.trim() ? Number(editRateInput) : NaN;
      const rateOutputNum = editRateOutput.trim() ? Number(editRateOutput) : NaN;
      const hasValidRate =
        Number.isFinite(rateInputNum) &&
        Number.isFinite(rateOutputNum) &&
        rateInputNum >= 0 &&
        rateOutputNum >= 0;

      if (isWebMode) {
        // Web モード: localStorage を直接更新
        const allModels = getLLMModels();
        const idx = allModels.findIndex((m) => m.id === editingId);
        if (idx >= 0) {
          if (editName.trim()) allModels[idx].name = editName.trim();
          if (editApiKey.trim()) allModels[idx].apiKey = editApiKey.trim();
          allModels[idx].apiBase = editApiBase.trim() || null;
          if (hasValidRate) {
            allModels[idx].rate = {
              input: rateInputNum,
              output: rateOutputNum,
              currency: editRateCurrency,
            };
          } else {
            delete allModels[idx].rate;
          }
          localStorage.setItem("graphium-llm-models", JSON.stringify(allModels));
        }
      } else {
        const body: Record<string, unknown> = {};
        if (editName.trim()) body.model_name = editName.trim();
        if (editApiKey.trim()) body.api_key = editApiKey.trim();
        body.api_base = editApiBase.trim();
        if (hasValidRate) {
          body.rate = {
            input: rateInputNum,
            output: rateOutputNum,
            currency: editRateCurrency,
          };
        }
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
  }, [isWebMode, editingId, editName, editApiKey, editApiBase, editRateInput, editRateOutput, editRateCurrency, refreshModels]);

  // ── 保存 ──
  const handleSave = useCallback(() => {
    // displayCurrency / usdJpyRate は UsageTab 側で先行保存されているので、
    // ここで全フィールドを上書きしないよう、既存値とマージする。
    const existing = loadSettings();
    saveSettings({
      ...existing,
      model,
      embeddingModel,
      chatSynthesisModel,
      groundingModel: groundingModelStored,
      disabledTools,
      registryUrl: registryUrl.trim().replace(/\/+$/, ""),
      mcpServers,
      savedRegistries,
      customLabels,
      latinFont,
      jpFont,
      experimental,
      enableProvLabels,
    });
    applyFontMode(latinFont, jpFont);
    setSaved(true);
    setTimeout(() => onClose(), 600);
  }, [model, embeddingModel, chatSynthesisModel, groundingModelStored, disabledTools, registryUrl, mcpServers, savedRegistries, customLabels, latinFont, jpFont, experimental, enableProvLabels, onClose]);

  // ── MCP 供給源（stdio / remote / registry）の操作 ──
  const resetMcpForm = useCallback(() => {
    setMcpAddMode("paste");
    setMcpJson("");
    setMcpJsonError("");
    setMcpType("stdio");
    setMcpEditingId(null);
    setMcpName("");
    setMcpCommand("");
    setMcpArgs("");
    setMcpEnv("");
    setMcpUrl("");
    setMcpTransport("sse");
    setMcpTransportTouched(false);
    setMcpApiKey("");
    setShowMcpForm(false);
  }, []);

  // 名前で upsert（同名は置き換え、無ければ末尾に追加）して mcpServers に反映する
  const upsertMcpServers = useCallback((entries: McpServerEntry[]) => {
    setMcpServers((prev) => {
      const next = [...prev];
      for (const s of entries) {
        const i = next.findIndex((e) => e.name === s.name);
        if (i >= 0) next[i] = s;
        else next.push(s);
      }
      return next;
    });
    setSaved(false);
  }, []);

  // README からコピペした mcpServers JSON を取り込む
  const handleImportMcpJson = useCallback(() => {
    const { servers, error } = parseMcpServersJson(mcpJson);
    if (error) {
      setMcpJsonError(error);
      return;
    }
    upsertMcpServers(servers);
    resetMcpForm();
  }, [mcpJson, upsertMcpServers, resetMcpForm]);

  // フォーム入力からエントリを組み立てる（追加・編集共通）。不正なら null。
  const buildMcpEntryFromForm = useCallback((id: string, enabled: boolean): McpServerEntry | null => {
    if (mcpType === "stdio") {
      const command = mcpCommand.trim();
      if (!command) return null;
      const args = mcpArgs.split("\n").map((a) => a.trim()).filter(Boolean);
      const env: Record<string, string> = {};
      for (const line of mcpEnv.split("\n")) {
        const idx = line.indexOf("=");
        if (idx <= 0) continue;
        const k = line.slice(0, idx).trim();
        const v = line.slice(idx + 1).trim();
        if (k) env[k] = v;
      }
      return {
        type: "stdio",
        id,
        name: mcpName.trim() || command,
        command,
        args,
        env: Object.keys(env).length > 0 ? env : undefined,
        enabled,
      };
    }
    const url = mcpUrl.trim();
    if (!url) return null;
    let fallbackName = url;
    try {
      fallbackName = new URL(url).host;
    } catch {
      /* URL でなければそのまま名前に使う */
    }
    return {
      type: "remote",
      id,
      name: mcpName.trim() || fallbackName,
      url,
      transport: mcpTransport,
      apiKey: mcpApiKey.trim() || undefined,
      enabled,
    };
  }, [mcpType, mcpCommand, mcpArgs, mcpEnv, mcpUrl, mcpName, mcpTransport, mcpApiKey]);

  // フォーム送信（追加 or 編集）
  const handleSubmitMcpForm = useCallback(() => {
    if (mcpEditingId) {
      // 編集: 既存の enabled を引き継いで同 id を置き換える
      setMcpServers((prev) => {
        const old = prev.find((s) => s.id === mcpEditingId);
        const entry = buildMcpEntryFromForm(mcpEditingId, old ? old.enabled : true);
        if (!entry) return prev;
        return prev.map((s) => (s.id === mcpEditingId ? entry : s));
      });
    } else {
      const entry = buildMcpEntryFromForm(crypto.randomUUID(), true);
      if (!entry) return;
      setMcpServers((prev) => [...prev, entry]);
    }
    resetMcpForm();
    setSaved(false);
  }, [mcpEditingId, buildMcpEntryFromForm, resetMcpForm]);

  // 既存エントリを編集フォームに読み込む
  const handleEditMcpServer = useCallback((entry: McpServerEntry) => {
    setShowMcpForm(true);
    setMcpAddMode("manual");
    setMcpEditingId(entry.id);
    setMcpType(entry.type);
    setMcpName(entry.name);
    if (entry.type === "stdio") {
      setMcpCommand(entry.command);
      setMcpArgs(entry.args.join("\n"));
      setMcpEnv(entry.env ? Object.entries(entry.env).map(([k, v]) => `${k}=${v}`).join("\n") : "");
      setMcpUrl("");
      setMcpApiKey("");
    } else {
      setMcpUrl(entry.url);
      setMcpApiKey(entry.apiKey ?? "");
      setMcpTransport(entry.transport);
      setMcpTransportTouched(true);
      setMcpCommand("");
      setMcpArgs("");
      setMcpEnv("");
    }
  }, []);

  const handleRemoveMcpServer = useCallback((id: string) => {
    setMcpServers((prev) => prev.filter((s) => s.id !== id));
    setSaved(false);
  }, []);

  const handleToggleMcpServer = useCallback((id: string) => {
    setMcpServers((prev) => prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)));
    setSaved(false);
  }, []);

  // ── 「レジストリから追加」: URL を入れて候補を取得 → 選んで remote 登録 ──
  const handleFetchCandidates = useCallback(() => {
    const url = mcpBrowseUrl.trim().replace(/\/+$/, "");
    if (!url) return;
    setMcpCandidates("loading");
    const headers: Record<string, string> = { "X-Registry-URL": url };
    if (mcpBrowseKey.trim()) headers["X-Registry-Key"] = mcpBrowseKey.trim();
    fetch(`${apiBase()}/tools`, { headers })
      .then((r) => r.json())
      .then((data: ToolsResponse) => {
        const candidates = (data.tools ?? []).filter((t) => t.tool_type === "mcp_server" && t.mcp_url);
        setMcpCandidates(candidates);
        // 取得成功 → そのレジストリを記憶（同 URL が無ければ追加）
        setSavedRegistries((prev) => {
          if (prev.some((r) => r.url === url)) return prev;
          setSaved(false);
          return [...prev, { id: crypto.randomUUID(), url, apiKey: mcpBrowseKey.trim() || undefined }];
        });
      })
      .catch(() => setMcpCandidates("error"));
  }, [mcpBrowseUrl, mcpBrowseKey]);

  // 候補（レジストリのサーバー）を remote エントリとしてリストに追加する
  const handleAddCandidate = useCallback((tool: ToolInfo) => {
    if (!tool.mcp_url) return;
    const entry: McpServerEntry = {
      type: "remote",
      id: crypto.randomUUID(),
      name: tool.display_name || tool.name,
      url: tool.mcp_url,
      transport: tool.transport ?? "sse",
      enabled: true,
    };
    setMcpServers((prev) =>
      prev.some((s) => s.type === "remote" && s.url === entry.url) ? prev : [...prev, entry],
    );
    setSaved(false);
  }, []);

  // 記憶したレジストリを選んでブラウズ欄に流し込む
  const handleSelectSavedRegistry = useCallback((reg: SavedRegistry) => {
    setMcpBrowseUrl(reg.url);
    setMcpBrowseKey(reg.apiKey ?? "");
    setMcpCandidates(null);
  }, []);

  const handleRemoveSavedRegistry = useCallback((id: string) => {
    setSavedRegistries((prev) => prev.filter((r) => r.id !== id));
    setSaved(false);
  }, []);

  // URL 入力に追従して transport を自動推定（remote のみ。ユーザーが手動で触ったら追従しない）
  const handleMcpUrlChange = useCallback((value: string) => {
    setMcpUrl(value);
    if (mcpType === "remote" && !mcpTransportTouched) setMcpTransport(detectMcpTransport(value));
  }, [mcpType, mcpTransportTouched]);

  // 送信ボタンの有効条件
  const mcpAddDisabled = mcpType === "stdio" ? !mcpCommand.trim() : !mcpUrl.trim();

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

      {/* タブ。タブ名は折り返さない（日本語の長いタブが縮められて 2 行になるのを防ぐ）。
       *  はみ出した場合のみ overflow-x-auto で横スクロール可能にする。 */}
      <div className="flex border-b border-border px-6 max-w-3xl overflow-x-auto">
        {(["display", "storage", "ai", "grounding", "maintenance", "usage", "about"] as Tab[]).map((tabId) => {
          const labelKey =
            tabId === "display" ? "settings.section.display"
            : tabId === "storage" ? "settings.section.storage"
            : tabId === "ai" ? "settings.section.ai"
            : tabId === "grounding" ? "settings.tab.grounding"
            : tabId === "maintenance" ? "settings.tab.maintenance"
            : tabId === "usage" ? "settings.tab.usage"
            : "settings.tab.about";
          return (
            <button
              key={tabId}
              onClick={() => setTab(tabId)}
              className={`px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px whitespace-nowrap shrink-0 ${
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

      {/* 全タブで max-w-3xl 統一。タブ列・本文・フッターの右端を揃えるため。 */}
      <ModalBody
        className="w-full min-w-[460px] max-w-3xl"
        onKeyDown={handleKeyDown}
      >
        {/* ── Display タブ ── */}
        {tab === "display" && (
          <div className="space-y-6">
            {/* 言語 */}
            <div>
              <h3 className="text-xs font-semibold text-foreground mb-2 block">
                {t("settings.language")}
              </h3>
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
              <h3 className="text-xs font-semibold text-foreground mb-2 block">
                {t("settings.font")}
              </h3>
              <div className="space-y-2">
                {/* ラテン文字用 */}
                <div>
                  <div className="text-xs text-muted-foreground mb-1">{t("settings.fontLatin")}</div>
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
                  <div className="text-xs text-muted-foreground mb-1">{t("settings.fontJp")}</div>
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

            {/* 来歴ラベル機能そのもののオン/オフ。手順の PROV 化はかなり専門的な機能なので、
                不要なユーザーは丸ごと隠せる。OFF でラベルの付与・表示 UI が全て消える
                （データは保持され、再度 ON にすれば復帰する）。 */}
            <div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setEnableProvLabels(!enableProvLabels); setSaved(false); }}
                  role="switch"
                  aria-checked={enableProvLabels}
                  aria-label={t("settings.provLabels.title")}
                  className={`shrink-0 inline-flex items-center rounded-full border border-border transition-colors w-8 h-[18px] ${enableProvLabels ? "bg-primary" : "bg-input"}`}
                >
                  <span
                    className="block w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform duration-200"
                    style={{ transform: enableProvLabels ? "translateX(15px)" : "translateX(1px)" }}
                  />
                </button>
                <label className="text-sm font-medium text-foreground">
                  {t("settings.provLabels.title")}
                </label>
              </div>
              <p className="text-xs text-muted-foreground mt-2">{t("settings.provLabels.help")}</p>
            </div>

            {/* 来歴ラベルの表記 — PROV コアラベルの表示名カスタマイズ（機能 ON のときのみ） */}
            {enableProvLabels && (
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <Tag size={14} className="text-muted-foreground" />
                <h3 className="text-xs font-semibold text-foreground">
                  {t("settings.labels.title")}
                </h3>
              </div>
              <p className="text-xs text-muted-foreground mb-3">{t("settings.labels.help")}</p>

              <div className="space-y-2">
                {CORE_LABELS.map((label) => (
                  <div key={label} className="flex items-center gap-3">
                    <div className="w-28 shrink-0">
                      <span className="text-xs text-muted-foreground font-mono">
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
            )}
          </div>
        )}

        {/* ── Storage タブ ── */}
        {tab === "storage" && (
          <div className="space-y-6">
            {/* サーバーストレージ（Docker / セルフホスト Web のみ） */}
            {!isTauri() && serverCaps?.serverStorage && (
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <FolderOpen size={14} className="text-muted-foreground" />
                  <h3 className="text-xs font-semibold text-foreground">
                    {t("settings.serverStorage.title")}
                  </h3>
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
                  <h3 className="text-xs font-semibold text-foreground">
                    {t("settings.saveDir.title")}
                  </h3>
                </div>
                <p className="text-xs text-muted-foreground mb-2">
                  {t("settings.saveDir.help")}
                </p>
                {graphiumRoot ? (
                  <div className="rounded-md border border-border bg-background px-3 py-2 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-muted-foreground">
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
                          <div className="text-xs text-muted-foreground">
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

            {/* AuthorIdentity（team-shared-storage Phase 0）。
                共有ノート・PROV 来歴の author 情報なので、共有ストレージの直前に置く。 */}
            <div>
              <h3 className="text-xs font-semibold text-foreground mb-1 block">
                {t("settings.identity.title")}
              </h3>
              <p className="text-xs text-muted-foreground mb-2">
                {t("settings.identity.help")}
              </p>
              <div className="space-y-2">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">
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
                  <div className="text-xs text-muted-foreground mb-1">
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

            {/* Shared storage（team-shared-storage Phase 1c、Tauri 専用） */}
            {isTauri() ? (
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <FolderOpen size={14} className="text-muted-foreground" />
                  <h3 className="text-xs font-semibold text-foreground">
                    {t("settings.shared.title")}
                  </h3>
                </div>
                <p className="text-xs text-muted-foreground mb-2">
                  {t("settings.shared.help")}
                </p>

                {/* Shared root */}
                <div className="rounded-md border border-border bg-background px-3 py-2 space-y-2">
                  <div className="text-xs text-muted-foreground">
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
                  <div className="text-xs text-muted-foreground">
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
                  <h3 className="text-xs font-semibold text-foreground">
                    {t("settings.shared.title")}
                  </h3>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("settings.shared.desktopOnly")}
                </p>
              </div>
            )}

            {/* エクスポート / バックアップ */}
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <Download size={14} className="text-muted-foreground" />
                <h3 className="text-xs font-semibold text-foreground">
                  {t("settings.export.title")}
                </h3>
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                {t("settings.export.help")}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleBulkExport("markdown")}
                  disabled={exportBusy !== null}
                >
                  {exportBusy === "markdown" ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    t("settings.export.markdownZip")
                  )}
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleBulkExport("backup")}
                  disabled={exportBusy !== null}
                >
                  {exportBusy === "backup" ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    t("settings.export.backupZip")
                  )}
                </Button>
              </div>
              {exportResult && (
                <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                  <CheckCircle size={12} className="text-green-600" />
                  {exportResult.failed > 0
                    ? t("settings.export.doneWithFailures", {
                        count: String(exportResult.exported),
                        failed: String(exportResult.failed),
                      })
                    : t("settings.export.done", { count: String(exportResult.exported) })}
                </p>
              )}
              {exportError && (
                <p className="text-xs text-red-500 mt-2 flex items-center gap-1">
                  <AlertCircle size={12} /> {t("settings.export.failed")}: {exportError}
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── AI タブ ──
         *  流れ: モデル登録 → 役割への割り当て → 世界照合 → MCP サーバー。
         *  初回セットアップの順（登録が先、割り当てが後）に上から並べる。 */}
        {tab === "ai" && (
          <div className="space-y-6">
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
                  {!isWebMode && claudeCliAvailable && (
                    <div className="mb-3">
                      <button
                        onClick={handleUseClaudeSubscription}
                        disabled={registeringSubscription}
                        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                      >
                        {registeringSubscription && <Loader2 size={12} className="animate-spin" />}
                        {t("settings.models.useClaudeSubscription")}
                      </button>
                      <p className="text-xs text-muted-foreground mt-1.5">{t("settings.models.useClaudeSubscriptionHint")}</p>
                      {subscriptionError && <p className="text-xs text-destructive mt-1">{subscriptionError}</p>}
                    </div>
                  )}
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
                      {/* 接続先 → 認証の順（どこへ繋ぐかが先） */}
                      <div>
                        <label className="text-xs font-medium text-foreground mb-2 block">API Base URL</label>
                        <Input type="url" value={editApiBase} onChange={(e) => setEditApiBase(e.target.value)} placeholder={API_BASE_HINTS[m.provider] ?? ""} />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-foreground mb-2 block">{t("settings.models.editApiKey")}</label>
                        <Input type="password" value={editApiKey} onChange={(e) => setEditApiKey(e.target.value)} placeholder={t("settings.models.editApiKeyPlaceholder")} className="font-mono text-sm" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-foreground mb-2 block">
                          {t("settings.models.rate.label")}
                          <span className="text-muted-foreground font-normal ml-1">{t("settings.models.rate.hint")}</span>
                        </label>
                        <div className="flex gap-2">
                          {/* 通貨セグメント */}
                          <div className="flex gap-1 p-1 bg-muted/50 rounded-md shrink-0 h-fit">
                            {(["usd", "jpy"] as const).map((c) => (
                              <button
                                key={c}
                                type="button"
                                onClick={() => setEditRateCurrency(c)}
                                className={`px-2.5 py-1 text-xs rounded transition-colors ${
                                  editRateCurrency === c
                                    ? "bg-background text-foreground shadow-sm font-medium"
                                    : "text-muted-foreground hover:text-foreground"
                                }`}
                              >
                                {c === "usd" ? "USD" : "JPY"}
                              </button>
                            ))}
                          </div>
                          <div className="grid grid-cols-2 gap-2 flex-1">
                            <Input
                              type="number"
                              step="0.001"
                              min="0"
                              value={editRateInput}
                              onChange={(e) => setEditRateInput(e.target.value)}
                              placeholder={
                                editSuggestedRate
                                  ? `${t("settings.models.rate.inputShort")}: ${editSuggestedRate.input}`
                                  : t("settings.models.rate.inputPlaceholder")
                              }
                            />
                            <Input
                              type="number"
                              step="0.001"
                              min="0"
                              value={editRateOutput}
                              onChange={(e) => setEditRateOutput(e.target.value)}
                              placeholder={
                                editSuggestedRate
                                  ? `${t("settings.models.rate.outputShort")}: ${editSuggestedRate.output}`
                                  : t("settings.models.rate.outputPlaceholder")
                              }
                            />
                          </div>
                        </div>
                        {editSuggestedRate && (
                          <div className="flex items-center justify-between gap-2 mt-1.5">
                            <span className="text-xs text-muted-foreground">
                              {t("settings.models.rate.knownNote")}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setEditRateInput(String(editSuggestedRate.input));
                                setEditRateOutput(String(editSuggestedRate.output));
                                // 内蔵テーブルは USD ベース。
                                setEditRateCurrency("usd");
                              }}
                              className="text-xs text-primary hover:text-primary/80 font-medium whitespace-nowrap"
                            >
                              {t("settings.models.rate.useKnown", {
                                input: `$${editSuggestedRate.input}`,
                                output: `$${editSuggestedRate.output}`,
                              })}
                            </button>
                          </div>
                        )}
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
                        {/* サブスクは認証が CLI 側にあり Graphium から制御できないため、
                            どのアカウントで推論されるか+切替手順をここで見える化する */}
                        {m.provider === "claude-subscription" && (
                          <div className="mt-1 space-y-0.5">
                            <p className="text-xs text-foreground/80">
                              {claudeTokenFromEnv
                                ? t("settings.models.subscriptionAccountEnvToken")
                                : claudeCliAccount
                                  ? t("settings.models.subscriptionAccount", {
                                      account: [claudeCliAccount.email, claudeCliAccount.organization]
                                        .filter(Boolean)
                                        .join(" · "),
                                    })
                                  : t("settings.models.subscriptionAccountUnknown")}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {t("settings.models.subscriptionSwitchHint")}
                            </p>
                          </div>
                        )}
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
                    {/* 新規プロバイダーモード: プロバイダー → エンドポイント → API キー */}
                    <div>
                      <label className="text-xs font-medium text-foreground mb-2 block">{t("settings.addModel.provider")}</label>
                      <div className="relative">
                        <select
                          value={addProvider}
                          onChange={(e) => {
                            const p = e.target.value;
                            setAddProvider(p);
                            setCustomModelId("");
                            setAddError("");
                            if (p === "claude-subscription") {
                              // API キー不要・モデル一覧 API なし。
                              // 候補を静的に提示してそのままモデル選択ステップへ進める。
                              setAvailableModels([...CLAUDE_SUBSCRIPTION_MODELS]);
                              setSelectedModelId(CLAUDE_SUBSCRIPTION_MODELS[0]);
                              setModelDisplayName("Claude Sonnet (subscription)");
                            } else {
                              setAvailableModels([]);
                              setSelectedModelId("");
                            }
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

                    {addProvider === "claude-subscription" ? (
                      <>
                        {/* サブスク経由は API キー不要。セットアップ案内が主役で、
                            CLI パス（自動検出の脱出ハッチ）はその後ろに置く。 */}
                        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground leading-relaxed">
                          {t("settings.addModel.claudeSubHint")}
                        </div>
                        {/* addApiBase を claude CLI の絶対パス（任意）として流用する */}
                        <div>
                          <label className="text-xs font-medium text-foreground mb-2 block">
                            {t("settings.addModel.claudeCliPath")}
                          </label>
                          <Input
                            type="text"
                            value={addApiBase}
                            onChange={(e) => setAddApiBase(e.target.value)}
                            placeholder={API_BASE_HINTS[addProvider] ?? ""}
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        {/* 接続先 → 認証の順（どこへ繋ぐかが先）。
                            API Base URL は openai-compatible では必須、他は任意。 */}
                        <div>
                          <label className="text-xs font-medium text-foreground mb-2 block">
                            API Base URL
                            {addProvider === "openai-compatible" && <span className="text-red-500 ml-1">*</span>}
                          </label>
                          <Input
                            type="text"
                            value={addApiBase}
                            onChange={(e) => setAddApiBase(e.target.value)}
                            placeholder={API_BASE_HINTS[addProvider] ?? ""}
                          />
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
                      </>
                    )}

                    {addProvider !== "claude-subscription" && (
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
                    )}
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

            {/* モデルの割り当て — 登録したモデルを役割ごとに割り当てる */}
            <div className="border-t border-border pt-6">
              <h3 className="text-xs font-semibold text-foreground mb-3">{t("settings.ai.sectionAssign")}</h3>
              <div className="space-y-4">
                {/* デフォルトモデル */}
                <div>
                  <label className="text-xs font-medium text-foreground mb-2 block">
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

                {/* Chat & Synthesis モデル選択（対話と統合用 — default より上のモデルを当てる場面用） */}
                <div>
                  <label className="text-xs font-medium text-foreground mb-2 block">
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

                {/* Embedding モデル選択 */}
                <div>
                  <label className="text-xs font-medium text-foreground mb-2 block">
                    {t("settings.embeddingModel.label")}
                  </label>
                  <div className="relative">
                    <select
                      value={embeddingModel}
                      onChange={(e) => { setEmbeddingModel(e.target.value); setSaved(false); }}
                      disabled={modelsLoading || models.length === 0}
                      className="w-full appearance-none rounded-md border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground transition-colors focus:border-primary focus:outline-none disabled:opacity-50"
                    >
                      <option value="">
                        {models.length === 0 ? t("settings.modelNone") : t("settings.embeddingModel.noneFallback")}
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
                    {t("settings.embeddingModel.help")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("settings.embeddingModel.note")}
                  </p>
                </div>
              </div>
            </div>

            {/* 世界照合 — 自動照合トグルと専用モデル */}
            <div className="border-t border-border pt-6">
              <h3 className="text-xs font-semibold text-foreground mb-3">{t("settings.ai.sectionGrounding")}</h3>
              <div className="space-y-4">
                {/* 自動 world-grounding（opt-in / 既定 OFF）。
                    既存の "user-triggered only" を覆すので明示トグル。 */}
                <div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setExperimental({ ...experimental, autoGrounding: !experimental.autoGrounding });
                        setSaved(false);
                      }}
                      role="switch"
                      aria-checked={experimental.autoGrounding}
                      aria-label={t("settings.autoGrounding.title")}
                      className={`shrink-0 inline-flex items-center rounded-full border border-border transition-colors w-8 h-[18px] ${experimental.autoGrounding ? "bg-primary" : "bg-input"}`}
                    >
                      <span
                        className="block w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform duration-200"
                        style={{ transform: experimental.autoGrounding ? "translateX(15px)" : "translateX(1px)" }}
                      />
                    </button>
                    <label className="text-sm font-medium text-foreground">
                      {t("settings.autoGrounding.title")}
                    </label>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {t("settings.autoGrounding.help")}
                  </p>
                </div>

                {/* 世界照合専用モデル（任意）。空ならチャット・洞察モデル → default にフォールバック。
                    手動「世界照合」ボタンと自動照合の両方がこのモデルを使う。 */}
                <div>
                  <label className="text-xs font-medium text-foreground mb-2 block">
                    {t("settings.groundingModel")}
                  </label>
                  <div className="relative">
                    <select
                      value={groundingModelStored}
                      onChange={(e) => { setGroundingModelStored(e.target.value); setSaved(false); }}
                      disabled={modelsLoading || models.length === 0}
                      className="w-full appearance-none rounded-md border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground transition-colors focus:border-primary focus:outline-none disabled:opacity-50"
                    >
                      <option value="">
                        {models.length === 0 ? t("settings.modelNone") : t("settings.groundingModelSameAsDefault")}
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
                    {t("settings.groundingModelHelp")}
                  </p>
                </div>
              </div>
            </div>

            {/* 手動 MCP サーバー（Crucible 非依存の主接続経路） */}
            <div className="border-t border-border pt-6">
              <div className="flex items-center gap-1.5 mb-2">
                <Plug size={14} className="text-muted-foreground" />
                <h3 className="text-xs font-semibold text-foreground">{t("settings.mcp.title")}</h3>
              </div>

              {mcpServers.length > 0 ? (
                <div className="space-y-1.5 mb-2">
                  {mcpServers.map((s) => {
                    const detail = s.type === "stdio" ? `${s.command} ${s.args.join(" ")}`.trim() : s.url;
                    const badge = s.type === "stdio" ? "local" : s.transport;
                    return (
                      <div key={s.id} className="flex items-center gap-2 text-xs text-foreground">
                        <button
                          onClick={() => handleToggleMcpServer(s.id)}
                          role="switch"
                          aria-checked={s.enabled}
                          aria-label={s.enabled ? t("settings.mcp.disable") : t("settings.mcp.enable")}
                          className={`shrink-0 inline-flex items-center rounded-full border border-border transition-colors w-8 h-[18px] ${s.enabled ? "bg-primary" : "bg-input"}`}
                        >
                          <span
                            className="block w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform duration-200"
                            style={{ transform: s.enabled ? "translateX(15px)" : "translateX(1px)" }}
                          />
                        </button>
                        <span className={`min-w-0 flex-1 truncate ${s.enabled ? "" : "opacity-50"}`}>
                          <span className="font-medium">{s.name}</span>
                          <span className="text-muted-foreground"> — {detail}</span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground px-1.5 py-0.5 rounded bg-muted">{badge}</span>
                        <button
                          onClick={() => handleEditMcpServer(s)}
                          aria-label={t("settings.mcp.edit")}
                          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => handleRemoveMcpServer(s.id)}
                          aria-label={t("settings.mcp.remove")}
                          className="shrink-0 text-muted-foreground hover:text-red-500 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground mb-2">{t("settings.mcp.empty")}</p>
              )}

              {showMcpForm ? (
                <div className="space-y-2 rounded-md border border-border p-3">
                  {/* 入力モード: JSON コピペ / 手動 / レジストリから選ぶ。編集中は手動固定 */}
                  {!mcpEditingId && (
                    <div className="flex gap-1 rounded-md bg-muted p-0.5">
                      {(["paste", "manual", "registry"] as const).map((m) => (
                        <button
                          key={m}
                          onClick={() => { setMcpAddMode(m); setMcpJsonError(""); }}
                          className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                            mcpAddMode === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {t(m === "paste" ? "settings.mcp.mode.paste" : m === "manual" ? "settings.mcp.mode.manual" : "settings.mcp.mode.registry")}
                        </button>
                      ))}
                    </div>
                  )}

                  {mcpAddMode === "paste" && !mcpEditingId ? (
                    <>
                      <textarea
                        value={mcpJson}
                        onChange={(e) => { setMcpJson(e.target.value); setMcpJsonError(""); }}
                        rows={8}
                        placeholder={'{\n  "mcpServers": {\n    "tavily": {\n      "command": "npx",\n      "args": ["-y", "tavily-mcp"],\n      "env": { "TAVILY_API_KEY": "tvly-…" }\n    },\n    "my-api": {\n      "url": "https://example.com/mcp",\n      "type": "http"\n    }\n  }\n}'}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground transition-colors focus:border-primary focus:outline-none font-mono"
                      />
                      {mcpJsonError && (
                        <p className="text-xs text-red-500">
                          {t(mcpJsonError === "invalid-json" ? "settings.mcp.jsonError.invalid" : "settings.mcp.jsonError.empty")}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">{t("settings.mcp.jsonHelp")}</p>
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={handleImportMcpJson}
                          disabled={!mcpJson.trim()}
                          className="flex-1 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50"
                        >
                          {t("settings.mcp.import")}
                        </button>
                        <button
                          onClick={resetMcpForm}
                          className="rounded-md px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
                        >
                          {t("common.cancel")}
                        </button>
                      </div>
                    </>
                  ) : mcpAddMode === "registry" && !mcpEditingId ? (
                    <>
                      {/* 記憶済みレジストリのショートカット */}
                      {savedRegistries.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {savedRegistries.map((reg) => (
                            <span key={reg.id} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                              <button onClick={() => handleSelectSavedRegistry(reg)} className="max-w-[160px] truncate hover:text-primary">
                                {(() => { try { return new URL(reg.url).host; } catch { return reg.url; } })()}
                              </button>
                              <button onClick={() => handleRemoveSavedRegistry(reg.id)} aria-label={t("settings.mcp.remove")} className="text-muted-foreground hover:text-red-500">
                                <X size={11} />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="text-xs text-muted-foreground mb-1 block">{t("settings.mcp.registryUrl")}</label>
                          <Input
                            type="url"
                            value={mcpBrowseUrl}
                            onChange={(e) => { setMcpBrowseUrl(e.target.value); setMcpCandidates(null); }}
                            placeholder={t("settings.mcp.registryUrlPlaceholder")}
                          />
                        </div>
                        <div className="w-32">
                          <label className="text-xs text-muted-foreground mb-1 block">{t("settings.mcp.registryKey")}</label>
                          <Input
                            type="password"
                            value={mcpBrowseKey}
                            onChange={(e) => setMcpBrowseKey(e.target.value)}
                            placeholder={t("settings.mcp.apiKeyPlaceholder")}
                          />
                        </div>
                      </div>
                      <button
                        onClick={handleFetchCandidates}
                        disabled={!mcpBrowseUrl.trim()}
                        className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted disabled:opacity-50"
                      >
                        {t("settings.mcp.fetchCandidates")}
                      </button>

                      {/* 候補一覧 */}
                      {mcpCandidates === "loading" ? (
                        <p className="text-xs text-muted-foreground">{t("settings.tools.loading")}</p>
                      ) : mcpCandidates === "error" ? (
                        <p className="text-xs text-red-500">{t("settings.mcp.registryError")}</p>
                      ) : mcpCandidates && mcpCandidates.length === 0 ? (
                        <p className="text-xs text-muted-foreground">{t("settings.tools.empty")}</p>
                      ) : mcpCandidates ? (
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {mcpCandidates.map((tool) => {
                            const added = mcpServers.some((s) => s.type === "remote" && s.url === tool.mcp_url);
                            return (
                              <div key={tool.name} className="flex items-center gap-2 text-xs">
                                <span className="min-w-0 flex-1 truncate">{tool.icon ? `${tool.icon} ` : ""}{tool.display_name || tool.name}</span>
                                {added ? (
                                  <span className="shrink-0 text-xs text-muted-foreground">{t("settings.mcp.added")}</span>
                                ) : (
                                  <button
                                    onClick={() => handleAddCandidate(tool)}
                                    className="shrink-0 flex items-center gap-0.5 text-xs text-primary hover:opacity-80"
                                  >
                                    <Plus size={12} /> {t("settings.mcp.save")}
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}

                      <div className="flex gap-2 pt-1">
                        <button onClick={resetMcpForm} className="rounded-md px-3 py-2 text-xs text-muted-foreground hover:text-foreground">
                          {t("common.close")}
                        </button>
                      </div>
                    </>
                  ) : (
                  <>
                  {/* 供給源の種別: stdio（ローカル spawn）/ remote（HTTP） */}
                  <div className="flex gap-1 rounded-md bg-muted p-0.5">
                    {(["stdio", "remote"] as const).map((ty) => (
                      <button
                        key={ty}
                        onClick={() => setMcpType(ty)}
                        className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                          mcpType === ty ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {t(ty === "stdio" ? "settings.mcp.type.stdio" : "settings.mcp.type.remote")}
                      </button>
                    ))}
                  </div>

                  {mcpType === "stdio" ? (
                    <>
                      <div className="flex gap-2">
                        <div className="w-32">
                          <label className="text-xs text-muted-foreground mb-1 block">{t("settings.mcp.command")}</label>
                          <Input
                            type="text"
                            value={mcpCommand}
                            onChange={(e) => setMcpCommand(e.target.value)}
                            placeholder="npx"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="text-xs text-muted-foreground mb-1 block">{t("settings.mcp.name")}</label>
                          <Input
                            type="text"
                            value={mcpName}
                            onChange={(e) => setMcpName(e.target.value)}
                            placeholder={t("settings.mcp.namePlaceholder")}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">{t("settings.mcp.args")}</label>
                        <textarea
                          value={mcpArgs}
                          onChange={(e) => setMcpArgs(e.target.value)}
                          rows={3}
                          placeholder={"-y\n@modelcontextprotocol/server-filesystem\n~/notes"}
                          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">{t("settings.mcp.env")}</label>
                        <textarea
                          value={mcpEnv}
                          onChange={(e) => setMcpEnv(e.target.value)}
                          rows={2}
                          placeholder={"API_KEY=xxxx"}
                          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none font-mono"
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">{t("settings.mcp.url")}</label>
                        <Input
                          type="url"
                          value={mcpUrl}
                          onChange={(e) => handleMcpUrlChange(e.target.value)}
                          placeholder={t("settings.mcp.urlPlaceholder")}
                        />
                      </div>
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="text-xs text-muted-foreground mb-1 block">{t("settings.mcp.name")}</label>
                          <Input
                            type="text"
                            value={mcpName}
                            onChange={(e) => setMcpName(e.target.value)}
                            placeholder={t("settings.mcp.namePlaceholder")}
                          />
                        </div>
                        <div className="w-40">
                          <label className="text-xs text-muted-foreground mb-1 block">{t("settings.mcp.transport")}</label>
                          <div className="relative">
                            <select
                              value={mcpTransport}
                              onChange={(e) => { setMcpTransport(e.target.value as McpTransport); setMcpTransportTouched(true); }}
                              className="w-full appearance-none rounded-md border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
                            >
                              <option value="sse">SSE</option>
                              <option value="streamable-http">Streamable HTTP</option>
                            </select>
                            <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                          </div>
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">{t("settings.mcp.apiKey")}</label>
                        <Input
                          type="password"
                          value={mcpApiKey}
                          onChange={(e) => setMcpApiKey(e.target.value)}
                          placeholder={t("settings.mcp.apiKeyPlaceholder")}
                        />
                      </div>
                    </>
                  )}

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={handleSubmitMcpForm}
                      disabled={mcpAddDisabled}
                      className="flex-1 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50"
                    >
                      {t(mcpEditingId ? "settings.mcp.update" : "settings.mcp.save")}
                    </button>
                    <button
                      onClick={resetMcpForm}
                      className="rounded-md px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                  </>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => setShowMcpForm(true)}
                  className="flex items-center gap-1 text-xs text-primary hover:opacity-80"
                >
                  <Plus size={14} /> {t("settings.mcp.add")}
                </button>
              )}

              <p className="text-xs text-muted-foreground mt-2">{t("settings.mcp.help")}</p>
            </div>

            </>}
          </div>
        )}

        {/* ── Grounding KB タブ（world-model-grounding Phase 2 / PR 2A） ── */}
        {tab === "grounding" && <GroundingKbTab />}

        {/* ── Maintenance タブ ── */}
        {tab === "maintenance" && (
          <div className="space-y-6">
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
                              className="mt-1 text-xs text-muted-foreground hover:text-foreground underline"
                            >
                              {showSidecarLog ? t("settings.health.hideLog") : t("settings.health.showLog")}
                            </button>
                          )}
                          {showSidecarLog && sidecarLog.length > 0 && (
                            <pre className="mt-1.5 text-xs bg-background/50 rounded p-1.5 overflow-auto max-h-32 font-mono whitespace-pre-wrap">{sidecarLog.join("\n")}</pre>
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
              atomLayerEnabled={true}
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
              onReembedAllWikis={onReembedAllWikis}
            />
          </div>
        )}

        {/* ── About タブ ── */}
        {tab === "usage" && <UsageTab />}

        {tab === "about" && <AboutTab />}
      </ModalBody>

      <ModalFooter className="max-w-3xl">
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
  t: (key: string, params?: Record<string, string>) => string;
  wikiSummaries: WikiSummaryForSettings[];
  onRegenerateWiki?: RegenerateWikiHandler;
  onRunAtomizeDiscovery?: DiscoveryHandler;
  atomLayerEnabled: boolean;
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
  onReembedAllWikis?: (onProgress: (done: number, total: number) => void) => Promise<void>;
};

function MaintenanceTab({
  t,
  wikiSummaries,
  onRegenerateWiki,
  onRunAtomizeDiscovery,
  atomLayerEnabled,
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
  onReembedAllWikis,
}: MaintenanceTabProps) {
  // synthesis（発想）は UI 動線から非表示（design revision 2026-05-27）。
  // 既存 synthesis ファイルの物理データは保持するが、一括 Regenerate の対象には出さない。
  const KINDS: WikiKind[] = ["claim", "summary", "atom"];
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

  return (
    <div className="space-y-6">
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

      {/* 全 Wiki の embedding を再生成。
          AI チャットの Retriever が引用元を検索するための embedding を IndexedDB に作り直す。
          既存ユーザーの wiki が embedding 機能導入前に作られていた場合や、Embedding model を切り替えた直後に使う。 */}
      {onReembedAllWikis && wikiSummaries.length > 0 && (
        <div className="rounded-lg border border-border p-3 space-y-3">
          <div>
            <h3 className="text-xs font-semibold text-foreground mb-1">
              {t("settings.maintenance.reembedTitle")}
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t("settings.maintenance.reembedHelp")}
            </p>
          </div>
          {reembedProgress && reembedRunning && (
            <div className="text-xs text-muted-foreground">
              {t("settings.maintenance.reembedProgress", {
                done: String(reembedProgress.done),
                total: String(reembedProgress.total),
              })}
            </div>
          )}
          {reembedProgress && !reembedRunning && !reembedError && (
            <div className="text-xs text-emerald-600 dark:text-emerald-400">
              {t("settings.maintenance.reembedDone", {
                done: String(reembedProgress.done),
                total: String(reembedProgress.total),
              })}
            </div>
          )}
          {reembedError && (
            <div className="text-xs text-red-600 dark:text-red-400">
              {reembedError}
            </div>
          )}
          <Button
            size="sm"
            disabled={reembedRunning}
            onClick={async () => {
              const total = wikiSummaries.length;
              const confirmed = window.confirm(
                t("settings.maintenance.reembedConfirm", { count: String(total) }),
              );
              if (!confirmed) return;
              setReembedRunning(true);
              setReembedError(null);
              setReembedProgress({ done: 0, total });
              try {
                // 第 2 引数を t と名付けると i18n の t を隠してしまうため total で受ける
                await onReembedAllWikis((done, tot) => setReembedProgress({ done, total: tot }));
              } catch (e) {
                setReembedError(e instanceof Error ? e.message : String(e));
              } finally {
                setReembedRunning(false);
              }
            }}
          >
            {reembedRunning ? (
              <><Loader2 size={12} className="animate-spin mr-1.5" />{t("settings.maintenance.reembedRunning")}</>
            ) : (
              t("settings.maintenance.reembedRun", { count: String(wikiSummaries.length) })
            )}
          </Button>
        </div>
      )}

      {/* Wiki 一括 Regenerate（Atomize と視覚的に揃えるためカード化） */}
      <div className="rounded-lg border border-border p-3 space-y-4">
        <div>
          <h3 className="text-xs font-semibold text-foreground mb-1">
            {t("settings.maintenance.regenAll.title")}
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t("settings.maintenance.regenAll.help")}
          </p>
        </div>

      {/* kind フィルタ */}
      <div>
        <h3 className="text-xs font-semibold text-foreground mb-2 block">
          {t("settings.maintenance.kindFilter")}
        </h3>
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
          <h3 className="text-xs font-semibold text-foreground mb-2 block">
            {t("settings.maintenance.conceptSummaryModel")}
          </h3>
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
          <h3 className="text-xs font-semibold text-foreground mb-2 block">
            {t("settings.maintenance.synthesisAtomModel")}
          </h3>
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
                  {m.name === (chatSynthesisModel || defaultModel) ? ` ${t("settings.maintenance.currentSetting")}` : ""}
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
            <div className="text-xs text-muted-foreground truncate">
              {t("settings.maintenance.current")}: {bulkProgress.current}
              {bulkProgress.currentModel && (
                <span className="ml-2 opacity-70">— {bulkProgress.currentModel}</span>
              )}
            </div>
          )}
          {cancelling && bulkRunning && (
            <div className="text-xs text-amber-600">
              {t("settings.maintenance.cancellingHint")}
            </div>
          )}
          {!bulkRunning && bulkProgress.done > 0 && (
            <div className="text-xs text-muted-foreground">
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
              <li key={f.id} className="text-xs">
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
        <h3 className="text-xs font-semibold text-foreground mb-1">
          {t(titleKey)}
        </h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
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
                <div className="ml-4 text-xs opacity-80 break-words">
                  cluster: 「{progress.clusterLabel}」{progress.clusterSize ? ` (${progress.clusterSize})` : ""}
                </div>
              )}
              {progress.clusterMemberTitles && progress.clusterMemberTitles.length > 0 && (
                <details className="ml-4 text-xs opacity-70">
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
// Grounding KB タブ（world-model-grounding Phase 2 / PR 2C）
// 蒸留 KB の中身を確認・チューニング用のビューアー。
// - PR 2C: domain 分割を廃止。entry の分野ラベルは tags (多値) で表現
// - 沈殿 entry には削除ボタンが付く。seed entry は読み取り専用
// ─────────────────────────────────────────────────────────────

const VERDICT_FILTERS: Array<"all" | GroundingValidityVerdict> = [
  "all",
  "established",
  "supported",
  "weak",
  "contested",
];

/** seed (手キュレーション) か model 沈殿かを判定する */
function isSeedEntry(entry: KbEntry): boolean {
  return !entry.generatedByModel || entry.generatedByModel === "manual-curated@v1";
}

function GroundingKbTab() {
  const { t } = useLocale();
  const [kb, setKb] = useState<KbFile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verdictFilter, setVerdictFilter] = useState<"all" | GroundingValidityVerdict>("all");
  const [query, setQuery] = useState("");
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const baseUrl =
      typeof import.meta !== "undefined" && import.meta.env?.BASE_URL
        ? import.meta.env.BASE_URL
        : "/";
    loadKb(baseUrl)
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
  }, [reloadTick]);

  const filtered: KbEntry[] = useMemo(() => {
    if (!kb) return [];
    const q = query.trim().toLowerCase();
    return kb.entries.filter((e) => {
      if (verdictFilter !== "all" && e.verdict !== verdictFilter) return false;
      if (!q) return true;
      const hay = `${e.id} ${e.claim} ${e.rationale} ${e.keywords.join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
  }, [kb, verdictFilter, query]);

  // 沈殿（cache）エントリの件数。seed は read-only なので一括クリアの対象外。
  const cacheCount = useMemo(
    () => (kb ? kb.entries.filter((e) => !isSeedEntry(e)).length : 0),
    [kb],
  );

  const handleDelete = async (entry: KbEntry) => {
    if (isSeedEntry(entry)) return; // UI で既に disabled、念のため
    const confirmed = window.confirm(
      t("settings.grounding.confirmDelete", { id: entry.id }),
    );
    if (!confirmed) return;
    const ok = await removeFromKbCache(entry.id);
    if (!ok) {
      setError(t("settings.grounding.deleteFailed"));
      return;
    }
    setError(null);
    // KB を再ロード（seed + 残存 cache を merge し直す）
    setReloadTick((n) => n + 1);
  };

  const handleClearCache = async () => {
    if (cacheCount === 0) return;
    const confirmed = window.confirm(
      t("settings.grounding.clearCacheConfirm", { count: String(cacheCount) }),
    );
    if (!confirmed) return;
    const ok = await clearKbCache();
    if (!ok) {
      setError(t("settings.grounding.deleteFailed"));
      return;
    }
    setError(null);
    // KB を再ロード（seed のみ残る）
    setReloadTick((n) => n + 1);
  };

  return (
    <div className="space-y-6">
      <div className="text-xs text-muted-foreground">
        {t("settings.grounding.intro")}
      </div>

      {kb && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
          <span>
            {t("settings.grounding.count", { count: String(kb.entries.length) })}
          </span>
          <button
            type="button"
            onClick={handleClearCache}
            disabled={cacheCount === 0}
            title={
              cacheCount === 0
                ? t("settings.grounding.clearCacheEmpty")
                : t("settings.grounding.clearCacheTooltip")
            }
            className={`ml-auto inline-flex items-center gap-1 px-2 py-1 rounded border transition-colors ${
              cacheCount === 0
                ? "border-border text-muted-foreground/40 cursor-not-allowed"
                : "border-border text-muted-foreground hover:text-red-500 hover:border-red-500/40 hover:bg-red-500/10"
            }`}
          >
            <Trash2 size={12} />
            {t("settings.grounding.clearCache", { count: String(cacheCount) })}
          </button>
        </div>
      )}

      {/* verdict フィルタ chips */}
      <div className="flex items-center gap-2 flex-wrap">
        {VERDICT_FILTERS.map((v) => (
          <button
            key={v}
            onClick={() => setVerdictFilter(v)}
            className={`px-2 py-1 text-xs rounded border transition-colors ${
              verdictFilter === v
                ? "border-primary text-primary bg-primary/10"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {v === "all"
              ? t("settings.grounding.filterAll")
              : t(`wikiBanner.worldVerdict.${v}` as any)}
          </button>
        ))}
      </div>

      {/* 検索ボックス（独立行で全幅） */}
      <div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("settings.grounding.searchPlaceholder")}
          className="w-full px-2 py-1 text-xs rounded border border-border bg-background"
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

      {/* KB 自体が空のときとフィルタで 0 件のときを区別する（フィルタが原因と誤読させない） */}
      {kb && !loading && filtered.length === 0 && (
        <div className="text-xs text-muted-foreground py-4">
          {t(kb.entries.length === 0 ? "settings.grounding.emptyKb" : "settings.grounding.empty")}
        </div>
      )}

      <div className="space-y-2 max-h-[420px] overflow-auto">
        {filtered.map((entry) => (
          <KbEntryRow key={entry.id} entry={entry} onDelete={handleDelete} />
        ))}
      </div>

      <div className="text-xs text-muted-foreground border-t border-border pt-3">
        {t("settings.grounding.editHint")}{" "}
        <code className="text-xs bg-muted px-1 rounded">
          public/grounding-kb/seed.v1.json
        </code>
      </div>
    </div>
  );
}

function KbEntryRow({
  entry,
  onDelete,
}: {
  entry: KbEntry;
  onDelete: (entry: KbEntry) => void;
}) {
  const { t } = useLocale();
  const palette: Record<GroundingValidityVerdict, string> = {
    established: "text-emerald-700 bg-emerald-500/10",
    supported: "text-emerald-600 bg-emerald-500/5",
    weak: "text-amber-700 bg-amber-500/10",
    contested: "text-rose-700 bg-rose-500/10",
  };
  const seed = isSeedEntry(entry);
  return (
    <div className="rounded border border-border p-2 text-xs">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${
            palette[entry.verdict]
          }`}
        >
          <Globe2 size={9} />
          {t(`wikiBanner.worldVerdict.${entry.verdict}` as any)}
        </span>
        <code className="text-xs text-muted-foreground">{entry.id}</code>
        <span
          className={`text-xs px-1 py-0.5 rounded ${
            seed
              ? "bg-muted text-muted-foreground"
              : "bg-blue-500/10 text-blue-600"
          }`}
          title={
            seed
              ? t("settings.grounding.seedBadgeTooltip")
              : t("settings.grounding.cacheBadgeTooltip", {
                  model: entry.generatedByModel ?? "",
                })
          }
        >
          {seed
            ? t("settings.grounding.seedBadge")
            : t("settings.grounding.cacheBadge")}
        </span>
        <button
          type="button"
          onClick={() => onDelete(entry)}
          disabled={seed}
          aria-label={t("settings.grounding.deleteAria")}
          title={
            seed
              ? t("settings.grounding.deleteSeedBlocked")
              : t("settings.grounding.deleteTooltip")
          }
          className={`ml-auto p-1 rounded transition-colors ${
            seed
              ? "text-muted-foreground/40 cursor-not-allowed"
              : "text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
          }`}
        >
          <Trash2 size={12} />
        </button>
      </div>
      <div className="text-foreground mb-1">{entry.claim}</div>
      <div className="text-muted-foreground mb-1">{entry.rationale}</div>
      <div className="flex items-start gap-1 flex-wrap">
        <span className="text-xs text-muted-foreground">keywords:</span>
        {entry.keywords.map((k, i) => (
          <code key={k + i} className="text-xs bg-muted px-1 rounded">
            {k}
          </code>
        ))}
      </div>
      {entry.sources && entry.sources.length > 0 && (
        <div className="flex items-start gap-1 flex-wrap mt-1">
          <span className="text-xs text-muted-foreground">sources:</span>
          {entry.sources.map((s, i) => (
            <span key={i} className="text-xs">
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

// ─────────────────────────────────────────────────────────────
// About タブ — 現在バージョン表示と更新確認
// ・Tauri 環境: Tauri の getVersion() / updater プラグインを使う
// ・Web 環境: package.json の version を表示、更新確認はサポート外
// ─────────────────────────────────────────────────────────────

function AboutTab() {
  const { t } = useLocale();
  const [version, setVersion] = useState<string>("");
  const [checkState, setCheckState] = useState<
    | { status: "idle" }
    | { status: "checking" }
    | CheckResult
  >({ status: "idle" });

  useEffect(() => {
    let cancelled = false;
    getAppVersion()
      .then((v) => {
        if (!cancelled) setVersion(v);
      })
      .catch(() => {
        // 取得失敗時は空のまま
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCheck = useCallback(async () => {
    setCheckState({ status: "checking" });
    const result = await checkForUpdates();
    setCheckState(result);
  }, []);

  const tauri = isTauri();

  return (
    <div className="space-y-6">
      {/* アプリ情報パネル */}
      <div className="rounded-lg border border-border p-4">
        <div className="flex items-center gap-2 mb-3">
          <Info size={14} className="text-muted-foreground" />
          <h3 className="text-xs font-semibold text-foreground">
            {t("settings.about.title")}
          </h3>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t("settings.about.appName")}</span>
            <span className="font-medium text-foreground">Graphium</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t("settings.about.version")}</span>
            <span className="font-mono text-xs text-foreground">
              {version || "—"}
            </span>
          </div>
        </div>
      </div>

      {/* 更新確認パネル */}
      <div className="rounded-lg border border-border p-4 space-y-3">
        <h3 className="text-xs font-semibold text-foreground">
          {t("settings.about.updates")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {tauri
            ? t("settings.about.autoCheckNote")
            : t("settings.about.webNote")}
        </p>
        {tauri && (
          <>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={handleCheck}
                disabled={checkState.status === "checking"}
              >
                {checkState.status === "checking" ? (
                  <>
                    <Loader2 size={12} className="animate-spin mr-1.5" />
                    {t("settings.about.checking")}
                  </>
                ) : (
                  <>
                    <RotateCcw size={12} className="mr-1.5" />
                    {t("settings.about.checkNow")}
                  </>
                )}
              </Button>
            </div>
            {checkState.status === "up-to-date" && (
              <div className="flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400">
                <CheckCircle size={14} />
                {t("settings.about.upToDate")}
              </div>
            )}
            {checkState.status === "available" && (
              <div className="flex items-center gap-1.5 text-xs text-foreground">
                <AlertCircle size={14} className="text-amber-500" />
                {t("settings.about.available", { version: checkState.version })}
              </div>
            )}
            {checkState.status === "error" && (
              <div className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
                <XCircle size={14} className="mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1 break-words">
                  {t("settings.about.checkFailed")}
                  <div className="text-foreground/70 mt-0.5">{checkState.message}</div>
                </div>
              </div>
            )}
            {checkState.status === "unsupported" && (
              <div className="text-xs text-muted-foreground">
                {t("settings.about.unsupported")}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
