// 公式 MCP Registry（registry.modelcontextprotocol.io）の 1 件を「キーを入れれば繋がる形」に読み替える。
//
// 方針:
// - 扱うのはリモート（streamable-http / sse）で繋ぐものだけ。npm や PyPI のパッケージ
//   （stdio）はパソコンに Node.js や Python が要り、Graphium 同梱の Node には npx が無いので
//   「このパソコンでは動かせない」と見せる（登録はしない）
// - 要る値は remotes[].headers が教えてくれる（isRequired / isSecret / 説明文）。欄はそこから作る
// - URL に {変数} を含むもの（接続ごとに URL を組み立てる型）はまだ扱わない
// - 公開元（名前の / より前）を必ず見せる。レジストリには第三者が作った中継サーバーも
//   混ざるので、キーを渡す前にどこが出しているかを読めるようにする

import type { McpRemoteServer, McpTransport } from "../store";

/** レジストリの入力欄の定義（headers の 1 件） */
export type RegistryInput = {
  name: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  placeholder?: string;
  default?: string;
  value?: string;
};

export type RegistryRemote = { type: string; url: string; headers?: RegistryInput[] };

/** server.json のうち、ここで読むところ */
export type RegistryServer = {
  name: string;
  title?: string;
  description?: string;
  version?: string;
  websiteUrl?: string;
  repository?: { url?: string };
  remotes?: RegistryRemote[];
  packages?: { registryType?: string; identifier?: string }[];
};

/** 接続の画面に出す 1 欄。header はそのまま送るヘッダー名 */
export type ConnectField = {
  header: string;
  description: string;
  required: boolean;
  secret: boolean;
  placeholder?: string;
  /** Authorization なら Bearer を付けて送る（貼った値に Bearer が付いていれば外す） */
  bearer: boolean;
  /** 利用者が触らなくてよい固定値（レジストリが value を決めている欄） */
  fixed?: string;
};

/** 繋ぎ方の分かった 1 件。厳選一覧の項目もこの形にそろえる */
export type ConnectOption = {
  /** サーバーの識別名（レジストリの name、厳選一覧なら id） */
  id: string;
  title: string;
  description: string;
  /** 公開元（例: github.com/tavily-ai、exa.ai） */
  publisher: string;
  /** 登録名の初期値（道具の名前空間になる） */
  serverName: string;
  url: string;
  transport: McpTransport;
  fields: ConnectField[];
  websiteUrl?: string;
  /** 登録時に「実行前に確認しない」で入れる（厳選の読むだけの接続先） */
  skipApproval?: boolean;
};

/** 一覧の 1 行。繋げるもの・このパソコンでは動かせないもの・まだ扱えないもの */
export type RegistryResult =
  | { kind: "remote"; option: ConnectOption }
  | { kind: "needs-local"; id: string; title: string; description: string; publisher: string; websiteUrl?: string }
  | { kind: "unsupported"; id: string; title: string; description: string; publisher: string; websiteUrl?: string };

/**
 * 名前の / より前（逆ドメイン）を読める形にする。
 * - io.github.tavily-ai → github.com/tavily-ai（GitHub で持ち主を確かめた名前）
 * - ai.exa → exa.ai（ドメインで持ち主を確かめた名前）
 */
export function publisherOf(name: string): string {
  const ns = name.split("/")[0] ?? name;
  const parts = ns.split(".");
  if (parts[0] === "io" && parts[1] === "github" && parts.length >= 3) {
    return `github.com/${parts.slice(2).join(".")}`;
  }
  return parts.reverse().join(".");
}

/** 道具の名前空間に使える短い名前（英数字・-・_ だけ） */
export function toServerName(raw: string): string {
  const last = raw.split("/").pop() ?? raw;
  const slug = last
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "mcp";
}

function toTransport(type: string): McpTransport | null {
  if (type === "streamable-http" || type === "http") return "streamable-http";
  if (type === "sse") return "sse";
  return null;
}

function toField(h: RegistryInput): ConnectField {
  return {
    header: h.name,
    description: h.description ?? "",
    required: h.isRequired === true,
    secret: h.isSecret === true,
    placeholder: h.placeholder,
    bearer: h.name.toLowerCase() === "authorization",
    fixed: typeof h.value === "string" && !h.value.includes("{") ? h.value : undefined,
  };
}

