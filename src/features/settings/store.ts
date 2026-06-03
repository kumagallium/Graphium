// 設定の永続化・取得
// localStorage を使ってユーザー設定を保存する

const STORAGE_KEY = "graphium-settings";

/** コアラベルのカスタム表示名（キーは内部ラベルキー、値はユーザーが設定した表示名） */
export type CustomLabels = Record<string, string>;

/**
 * ラテン文字用フォント。
 * - ""                    : デフォルト = Inter（design.md の元仕様、中立的なヒューマニスト体）
 * - "atkinson-next-mixed" : Atkinson Next + Inter 数字（dyslexia 配慮、Atkinson のスラッシュ 0 を回避）
 * - "atkinson-next"       : Atkinson Next 単体（数字もスラッシュ 0）
 * - "lexend"              : Lexend（NASA 共同研究の読み速度最適化）
 */
export type LatinFont = "" | "atkinson-next-mixed" | "atkinson-next" | "lexend";
export const LATIN_FONTS: readonly LatinFont[] = ["", "atkinson-next-mixed", "atkinson-next", "lexend"] as const;

/**
 * 日本語用フォント。
 * - ""         : デフォルト = OS のシステムフォント（Hiragino 等）
 * - "zen-kaku" : Zen Kaku Gothic New（大平善道、本文向きで字間ゆったり / OFL）
 * - "biz-udp"  : BIZ UDPGothic（モリサワ × 政府の UD ゴシック / OFL）
 */
export type JpFont = "" | "zen-kaku" | "biz-udp";
export const JP_FONTS: readonly JpFont[] = ["", "zen-kaku", "biz-udp"] as const;

/**
 * MCP サーバーのトランスポート種別。
 * - "sse"             : Server-Sent Events（旧来のエンドポイント、パスは /sse 等）
 * - "streamable-http" : Streamable HTTP（新方式、パスは /mcp 等）
 */
export type McpTransport = "sse" | "streamable-http";
export const MCP_TRANSPORTS: readonly McpTransport[] = ["sse", "streamable-http"] as const;

/** MCP サーバー登録の共通フィールド */
type McpServerBase = {
  /** 内部 ID（crypto.randomUUID） */
  id: string;
  /** 表示名 / ツール名前空間 */
  name: string;
  /** AI チャットで使うか（false なら接続しない） */
  enabled: boolean;
};

/**
 * ローカルで起動する MCP サーバー（stdio トランスポート）。
 * Claude Desktop と同じ方式: アプリがコマンドを子プロセスとして spawn し、
 * 標準入出力でツールと通信する。ユーザーはサーバーの起動・終了を意識しない。
 * バックエンド（Tauri sidecar / Docker / dev）がある環境でのみ動作する
 * （ブラウザ単体ではプロセスを起動できないため）。
 */
export type McpStdioServer = McpServerBase & {
  type: "stdio";
  /** 実行コマンド（例: "npx", "uvx", "node"） */
  command: string;
  /** コマンド引数（例: ["-y", "@modelcontextprotocol/server-filesystem", "~/notes"]） */
  args: string[];
  /** 子プロセスに渡す追加の環境変数（任意） */
  env?: Record<string, string>;
};

/**
 * リモート/起動済みの MCP サーバー（HTTP/SSE トランスポート）。
 * ユーザーが起動済みサーバーの URL を指定する。Crucible Registry が返す
 * エンドポイントもこの形（Crucible はエンドポイント参照の一ソースに過ぎない）。
 */
export type McpRemoteServer = McpServerBase & {
  type: "remote";
  /** 完全なエンドポイント URL（例: http://localhost:8100/sse） */
  url: string;
  /** トランスポート種別 */
  transport: McpTransport;
  /** 任意の認証トークン（Authorization: Bearer で送信） */
  apiKey?: string;
};

/**
 * ユーザーが登録した MCP サーバー 1 件。stdio（ローカル spawn）か remote（HTTP/SSE）。
 * Crucible Registry から取り込んだサーバーも、候補から選んだ時点で具体的な URL を持つ
 * remote エントリとしてこのリストに individually 並ぶ（レジストリ自体は接続先ではない）。
 */
