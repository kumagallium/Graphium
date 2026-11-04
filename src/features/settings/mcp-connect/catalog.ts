// 厳選の接続先（外部ツールの MCP サーバー）。事実だけを持つ。表示は McpConnectView
//
// 方針:
// - データの置き場は catalog.json の 1 か所だけ
// - 載せるのは Graphium が URL と認証の方式を確かめたものだけ。公式レジストリに
//   リモート URL が載っていないもの（Tavily は npm パッケージだけが載っている）も、ここなら
//   キーを貼るだけで繋がる形で出せる
// - 公式レジストリの結果と同じ ConnectOption にそろえ、キーの画面は 1 つで済ませる

import type { McpTransport } from "../store";
import type { ConnectOption } from "./registry";
import data from "./catalog.json";

export type CuratedText = { what: string; free: string };

export type CuratedServer = {
  id: string;
  name: string;
  /** 登録名（道具の名前空間） */
  serverName: string;
  /** 公開元（画面に出す） */
  publisher: string;
  url: string;
  transport: McpTransport;
  /** 貼ってもらうキー。header が Authorization なら Bearer で送る */
  key: { header: string; placeholder?: string };
  /** キーを作るページ */
  signupUrl: string;
  /**
   * キーを確かめる URL（任意）。握手はキーが違っても通る接続先があるので（Tavily は
   * 検索を呼んだときに初めて断る）、登録前にここへ Bearer で GET して 401/403 なら止める。
   * クレジットを使わず、ブラウザから呼べる（CORS を返す）ものに限る
   */
  keyCheckUrl?: string;
  /**
   * 道具がどれも読むだけ（検索など）と確かめた接続先。登録時に「実行前に確認しない」で入れる。
   * Tavily は道具に readOnlyHint を付けていないので、これが無いと検索のたびに確認が出る
   */
  readOnly?: boolean;
  /** 最後に確かめた日（YYYY-MM-DD） */
  checkedAt: string;
  text: { en: CuratedText; ja: CuratedText };
};

export const CURATED_SERVERS: readonly CuratedServer[] = data.servers as CuratedServer[];

/** 画面の言語に合う説明 */
export function curatedText(server: CuratedServer, locale: string): CuratedText {
  return locale === "ja" ? server.text.ja : server.text.en;
}

/** キーの画面に渡す形にする */
export function curatedToOption(server: CuratedServer, locale: string): ConnectOption {
  return {
    id: server.id,
    title: server.name,
    description: curatedText(server, locale).what,
    publisher: server.publisher,
    serverName: server.serverName,
    url: server.url,
    transport: server.transport,
    fields: [
      {
        header: server.key.header,
        description: "",
        required: true,
        secret: true,
        placeholder: server.key.placeholder,
        bearer: server.key.header.toLowerCase() === "authorization",
      },
    ],
    websiteUrl: server.signupUrl,
    ...(server.readOnly ? { skipApproval: true } : {}),
  };
}

/** キーを確かめた結果。unknown は確かめられなかった（ネットワークなど）ので、握手に進む */
export type KeyCheckResult = "ok" | "invalid" | "unknown";

export async function checkCuratedKey(
  keyCheckUrl: string,
  key: string,
  fetchFn: typeof fetch = fetch,
): Promise<KeyCheckResult> {
  try {
    const res = await fetchFn(keyCheckUrl, {
      headers: { Authorization: `Bearer ${key.trim().replace(/^Bearer\s+/i, "")}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401 || res.status === 403) return "invalid";
    return res.ok ? "ok" : "unknown";
  } catch {
    return "unknown";
  }
}