/** API が返した 1 件（{ server, _meta }）を読み替える。形が崩れていれば null */
export function toRegistryResult(raw: unknown): RegistryResult | null {
  const wrapped = raw && typeof raw === "object" ? (raw as { server?: unknown }).server ?? raw : null;
  if (!wrapped || typeof wrapped !== "object") return null;
  const s = wrapped as RegistryServer;
  if (typeof s.name !== "string" || !s.name) return null;

  const base = {
    id: s.name,
    title: s.title?.trim() || toServerName(s.name),
    description: s.description?.trim() ?? "",
    publisher: publisherOf(s.name),
    websiteUrl: s.websiteUrl ?? s.repository?.url,
  };

  const remotes = (s.remotes ?? []).filter((r) => r && typeof r.url === "string" && toTransport(r.type));
  // Streamable HTTP を先に（SSE は古い方式）
  remotes.sort((a, b) => (toTransport(a.type) === "streamable-http" ? 0 : 1) - (toTransport(b.type) === "streamable-http" ? 0 : 1));
  const usable = remotes.find((r) => !r.url.includes("{"));
  if (usable) {
    return {
      kind: "remote",
      option: {
        ...base,
        serverName: toServerName(s.name),
        url: usable.url,
        transport: toTransport(usable.type)!,
        fields: (usable.headers ?? []).filter((h) => typeof h?.name === "string" && h.name).map(toField),
      },
    };
  }
  if (remotes.length > 0) return { kind: "unsupported", ...base };
  if ((s.packages ?? []).length > 0) return { kind: "needs-local", ...base };
  return { kind: "unsupported", ...base };
}

/**
 * 名前が語とどれだけ合うか（小さいほど上）。レジストリの検索は部分一致なので、
 * 「exa」で「apexai」のようなものが先に来る。名前・題がそのものか、語で始まるものを先にする
 */
function matchRank(r: RegistryResult, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const head = r.kind === "remote" ? r.option : r;
  const names = [head.title.toLowerCase(), toServerName(head.id)];
  if (names.some((n) => n === q)) return 0;
  if (names.some((n) => n.startsWith(q))) return 1;
  return 2;
}

/**
 * 一覧に出す順: 繋げるもの → このパソコンでは動かせないもの → まだ扱えないもの。
 * それぞれの中は名前が語に合うものを先に、あとは届いた順
 */
export function toRegistryResults(raws: readonly unknown[], query = ""): RegistryResult[] {
  const rank = { remote: 0, "needs-local": 1, unsupported: 2 } as const;
  const seen = new Set<string>();
  const out: RegistryResult[] = [];
  for (const raw of raws) {
    const r = toRegistryResult(raw);
    if (!r) continue;
    const id = r.kind === "remote" ? r.option.id : r.id;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(r);
  }
  return out
    .map((r, i) => ({ r, i, m: matchRank(r, query) }))
    .sort((a, b) => rank[a.r.kind] - rank[b.r.kind] || a.m - b.m || a.i - b.i)
    .map(({ r }) => r);
}

/** 必須の欄が埋まっているか（固定値の欄は埋まっているとみなす） */
export function hasRequiredValues(option: ConnectOption, values: Record<string, string>): boolean {
  return option.fields.every((f) => !f.required || f.fixed !== undefined || (values[f.header] ?? "").trim() !== "");
}

/** 入れた値から登録する 1 件を作る。空の欄は送らない */
export function buildRemoteEntry(
  option: ConnectOption,
  values: Record<string, string>,
  id: string,
  serverName: string = option.serverName,
): McpRemoteServer {
  let apiKey: string | undefined;
  const headers: Record<string, string> = {};
  for (const f of option.fields) {
    const v = (f.fixed ?? values[f.header] ?? "").trim();
    if (!v) continue;
    // Bearer 以外の方式（Basic など）を貼られたら、そのまま Authorization に入れる
    if (f.bearer && !/^(basic|token|digest)\s/i.test(v)) apiKey = v.replace(/^Bearer\s+/i, "");
    else headers[f.header] = v;
  }
  return {
    type: "remote",
    id,
    name: serverName,
    url: option.url,
    transport: option.transport,
    ...(apiKey ? { apiKey } : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    enabled: true,
    ...(option.skipApproval ? { skipApproval: true } : {}),
  };
}