export type McpServerEntry = McpStdioServer | McpRemoteServer;

/**
 * 記憶しておく Crucible Registry。接続先ではなく「候補をブラウズする元」。
 * 「レジストリから追加」で URL を入れて候補取得すると、ここに保存され、
 * 次回プリフィル・再ブラウズできる。選んだサーバーは remote エントリになる。
 */
export type SavedRegistry = {
  id: string;
  /** Crucible Registry のベース URL（例: http://localhost:8080） */
  url: string;
  /** Registry API キー（X-API-Key、任意） */
  apiKey?: string;
};

/**
 * URL のパスからトランスポート種別を推定する。
 * /mcp を含めば Streamable HTTP、それ以外は SSE とみなす（registry.detectTransport と同じ規約）。
 */
export function detectMcpTransport(url: string): McpTransport {
  try {
    const path = new URL(url).pathname;
    return path.includes("/mcp") ? "streamable-http" : "sse";
  } catch {
    return url.includes("/mcp") ? "streamable-http" : "sse";
  }
}

/** JSON の type/transport 値を内部の McpTransport に正規化する */
function coerceTransport(raw: unknown, url: string): McpTransport {
  if (typeof raw === "string") {
    const v = raw.toLowerCase();
    if (v === "sse") return "sse";
    if (v.includes("http") || v.includes("stream")) return "streamable-http";
  }
  return detectMcpTransport(url);
}

/** Authorization ヘッダー（"Bearer xxx"）からトークンを抜き出す */
function bearerFromHeaders(headers: unknown): string | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  const h = headers as Record<string, unknown>;
  const auth = h.Authorization ?? h.authorization;
  if (typeof auth === "string") {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1];
  }
  return undefined;
}

/** unknown を Record<string,string> に変換（文字列値のみ採用） */
function toStringRecord(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export type McpJsonParseResult = { servers: McpServerEntry[]; error?: "invalid-json" | "no-servers" };

/**
 * MCP サーバーの標準設定 JSON（Claude Desktop / Cursor 等の `mcpServers` 形式）を
 * パースして McpServerEntry[] に変換する。README からコピペした JSON をそのまま受け取る。
 *
 * 受け付ける形:
 *   - { "mcpServers": { "name": { command|url, ... }, ... } }  … 完全形
 *   - { "name": { command|url, ... }, ... }                    … 中身だけ
 *   - { "command": ... } / { "url": ... }                      … 名前なし単体
 *
 * 各サーバーは command があれば stdio、url があれば remote として登録する。
 * キー名がサーバー名になる（単体形は command の basename / url の host から補完）。
 */
export function parseMcpServersJson(text: string): McpJsonParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { servers: [], error: "no-servers" };

  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return { servers: [], error: "invalid-json" };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { servers: [], error: "no-servers" };
  }

  const obj = data as Record<string, unknown>;
  let map: Record<string, unknown>;
  if (obj.mcpServers && typeof obj.mcpServers === "object" && !Array.isArray(obj.mcpServers)) {
    map = obj.mcpServers as Record<string, unknown>;
  } else if (typeof obj.command === "string" || typeof obj.url === "string") {
    map = { "": obj }; // 名前なし単体
  } else {
    map = obj; // name → config のマップとみなす
  }

  const servers: McpServerEntry[] = [];
  for (const [key, raw] of Object.entries(map)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const cfg = raw as Record<string, unknown>;
    const id = crypto.randomUUID();

    // stdio: command が必須
    if (typeof cfg.command === "string" && cfg.command.trim()) {
      const command = cfg.command;
      const args = Array.isArray(cfg.args)
        ? cfg.args.filter((a): a is string => typeof a === "string")
        : [];
      const env = toStringRecord(cfg.env);
      // 名前: キー名 → command の basename
      const fallback = command.split("/").pop() || command;
      servers.push({
        type: "stdio",
        id,
        name: key.trim() || fallback,
        command,
        args,
        env,
        enabled: true,
      });
      continue;
    }

    // remote: url（または endpoint）が必須
    const url =
      typeof cfg.url === "string" && cfg.url.trim()
        ? cfg.url
        : typeof cfg.endpoint === "string" && cfg.endpoint.trim()
          ? cfg.endpoint
          : "";
    if (url) {
      let fallback = url;
      try {
        fallback = new URL(url).host;
      } catch {
        /* URL でなければ url 文字列 */
      }
      servers.push({
        type: "remote",
        id,
        name: key.trim() || fallback,
        url,
        transport: coerceTransport(cfg.type ?? cfg.transport, url),
        apiKey:
          (typeof cfg.apiKey === "string" && cfg.apiKey ? cfg.apiKey : undefined) ??
          bearerFromHeaders(cfg.headers),
        enabled: true,
      });
    }
  }

  if (servers.length === 0) return { servers: [], error: "no-servers" };
  return { servers };
}

