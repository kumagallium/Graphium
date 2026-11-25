// AI の接続を配るファイル（.graphium-ai.json）の形と、読み込みの計画。
//
// 研究室で 1 人がつないだ接続（研究室のサーバーなど）を、ほかの人がファイルを開くだけで
// 使えるようにする。設計: docs/internal/preconfigured-distribution-design-2026-11.md
//
// 守ること:
// - キーは任意。入れるときは crypto.ts で暗号化するのが既定（平文も選べる）
// - 読み込みでは既存の接続を置き換えない。同じ送り先・同じモデルはとばし、名前がぶつかれば別の名前で足す
//   （配られたファイルで送り先を差し替えられないように）
// - 配れるのはキーで呼ぶ接続だけ。GitHub Copilot・ChatGPT のプランは本人のサインインなので配らない
//
// DOM・localStorage・fetch に依存しない純関数だけを置く（テストと画面の両方から使う）。

export const CONNECTION_FILE_FORMAT = "graphium-ai-connection";
export const CONNECTION_FILE_VERSION = 1;
export const CONNECTION_FILE_EXTENSION = ".graphium-ai.json";

/** 配れる接続の種類（キーで呼ぶもの） */
export const DISTRIBUTABLE_PROVIDERS = ["openai-compatible", "openai", "anthropic", "google"] as const;
export type DistributableProvider = (typeof DISTRIBUTABLE_PROVIDERS)[number];

/** 送り先が空（各社の既定）のときに確認の画面へ出すホスト名 */
const DEFAULT_HOSTS: Record<DistributableProvider, string> = {
  "openai-compatible": "",
  openai: "api.openai.com",
  anthropic: "api.anthropic.com",
  google: "generativelanguage.googleapis.com",
};

const MAX_MODELS = 50;
const MAX_NAME = 100;
const MAX_MODEL_ID = 200;
const MAX_FROM = 100;
/** キーの暗号文の上限（ふつうのキーは数百バイト。おかしなファイルで固まらないように） */
const MAX_KEY_FIELD = 8_000;

export type EncryptedKey = {
  alg: "AES-GCM";
  kdf: "PBKDF2-SHA256";
  iterations: number;
  /** base64 */
  salt: string;
  /** base64 */
  iv: string;
  /** base64（暗号文と認証タグ） */
  data: string;
};

export type ConnectionFileKey = { plain: string } | { encrypted: EncryptedKey };

export type ConnectionFileModel = { name: string; modelId: string };

export type ConnectionFile = {
  format: typeof CONNECTION_FILE_FORMAT;
  version: typeof CONNECTION_FILE_VERSION;
  /** 書き出した日時（ISO 8601） */
  createdAt: string;
  /** 配った人の名前（自己申告。空なら出さない） */
  from?: string;
  connection: {
    provider: DistributableProvider;
    /** 空なら各社の既定の送り先 */
    apiBase: string | null;
    models: ConnectionFileModel[];
  };
  key?: ConnectionFileKey;
};

export function isDistributableProvider(v: unknown): v is DistributableProvider {
  return typeof v === "string" && (DISTRIBUTABLE_PROVIDERS as readonly string[]).includes(v);
}

/** 書き出す。key は呼ぶ側で用意する（暗号化するなら crypto.ts の encryptKey） */
export function buildConnectionFile(input: {
  provider: DistributableProvider;
  apiBase: string | null;
  models: ConnectionFileModel[];
  from?: string;
  key?: ConnectionFileKey;
  now?: Date;
}): ConnectionFile {
  const from = input.from?.trim();
  const file: ConnectionFile = {
    format: CONNECTION_FILE_FORMAT,
    version: CONNECTION_FILE_VERSION,
    createdAt: (input.now ?? new Date()).toISOString(),
    ...(from ? { from: from.slice(0, MAX_FROM) } : {}),
    connection: {
      provider: input.provider,
      apiBase: input.apiBase?.trim() ? input.apiBase.trim() : null,
      models: input.models.map((m) => ({ name: m.name.trim(), modelId: m.modelId.trim() })),
    },
    ...(input.key ? { key: input.key } : {}),
  };
  // 書き出したものが自分の読み込みで通ることを保証する
  return parseConnectionFile(JSON.parse(JSON.stringify(file)));
}

/** 理由つきの読み込みエラー。code を画面の文言に置き換える */
export class ConnectionFileError extends Error {
  constructor(
    readonly code:
      | "notJson"
      | "notConnectionFile"
      | "unsupportedVersion"
      | "badProvider"
      | "badApiBase"
      | "noModels"
      | "badModel"
      | "badKey"
      | "keyRequired",
  ) {
    super(code);
    this.name = "ConnectionFileError";
  }
}

/** 文字列（ファイルの中身）から読む */
export function parseConnectionFileText(text: string): ConnectionFile {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ConnectionFileError("notJson");
  }
  return parseConnectionFile(json);
}

