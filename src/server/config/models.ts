// 登録済みモデルの永続化（JSON ファイル + Keychain）
// Node モード: data/models.json に保存する
// Vercel モード: ファイル I/O を行わない（API キーはリクエストヘッダーから取得）
//
// Tauri デスクトップ版（GRAPHIUM_USE_KEYCHAIN=1）では、API キーは macOS Keychain に
// 保存し、ファイルには metadata のみを書く。旧形式（apiKey をファイルに含む）の
// データは初回読み込み時に Keychain へ移行し、ファイルから消す。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  isKeychainEnabled,
  getApiKey,
  setApiKey,
  deleteApiKey,
} from "./keychain.js";

export type ServerMode = "node" | "vercel";

export type RateCurrency = "usd" | "jpy";

/** モデルの 1M トークンあたり単価。AI 使用量ダッシュボードのコスト計算に使う。
 *  currency を明示することで、ドル建て（Anthropic / OpenAI）と円建て（さくら AI 等）の
 *  モデルを混在させても、表示通貨に換算して合計を出せる。 */
export type TokenRate = {
  /** 入力トークンの単価（1M tokens あたり） */
  input: number;
  /** 出力トークンの単価 */
  output: number;
  /** prompt caching の読み出し単価。未設定なら input と同じ扱い */
  cacheRead?: number;
  /** prompt caching の書き込み単価。未設定なら input と同じ扱い */
  cacheWrite?: number;
  /** rate の通貨。未指定なら "usd" 扱い */
  currency?: RateCurrency;
};

export type ModelConfig = {
  id: string;
  /** 表示名 */
  name: string;
  /** プロバイダー識別子 (anthropic, openai, google, openai-compatible) */
  provider: string;
  /** プロバイダーのモデル ID (claude-sonnet-4-20250514 等) */
  modelId: string;
  /** API キー */
  apiKey: string;
  /** カスタム API ベース URL（OpenAI 互換用） */
  apiBase: string | null;
  /** トークン単価（USD / 1M tokens）。未設定ならコスト計算をスキップする。 */
  rate?: TokenRate;
  createdAt: string;
};

/** ファイルに書く形式。Keychain 有効時は apiKey を含まない */
type StoredModelConfig = Omit<ModelConfig, "apiKey"> & { apiKey?: string };

let serverMode: ServerMode = "node";
let dataDir = join(process.cwd(), "data");
let migrated = false;

/** サーバーモードを設定する（Vercel ではファイル I/O を無効化） */
export function setServerMode(mode: ServerMode): void {
  serverMode = mode;
}

export function getServerMode(): ServerMode {
  return serverMode;
}

/** データディレクトリを設定する（テスト・Docker 用） */
export function setDataDir(dir: string): void {
  dataDir = dir;
  // dataDir が変わったら次の読み込みで再度移行を試みる
  migrated = false;
}

function modelsPath(): string {
  return join(dataDir, "models.json");
}

function ensureDataDir(): void {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
}