/**
 * 実験的機能のオン/オフ。
 * - atomLayer: Concept をさらに抽象化した Atom 層を有効にする。
 *              Concept が新規に作成・更新された後、追加で Atom を自動生成する。
 * - synthesis: Atom を組み合わせた "結晶化" 知識（Synthesis）を有効にする。
 *              Atom 層に依存するため atomLayer が ON の時のみ意味を持つ。
 * 既定はどちらも OFF（デフォルトのフローは Note → Summary → Concept のみ）。
 * 既存ユーザーの Synthesis ファイルは保持され、フラグ ON で UI に再表示される。
 */
export type ExperimentalSettings = {
  atomLayer: boolean;
  synthesis: boolean;
  /**
   * 自動 world-grounding（opt-in / 既定 OFF）。
   * ON のとき、未照合の洞察・知見を background で1件ずつ世界照合する
   * （KB-first / ミス時のみ LLM）。既存の "user-triggered only" を覆すので
   * 既定 OFF。コストはユーザーの新規性レートに収束する（使うほど KB ヒットが増える）。
   */
  autoGrounding: boolean;
};

export type Settings = {
  /** AI で使用するモデル名（空文字 = サーバーデフォルト） */
  model: string;
  /** Embedding 用モデル名（空文字 = チャットモデルと同じ） */
  embeddingModel: string;
  /** AI チャット & Synthesis 用モデル名（空文字 = `model` と同じ）。
   *  対話的な推論（チャット）と複数 Concept の統合（Synthesis）は、
   *  バックグラウンド処理（ingest/lint/rewrite）よりも能力を要求する場面があるため、
   *  個別にもう一段上のモデルを当てられるようにする。 */
  chatSynthesisModel: string;
  /** 世界モデル照合用モデル名（PR 2B / 空文字 = `model` と同じ）。
   *  KB ヒットしなかった主張をモデル内部知識で判定する。プロンプトは厳密 JSON 出力を要求する。
   *  判定結果は appdata の grounding-kb-cache に「正規化主張 + keywords + verdict」として沈殿し、
   *  次回以降は KB ヒットで即答される（使うほど安くなる）。 */
  groundingModel: string;
  /** 無効にしたツール名のリスト（ここに含まれるツールは AI チャットで使わない） */
  disabledTools: string[];
  /** Crucible Registry URL（空文字 = バックエンドの環境変数に委ねる）。
   *  Crucible は MCP サーバーを「一括取り込み」できる任意のソース。空でも mcpServers だけで動く。 */
  registryUrl: string;
  /** ユーザーが直接登録した MCP サーバー一覧（Crucible 非依存の接続経路） */
  mcpServers: McpServerEntry[];
  /** 記憶した Crucible Registry（候補をブラウズする元。接続先ではない） */
  savedRegistries: SavedRegistry[];
  /** コアラベルのカスタム表示名（空オブジェクト = デフォルト） */
  customLabels: CustomLabels;
  /** ラテン文字用フォント。空文字 = デフォルト（Atkinson Next + Inter 数字） */
  latinFont: LatinFont;
  /** 日本語用フォント。空文字 = デフォルト（OS システムフォント） */
  jpFont: JpFont;
  /** 実験的機能のオン/オフ */
  experimental: ExperimentalSettings;
  /** 使用量ダッシュボードの表示通貨。"usd" | "jpy"。 */
  displayCurrency: LLMRateCurrency;
  /** USD ⇔ JPY 換算レート（1 USD = ¥X）。表示通貨と異なる単位の cost を換算するときに使う。 */
  usdJpyRate: number;
};

