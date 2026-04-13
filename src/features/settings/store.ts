// 設定の永続化・取得
// localStorage を使ってユーザー設定を保存する

const STORAGE_KEY = "graphium-settings";

/** コアラベルのカスタム表示名（キーは内部ラベルキー、値はユーザーが設定した表示名） */
export type CustomLabels = Record<string, string>;

export type Settings = {
  /** AI で使用するモデル名（空文字 = サーバーデフォルト） */
  model: string;
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

/** AI バックエンドが利用可能かどうか（ビルトインバックエンドは常に available） */
export function isAgentConfigured(): boolean {
  return true;
}
