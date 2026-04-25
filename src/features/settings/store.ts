// 設定の永続化・取得
// localStorage を使ってユーザー設定を保存する

const STORAGE_KEY = "graphium-settings";

/** コアラベルのカスタム表示名（キーは内部ラベルキー、値はユーザーが設定した表示名） */
export type CustomLabels = Record<string, string>;

/**
 * ラテン文字用フォント。
 * - ""              : デフォルト = Atkinson Hyperlegible Next + Inter 数字
 *                     （Atkinson の 0 はスラッシュ入りで好まない人向けに数字だけ Inter）
 * - "atkinson-next" : Atkinson Next 単体（数字も Atkinson のグリフ、スラッシュ 0 容認）
 * - "inter"         : Inter（design.md の元仕様、中立的なヒューマニスト体）
 * - "lexend"        : Lexend（NASA 共同研究の読み速度最適化）
 */
export type LatinFont = "" | "atkinson-next" | "inter" | "lexend";
export const LATIN_FONTS: readonly LatinFont[] = ["", "atkinson-next", "inter", "lexend"] as const;

/**
 * 日本語用フォント。
 * - ""        : デフォルト = OS のシステムフォント（Hiragino 等）
 * - "biz-udp" : BIZ UDPGothic（モリサワ × 政府の UD ゴシック / OFL ライセンス）
 */
export type JpFont = "" | "biz-udp";
export const JP_FONTS: readonly JpFont[] = ["", "biz-udp"] as const;

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
  /** ラテン文字用フォント。空文字 = デフォルト（Atkinson Next + Inter 数字） */
  latinFont: LatinFont;
  /** 日本語用フォント。空文字 = デフォルト（OS システムフォント） */
  jpFont: JpFont;
};

const DEFAULT_SETTINGS: Settings = {
  model: "",
  embeddingModel: "",
  profile: "",
  disabledTools: [],
  registryUrl: "",
  customLabels: {},
  latinFont: "",
  jpFont: "",
};

/**
 * customLabels のキーは Phase 2 で日本語ブラケット（[手順] 等）から
 * 内部キー（procedure 等）に移行した。localStorage に残っている旧キーを
 * 読み込み時に正規化して吸収する。
 */
const LEGACY_LABEL_KEY_MAP: Record<string, string> = {
  "[手順]": "procedure",
  "[材料]": "material",
  "[ツール]": "tool",
  "[属性]": "attribute",
  "[結果]": "result",
  "[使用したもの]": "material",
  "[条件]": "attribute",
};

function migrateCustomLabels(customLabels: CustomLabels | undefined): CustomLabels {
  if (!customLabels) return {};
  const next: CustomLabels = {};
  for (const [key, value] of Object.entries(customLabels)) {
    const normalized = LEGACY_LABEL_KEY_MAP[key] ?? key;
    next[normalized] = value;
  }
  return next;
}

/** localStorage から設定を読み込む */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings> & { font?: string };
    // 旧 `font` フィールドを latinFont / jpFont に振り分ける（一回限りのマイグレーション）
    const legacyFont = typeof parsed.font === "string" ? parsed.font : "";
    const migratedLatin: LatinFont = parsed.latinFont !== undefined
      ? (LATIN_FONTS.includes(parsed.latinFont) ? parsed.latinFont : "")
      : (legacyFont === "inter" || legacyFont === "lexend" ? legacyFont : "");
    const migratedJp: JpFont = parsed.jpFont !== undefined
      ? (JP_FONTS.includes(parsed.jpFont) ? parsed.jpFont : "")
      : (legacyFont === "biz-udp" ? "biz-udp" : "");
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      customLabels: migrateCustomLabels(parsed.customLabels),
      latinFont: migratedLatin,
      jpFont: migratedJp,
    };
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

/** 選択中のラテン用フォントを取得する（空文字 = デフォルト） */
export function getSelectedLatinFont(): LatinFont {
  const v = loadSettings().latinFont;
  return LATIN_FONTS.includes(v) ? v : "";
}

/** 選択中の日本語用フォントを取得する（空文字 = デフォルト） */
export function getSelectedJpFont(): JpFont {
  const v = loadSettings().jpFont;
  return JP_FONTS.includes(v) ? v : "";
}

/**
 * 本文フォントを body に反映する。
 * 空文字（デフォルト）の場合は対応する data 属性を削除し、CSS の `--ui` フォールバックを使う。
 */
export function applyFontMode(latinFont: LatinFont, jpFont: JpFont): void {
  if (typeof document === "undefined") return;
  if (latinFont) document.body.setAttribute("data-latin-font", latinFont);
  else document.body.removeAttribute("data-latin-font");
  if (jpFont) document.body.setAttribute("data-jp-font", jpFont);
  else document.body.removeAttribute("data-jp-font");
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