const DEFAULT_SETTINGS: Settings = {
  model: "",
  embeddingModel: "",
  chatSynthesisModel: "",
  groundingModel: "",
  disabledTools: [],
  registryUrl: "",
  mcpServers: [],
  savedRegistries: [],
  customLabels: {},
  latinFont: "",
  jpFont: "",
  experimental: {
    atomLayer: false,
    synthesis: false,
    autoGrounding: false,
  },
  displayCurrency: "usd",
  usdJpyRate: 150,
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
  "[結果]": "output",
  "[使用したもの]": "material",
  "[条件]": "attribute",
  // Phase A: 旧内部キー "result" → "output"（Output Entity 意味）
  result: "output",
};

/**
 * localStorage から読んだ mcpServers を正規化する。
 * - stdio / remote の discriminated union に整える
 * - type 欠落の旧フラット形式（{url, transport}）は remote にマイグレーション
 * - 不正なエントリ（command も url も無い等）は捨てる
 */
function normalizeMcpServers(raw: unknown): McpServerEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: McpServerEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const id = typeof s.id === "string" && s.id ? s.id : crypto.randomUUID();
    const enabled = s.enabled !== false;

    // stdio: command が必須
    if (s.type === "stdio") {
      if (typeof s.command !== "string" || !s.command.trim()) continue;
      const args = Array.isArray(s.args) ? s.args.filter((a): a is string => typeof a === "string") : [];
      const env =
        s.env && typeof s.env === "object" && !Array.isArray(s.env)
          ? Object.fromEntries(
              Object.entries(s.env as Record<string, unknown>).filter(
                (e): e is [string, string] => typeof e[1] === "string",
              ),
            )
          : undefined;
      out.push({
        type: "stdio",
        id,
        name: typeof s.name === "string" && s.name.trim() ? s.name : s.command,
        command: s.command,
        args,
        env: env && Object.keys(env).length > 0 ? env : undefined,
        enabled,
      });
      continue;
    }

    // remote（明示 type="remote" or 旧フラット形式）: url が必須
    if (typeof s.url !== "string" || !s.url.trim()) continue;
    const url = s.url;
    const transport: McpTransport =
      s.transport === "streamable-http" || s.transport === "sse" ? s.transport : detectMcpTransport(url);
    let fallbackName = url;
    try {
      fallbackName = new URL(url).host;
    } catch {
      /* URL でなければ url 文字列をそのまま名前に使う */
    }
    out.push({
      type: "remote",
      id,
      name: typeof s.name === "string" && (s.name as string).trim() ? (s.name as string) : fallbackName,
      url,
      transport,
      apiKey: typeof s.apiKey === "string" && s.apiKey ? s.apiKey : undefined,
      enabled,
    });
  }
  return out;
}