/** 形を確かめる。知らない欄は捨てる */
export function parseConnectionFile(json: unknown): ConnectionFile {
  if (!json || typeof json !== "object") throw new ConnectionFileError("notConnectionFile");
  const f = json as Record<string, unknown>;
  if (f.format !== CONNECTION_FILE_FORMAT) throw new ConnectionFileError("notConnectionFile");
  if (f.version !== CONNECTION_FILE_VERSION) throw new ConnectionFileError("unsupportedVersion");
  const c = f.connection as Record<string, unknown> | undefined;
  if (!c || typeof c !== "object") throw new ConnectionFileError("notConnectionFile");
  if (!isDistributableProvider(c.provider)) throw new ConnectionFileError("badProvider");

  let apiBase: string | null = null;
  if (c.apiBase !== null && c.apiBase !== undefined && c.apiBase !== "") {
    if (typeof c.apiBase !== "string" || !isHttpUrl(c.apiBase)) throw new ConnectionFileError("badApiBase");
    apiBase = c.apiBase.trim();
  }
  // OpenAI 互換は送り先が無いと呼べない
  if (c.provider === "openai-compatible" && !apiBase) throw new ConnectionFileError("badApiBase");

  if (!Array.isArray(c.models) || c.models.length === 0) throw new ConnectionFileError("noModels");
  if (c.models.length > MAX_MODELS) throw new ConnectionFileError("badModel");
  const models: ConnectionFileModel[] = c.models.map((m) => {
    const mm = m as Record<string, unknown>;
    const name = typeof mm?.name === "string" ? mm.name.trim() : "";
    const modelId = typeof mm?.modelId === "string" ? mm.modelId.trim() : "";
    if (!name || !modelId || name.length > MAX_NAME || modelId.length > MAX_MODEL_ID) {
      throw new ConnectionFileError("badModel");
    }
    return { name, modelId };
  });
  // 同じモデルが 2 度書かれたファイルは断る（別の名前で 2 件登録されてしまう）
  if (new Set(models.map((m) => m.modelId)).size !== models.length) throw new ConnectionFileError("badModel");
  // 各社の公式の API はキーが無いと呼べない。キーなしで読み込むと、使うまで失敗に気づけない
  if (c.provider !== "openai-compatible" && f.key === undefined) throw new ConnectionFileError("keyRequired");

  const from = typeof f.from === "string" && f.from.trim() ? f.from.trim().slice(0, MAX_FROM) : undefined;
  const createdAt = typeof f.createdAt === "string" ? f.createdAt : "";

  return {
    format: CONNECTION_FILE_FORMAT,
    version: CONNECTION_FILE_VERSION,
    createdAt,
    ...(from ? { from } : {}),
    connection: { provider: c.provider, apiBase, models },
    ...(f.key !== undefined ? { key: parseKey(f.key) } : {}),
  };
}

function parseKey(v: unknown): ConnectionFileKey {
  if (!v || typeof v !== "object") throw new ConnectionFileError("badKey");
  const k = v as Record<string, unknown>;
  if (typeof k.plain === "string") {
    if (!k.plain || k.plain.length > MAX_KEY_FIELD) throw new ConnectionFileError("badKey");
    return { plain: k.plain };
  }
  const e = k.encrypted as Record<string, unknown> | undefined;
  if (
    e &&
    e.alg === "AES-GCM" &&
    e.kdf === "PBKDF2-SHA256" &&
    typeof e.iterations === "number" &&
    Number.isInteger(e.iterations) &&
    e.iterations >= 100_000 &&
    e.iterations <= 10_000_000 &&
    [e.salt, e.iv, e.data].every((s) => typeof s === "string" && s.length > 0 && s.length <= MAX_KEY_FIELD)
  ) {
    return {
      encrypted: {
        alg: "AES-GCM",
        kdf: "PBKDF2-SHA256",
        iterations: e.iterations,
        salt: e.salt as string,
        iv: e.iv as string,
        data: e.data as string,
      },
    };
  }
  throw new ConnectionFileError("badKey");
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s.trim());
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** 確認の画面に出す送り先。ノートの内容が実際に届く先なので、読み込む前に必ず見せる */
export function destinationOf(file: ConnectionFile): { host: string; url: string | null; secure: boolean } {
  const { provider, apiBase } = file.connection;
  if (!apiBase) return { host: DEFAULT_HOSTS[provider], url: null, secure: true };
  const u = new URL(apiBase);
  return { host: u.host, url: apiBase, secure: u.protocol === "https:" };
}

export function keyKind(file: ConnectionFile): "none" | "plain" | "encrypted" {
  if (!file.key) return "none";
  return "plain" in file.key ? "plain" : "encrypted";
}

/** 今ある接続（設定画面の一覧の 1 行） */
export type ExistingModel = { name: string; provider: string; apiBase: string | null; modelId: string };

export type ImportStep =
  | { action: "add"; name: string; modelId: string }
  | { action: "skip"; name: string; modelId: string; existingName: string };

/**
 * 読み込みの計画を立てる。既存は置き換えない。
 * - 同じ種類・同じ送り先・同じモデルがあれば、とばす（2 回読み込んでも増えない）
 * - 名前だけがぶつかるときは「名前 (2)」のように別の名前で足す（別の送り先を同じ名前で上書きしない）
 */
export function planImport(file: ConnectionFile, existing: ExistingModel[]): ImportStep[] {
  const norm = (s: string | null) => (s ?? "").trim().replace(/\/+$/, "").toLowerCase();
  const taken = new Set(existing.map((m) => m.name.trim().toLowerCase()));
  const { provider, apiBase } = file.connection;
  return file.connection.models.map((m) => {
    const same = existing.find(
      (e) => e.provider === provider && norm(e.apiBase) === norm(apiBase) && e.modelId.trim() === m.modelId,
    );
    if (same) return { action: "skip", name: m.name, modelId: m.modelId, existingName: same.name };
    let name = m.name;
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${m.name} (${i})`;
    taken.add(name.toLowerCase());
    return { action: "add", name, modelId: m.modelId };
  });
}

/** 書き出すファイル名の候補（ファイル名に使えない文字を除く） */
export function suggestedFileName(connectionName: string): string {
  const base = connectionName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").trim().slice(0, 60) || "ai-connection";
  return `${base}${CONNECTION_FILE_EXTENSION}`;
}