function readRawStored(): StoredModelConfig[] {
  try {
    const raw = readFileSync(modelsPath(), "utf-8");
    return JSON.parse(raw) as StoredModelConfig[];
  } catch (e) {
    // ENOENT は「まだ保存していない」状態として静かに [] を返す。
    // それ以外（権限エラー / JSON 破損）は黙って [] を返すと「登録したはずの
    // モデルが消えた」というサイレント故障になるので、必ず warn を残す。
    const code = (e as NodeJS.ErrnoException | undefined)?.code;
    if (code !== "ENOENT") {
      console.warn(
        `[models] failed to read ${modelsPath()} (code=${code ?? "?"}): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    return [];
  }
}

function writeRawStored(models: StoredModelConfig[]): void {
  ensureDataDir();
  writeFileSync(modelsPath(), JSON.stringify(models, null, 2), "utf-8");
}

/**
 * 旧形式（apiKey がファイルに平文で含まれる）から Keychain へ一度だけ移行する。
 * 移行後は apiKey フィールドを除いたファイルを書き戻し、平文を残さない。
 */
function migrateIfNeeded(): void {
  if (migrated || !isKeychainEnabled()) {
    migrated = true;
    return;
  }
  const stored = readRawStored();
  let changed = false;
  for (const m of stored) {
    if (m.apiKey && m.apiKey.length > 0) {
      try {
        setApiKey(m.id, m.apiKey);
        delete m.apiKey;
        changed = true;
      } catch (e) {
        // 一件失敗しても他のモデルの移行は続行する。失敗したエントリは次回起動で
        // 再試行されるよう、apiKey をそのまま残す（ファイル書き戻し対象外）。
        console.warn(
          `[models] Keychain migration failed for ${m.id}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
  }
  if (changed) {
    writeRawStored(stored);
  }
  migrated = true;
}

/** ストア済みのレコードに Keychain から取得した API キーをマージする */
function hydrate(stored: StoredModelConfig[]): ModelConfig[] {
  if (isKeychainEnabled()) {
    return stored.map((m) => ({
      ...m,
      apiKey: getApiKey(m.id) ?? m.apiKey ?? "",
    }));
  }
  return stored.map((m) => ({ ...m, apiKey: m.apiKey ?? "" }));
}

function readModels(): ModelConfig[] {
  migrateIfNeeded();
  return hydrate(readRawStored());
}

export function listModels(): ModelConfig[] {
  if (serverMode === "vercel") return [];
  return readModels();
}

export function getModel(id: string): ModelConfig | undefined {
  if (serverMode === "vercel") return undefined;
  return readModels().find((m) => m.id === id);
}

export function getDefaultModel(): ModelConfig | undefined {
  if (serverMode === "vercel") return undefined;
  const models = readModels();
  return models[0];
}

/**
 * 登録はされているが API キーが空文字のモデル一覧を返す。
 *
 * これが空でない状況は production だと事故サインで、想定する典型は:
 *   - Keychain ダウングレード罠: Keychain 有効版で起動 → 移行で
 *     models.json から apiKey 消える → Keychain 非対応版にダウングレード →
 *     ファイル側にもキーが無く Keychain も読めず、空キーで起動した状態
 *   - Keychain エントリ自体が削除された（手動 / 別ユーザーで起動した等）
 *
 * UI 側はこれを見て「保存済みキーが読めない / 再入力してください」の
 * 警告を出す。Vercel モードはヘッダ経由でキーが渡る前提なので対象外。
 *
 * claude-subscription は Claude Code のサブスク認証を使い API キーを持たない
 * （空キーが正常）。これを対象に含めると「キーを貼り直して」と誤案内するので除外する。
 */
export function findModelsWithMissingApiKey(): Array<{
  id: string;
  name: string;
  provider: string;
}> {
  if (serverMode === "vercel") return [];
  return readModels()
    .filter((m) => !m.apiKey && m.provider !== "claude-subscription")
    .map((m) => ({ id: m.id, name: m.name, provider: m.provider }));
}

export function addModel(
  input: Omit<ModelConfig, "id" | "createdAt">,
): ModelConfig {
  if (serverMode === "vercel") {
    throw new Error("Model persistence is not available in Vercel mode");
  }
  migrateIfNeeded();
  const stored = readRawStored();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  if (isKeychainEnabled()) {
    setApiKey(id, input.apiKey);
    const record: StoredModelConfig = {
      id,
      name: input.name,
      provider: input.provider,
      modelId: input.modelId,
      apiBase: input.apiBase,
      rate: input.rate,
      createdAt,
    };
    stored.push(record);
    writeRawStored(stored);
  } else {
    const record: StoredModelConfig = {
      id,
      name: input.name,
      provider: input.provider,
      modelId: input.modelId,
      apiKey: input.apiKey,
      apiBase: input.apiBase,
      rate: input.rate,
      createdAt,
    };
    stored.push(record);
    writeRawStored(stored);
  }
  return { ...input, id, createdAt };
}

export function updateModel(
  id: string,
  input: Partial<Omit<ModelConfig, "id" | "createdAt">>,
): ModelConfig | undefined {
  if (serverMode === "vercel") {
    throw new Error("Model persistence is not available in Vercel mode");
  }
  migrateIfNeeded();
  const stored = readRawStored();
  const idx = stored.findIndex((m) => m.id === id);
  if (idx < 0) return undefined;
  const existing = stored[idx];
  const next: StoredModelConfig = { ...existing };
  if (input.name !== undefined) next.name = input.name;
  if (input.provider !== undefined) next.provider = input.provider;
  if (input.modelId !== undefined) next.modelId = input.modelId;
  if (input.apiBase !== undefined) next.apiBase = input.apiBase;
  if (input.rate !== undefined) next.rate = input.rate;

  // apiKey 更新（空文字なら既存維持）
  let newKey: string | undefined;
  if (input.apiKey) {
    newKey = input.apiKey;
  }

  if (isKeychainEnabled()) {
    if (newKey) {
      setApiKey(id, newKey);
    }
    delete next.apiKey;
    stored[idx] = next;
    writeRawStored(stored);
    return {
      ...next,
      apiBase: next.apiBase,
      apiKey: getApiKey(id) ?? "",
    };
  } else {
    if (newKey) next.apiKey = newKey;
    stored[idx] = next;
    writeRawStored(stored);
    return { ...next, apiKey: next.apiKey ?? "" };
  }
}

export function removeModel(id: string): boolean {
  if (serverMode === "vercel") {
    throw new Error("Model persistence is not available in Vercel mode");
  }
  migrateIfNeeded();
  const stored = readRawStored();
  const filtered = stored.filter((m) => m.id !== id);
  if (filtered.length === stored.length) return false;
  writeRawStored(filtered);
  if (isKeychainEnabled()) {
    deleteApiKey(id);
  }
  return true;
}