/** localStorage から読んだ savedRegistries を正規化する（url 必須・dedup） */
function normalizeSavedRegistries(raw: unknown): SavedRegistry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SavedRegistry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    if (typeof s.url !== "string" || !s.url.trim()) continue;
    const url = s.url.replace(/\/+$/, "");
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({
      id: typeof s.id === "string" && s.id ? s.id : crypto.randomUUID(),
      url,
      apiKey: typeof s.apiKey === "string" && s.apiKey ? s.apiKey : undefined,
    });
  }
  return out;
}

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
    const parsed = JSON.parse(raw) as Partial<Settings> & { font?: string; synthesisModel?: string };
    // 旧 `synthesisModel` を `chatSynthesisModel` に吸収（一回限りのマイグレーション）。
    // 新キーが既に書かれていればそれを優先する。
    const migratedChatSynth =
      typeof parsed.chatSynthesisModel === "string"
        ? parsed.chatSynthesisModel
        : typeof parsed.synthesisModel === "string"
          ? parsed.synthesisModel
          : "";
    // 旧 `font` フィールドを latinFont / jpFont に振り分ける（一回限りのマイグレーション）
    const legacyFont = typeof parsed.font === "string" ? parsed.font : "";
    // 旧 latinFont = "inter" は新デフォルト（""）と等価なので丸める。
    // それ以外で LATIN_FONTS に該当しない値は ""（デフォルト）にフォールバック。
    const rawLatin = parsed.latinFont as string | undefined;
    const migratedLatin: LatinFont = rawLatin !== undefined
      ? (rawLatin === "inter" ? ""
        : (LATIN_FONTS as readonly string[]).includes(rawLatin) ? (rawLatin as LatinFont)
        : "")
      : (legacyFont === "lexend" ? "lexend"
        : legacyFont === "inter" ? ""
        : "");
    const migratedJp: JpFont = parsed.jpFont !== undefined
      ? (JP_FONTS.includes(parsed.jpFont) ? parsed.jpFont : "")
      : (legacyFont === "biz-udp" ? "biz-udp" : "");
    const exp = (parsed as { experimental?: Partial<ExperimentalSettings> }).experimental;
    // 旧来の専用 registryUrl 設定を、記憶レジストリ（savedRegistries）へマイグレーションする。
    // これは接続先ではなく「候補をブラウズする元」。同 URL が無ければ追加し registryUrl は空に倒す。
    const savedRegistries = normalizeSavedRegistries(parsed.savedRegistries);
    const legacyRegistryUrl = typeof parsed.registryUrl === "string" ? parsed.registryUrl.trim().replace(/\/+$/, "") : "";
    if (legacyRegistryUrl && !savedRegistries.some((r) => r.url === legacyRegistryUrl)) {
      savedRegistries.unshift({ id: crypto.randomUUID(), url: legacyRegistryUrl });
    }
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      registryUrl: "", // savedRegistries へ移行済み。専用フィールドは使わない
      customLabels: migrateCustomLabels(parsed.customLabels),
      mcpServers: normalizeMcpServers(parsed.mcpServers),
      savedRegistries,
      latinFont: migratedLatin,
      jpFont: migratedJp,
      chatSynthesisModel: migratedChatSynth,
      experimental: {
        atomLayer: typeof exp?.atomLayer === "boolean" ? exp.atomLayer : false,
        // Synthesis は Atom 依存のため、atomLayer OFF なら強制的に OFF とする
        synthesis: typeof exp?.synthesis === "boolean" && exp?.atomLayer === true ? exp.synthesis : false,
        autoGrounding: typeof exp?.autoGrounding === "boolean" ? exp.autoGrounding : false,
      },
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

/** 無効にしたツール名リストを取得する */
export function getDisabledTools(): string[] {
  return loadSettings().disabledTools;
}

/** Crucible Registry URL を取得する（空文字 = バックエンドのデフォルト） */
export function getRegistryUrl(): string {
  return loadSettings().registryUrl;
}

/** ユーザーが直接登録した MCP サーバー一覧を取得する */
export function getMcpServers(): McpServerEntry[] {
  return loadSettings().mcpServers ?? [];
}

/** AI チャットで接続すべき有効な MCP サーバー一覧を取得する（enabled かつ接続先が有効） */
export function getEnabledMcpServers(): McpServerEntry[] {
  return getMcpServers().filter(
    (s) => s.enabled && (s.type === "stdio" ? s.command.trim() : s.url.trim()),
  );
}

/** 記憶した Crucible Registry 一覧を取得する */
export function getSavedRegistries(): SavedRegistry[] {
  return loadSettings().savedRegistries ?? [];
}

/** コアラベルのカスタム表示名を取得する */
export function getCustomLabels(): CustomLabels {
  return loadSettings().customLabels;
}

/** Embedding 用モデル名を取得する（空文字 = チャットモデルと同じ） */
export function getEmbeddingModel(): string {
  return loadSettings().embeddingModel;
}

/** AI チャット & Synthesis 用モデル名を取得する（空文字 = `model` と同じ） */
export function getChatSynthesisModel(): string {
  return loadSettings().chatSynthesisModel ?? "";
}

/** AI チャット & Synthesis 用の LLMModelConfig を取得する。設定がなければ default にフォールバック */
export function getChatSynthesisLLMModel(): LLMModelConfig | undefined {
  const name = getChatSynthesisModel();
  if (!name) return getDefaultLLMModel();
  const found = getLLMModels().find((m) => m.name === name);
  return found ?? getDefaultLLMModel();
}

