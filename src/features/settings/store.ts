// 設定の永続化・取得
// localStorage を使ってユーザー設定を保存する

const STORAGE_KEY = "provnote-settings";

export type Settings = {
  /** AI エージェントの接続先 URL（例: http://localhost:8090） */
  agentUrl: string;
  /** AI エージェントの API キー（X-API-Key ヘッダーで送信） */
  agentApiKey: string;
  /** AI で使用するモデル名（空文字 = サーバーデフォルト） */
  model: string;
  /** AI プロファイル名（空文字 = "science"） */
  profile: string;
};

const DEFAULT_SETTINGS: Settings = {
  agentUrl: "",
  agentApiKey: "",
  model: "",
  profile: "",
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

/** AI エージェント URL を取得する（localStorage → 環境変数 → 空文字） */
export function getAgentUrl(): string {
  const settings = loadSettings();
  if (settings.agentUrl) return settings.agentUrl;
  return import.meta.env.VITE_CRUCIBLE_AGENT_URL ?? "";
}

/** AI エージェント API キーを取得する（localStorage → 環境変数 → 空文字） */
export function getAgentApiKey(): string {
  const settings = loadSettings();
  if (settings.agentApiKey) return settings.agentApiKey;
  return import.meta.env.VITE_CRUCIBLE_AGENT_API_KEY ?? "";
}

/** 選択中のモデル名を取得する（空文字 = サーバーデフォルト） */
export function getSelectedModel(): string {
  return loadSettings().model;
}

/** 選択中のプロファイル名を取得する（空文字なら "science"） */
export function getSelectedProfile(): string {
  return loadSettings().profile || "science";
}

/** AI エージェントが設定済みかどうか */
export function isAgentConfigured(): boolean {
  return getAgentUrl() !== "";
}
