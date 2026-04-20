// 設定の永続化・取得
// localStorage を使ってユーザー設定を保存する

const STORAGE_KEY = "graphium-settings";

/** コアラベルのカスタム表示名（キーは内部ラベルキー、値はユーザーが設定した表示名） */
export type CustomLabels = Record<string, string>;

export type Settings = {
  /** AI で使用するモデル名（空文字 = サーバーデフォルト） */
  model: string;
  /** Embedding 用モデル名（空文字 = チャットモデルと同じ） */
  embeddingModel: string;
  /** AI プロファイル名（空文字 = "science"） */
  profile: string;
  /** 無効にしたツール名のリスト（ここに含まれるツールは AI チャットで使わない） */
  disabledTools: string[];
  /** Crucible Registry URL（空文字 = バックエンドの環境変数に委ねる） */
  registryUrl: string;
  /** コアラベルのカスタム表示名（空オブジェクト = デフォルト） */
  customLabels: CustomLabels;
};

const DEFAULT_SETTINGS: Settings = {
  model: "",
  embeddingModel: "",
  profile: "",
  disabledTools: [],
  registryUrl: "",
  customLabels: {},
};

/** localStorage から設定を読み込む */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** localStorage に設定を保存する */
export function saveSettings(settings: Settings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/** 選択中のモデル名を取得する（空文字 = サーバーデフォルト） */
export function getSelectedModel(): string {
  return loadSettings().model;
}

/** 選択中のプロファイル名を取得する（空文字なら "science"） */
export function getSelectedProfile(): string {
  return loadSettings().profile || "science";
}

/** 無効にしたツール名リストを取得する */
export function getDisabledTools(): string[] {
  return loadSettings().disabledTools;
}

/** Crucible Registry URL を取得する（空文字 = バックエンドのデフォルト） */
export function getRegistryUrl(): string {
  return loadSettings().registryUrl;
}

/** コアラベルのカスタム表示名を取得する */
export function getCustomLabels(): CustomLabels {
  return loadSettings().customLabels;
}

/** Embedding 用モデル名を取得する（空文字 = チャットモデルと同じ） */
export function getEmbeddingModel(): string {
  return loadSettings().embeddingModel;
}

/** AI バックエンドが利用可能かどうか（ビルトインバックエンドは常に available） */
export function isAgentConfigured(): boolean {
  return true;
}

// --- Web モード用: クライアント側 LLM モデル管理 ---
// Vercel 等の Serverless 環境では API キーをサーバーに保存できないため、
// クライアント（localStorage）でモデル設定を管理し、リクエストヘッダーで送信する

const LLM_MODELS_KEY = "graphium-llm-models";

export type LLMModelConfig = {
  id: string;
  name: string;
  provider: string;
  modelId: string;
  apiKey: string;
  apiBase: string | null;
};

/** クライアント保存のモデル一覧を取得 */
export function getLLMModels(): LLMModelConfig[] {
  try {
    const raw = localStorage.getItem(LLM_MODELS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as LLMModelConfig[];
  } catch {
    return [];
  }
}

/** クライアントにモデルを保存 */
export function addLLMModel(model: Omit<LLMModelConfig, "id">): LLMModelConfig {
  const models = getLLMModels();
  const newModel: LLMModelConfig = { ...model, id: crypto.randomUUID() };
  models.push(newModel);
  localStorage.setItem(LLM_MODELS_KEY, JSON.stringify(models));
  return newModel;
}

/** クライアントからモデルを削除 */
export function removeLLMModel(id: string): void {
  const models = getLLMModels().filter((m) => m.id !== id);
  localStorage.setItem(LLM_MODELS_KEY, JSON.stringify(models));
}

/** デフォルトの LLM モデルを取得（先頭のモデル） */
export function getDefaultLLMModel(): LLMModelConfig | undefined {
  const settings = loadSettings();
  const models = getLLMModels();
  if (models.length === 0) return undefined;
  // settings.model で名前指定されていればそれを優先
  if (settings.model) {
    const found = models.find((m) => m.name === settings.model);
    if (found) return found;
  }
  return models[0];
}