/**
 * Chat & Synthesis モデル名（string）を取得する。Tauri モードでは getLLMModels()
 * (localStorage) が空で getChatSynthesisLLMModel() が undefined を返すため、
 * body.model に名前を載せたい用途（Atomize / Synthesize）はこちらを使う。
 * Chat & Synthesis 未設定なら Default モデル名にフォールバックする。
 */
export function getChatSynthesisModelName(): string {
  return getChatSynthesisModel() || getSelectedModel() || "";
}

/** 世界モデル照合用モデル名を取得する（PR 2B v2: Chat & Ideas モデルにエイリアス）。
 *
 * 当初は専用スロット（Settings.groundingModel）を持っていたが、ユーザー指摘
 * 「モデル設定が 4 つも多すぎ」と、独自 chain が想定外モデル（Anthropic）を引いた
 * 不具合（PR 2B 触行中に発覚）を受けて、Chat & Ideas モデルを直接使う方式に変更した。
 * Synthesize / Atomize と同じ経路になるので、設定齟齬が起きない。
 *
 * `Settings.groundingModel` フィールドは将来「専用スロットを再導入したい」場合に
 * 復活できるよう型だけ残してあるが、現状は読まれていない。
 */
export function getGroundingLLMModel(): LLMModelConfig | undefined {
  return getChatSynthesisLLMModel();
}

/** 世界モデル照合モデル名（string）を取得する。`getGroundingLLMModel` と同流儀で
 *  Chat & Ideas モデル名にエイリアスする。 */
export function getGroundingModelName(): string {
  return getChatSynthesisModelName();
}

/** Embedding 用の LLMModelConfig を取得する。
 *  embeddingModel 設定が空の場合は default にフォールバック（embeddings が動かない場合あり）。
 *  Web モードでは `wikiHeaders("embedding")` でこの認証情報をヘッダーに入れる必要がある —
 *  そうしないと resolveModelConfig がデフォルトの chat モデルでヘッダーを上書きしてしまう。
 */
export function getEmbeddingLLMModel(): LLMModelConfig | undefined {
  const embName = getEmbeddingModel();
  if (!embName) return getDefaultLLMModel();
  const found = getLLMModels().find((m) => m.name === embName);
  return found ?? getDefaultLLMModel();
}

/** AI バックエンドが利用可能かどうか（ビルトインバックエンドは常に available） */
export function isAgentConfigured(): boolean {
  return true;
}

/**
 * Atom レイヤ（洞察）が有効かどうか。
 * 2026-05-27 の design revision で experimental から default に昇格したため常に true を返す。
 * 関数自体は呼び出し側互換のため残す（将来 disable する余地も残しておく）。
 */
export function isAtomLayerEnabled(): boolean {
  return true;
}

/**
 * 自動 world-grounding が有効かどうか（opt-in / 既定 OFF）。
 * 反応的に使いたい箇所では loadSettings().experimental.autoGrounding を state に
 * 載せること（既存の experimentalFlags パターン）。これは即時判定用。
 */
export function isAutoGroundingEnabled(): boolean {
  return loadSettings().experimental?.autoGrounding ?? false;
}

/**
 * Synthesis レイヤ（発想）が有効かどうか。
 * 2026-05-27 の design revision で自動生成パイプラインを撤退済み。
 * UI 動線からも非表示化されたため常に false を返す。
 * 既存 synthesis ファイルの物理データは保持され、Cmd-K Composer 経由で再構築する想定。
 */
export function isSynthesisEnabled(): boolean {
  return false;
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

export type LLMRateCurrency = "usd" | "jpy";

/** モデルの 1M トークンあたり単価。AI 使用量ダッシュボードのコスト計算用。 */
export type LLMTokenRate = {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  /** 単価の通貨。未指定なら "usd" 扱い */
  currency?: LLMRateCurrency;
};

export type LLMModelConfig = {
  id: string;
  name: string;
  provider: string;
  modelId: string;
  apiKey: string;
  apiBase: string | null;
  /** トークン単価。未設定ならコスト計算をスキップする。 */
  rate?: LLMTokenRate;
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
