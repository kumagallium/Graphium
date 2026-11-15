// MCP の資料取得（get_source_text・手順の課題）が Web ページを取りに行くときの宛先の検査。
//
// MCP は外部の AI が宛先（登録済みの URL）を選ぶので、アプリの Reader と違って
// ループバック・LAN（プライベート）・リンクローカル（クラウドのメタデータ 169.254.169.254 など）宛は取りに行かない。
// 登録済みの URL がリダイレクトで内側へ飛ぶ場合に備え、リダイレクトは 1 段ずつ追って毎回検査する。
// 解決後の IP も見る（ホスト名が内側の IP に解決される DNS でも止まる）。

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 15_000;

type LookupFn = (host: string) => Promise<{ address: string }[]>;

const defaultLookup: LookupFn = (host) => dnsLookup(host, { all: true });

/** IPv4（ドット表記）が外へ出してはいけない範囲か */
function isBlockedIPv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127) return true; // 0.0.0.0/8・プライベート・ループバック
  if (a === 169 && b === 254) return true; // リンクローカル（メタデータ）
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0 && p[2] === 0) return true; // 192.0.0.0/24
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15（ベンチマーク）
  if (a >= 224) return true; // マルチキャスト・予約
  return false;
}

/** IP（v4 / v6）が外へ出してはいけない範囲か */
export function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isBlockedIPv4(ip);
  if (kind !== 6) return true;
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  // 8 つの 16 ビット群に展開して、IPv4 を埋め込む形（射影・互換・NAT64・6to4・SIIT）は中の v4 で判定する
  const groups = expandIPv6(lower);
  if (!groups) return true;
  const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  const zeros = (n: number) => groups.slice(0, n).every((g) => g === 0);
  if (zeros(5) && g5 === 0xffff) return isBlockedIPv4(v4(g6, g7)); // ::ffff:a.b.c.d（IPv4 射影）
  if (zeros(6)) return isBlockedIPv4(v4(g6, g7)); // ::a.b.c.d（IPv4 互換）
  if (zeros(4) && g4 === 0xffff && g5 === 0) return isBlockedIPv4(v4(g6, g7)); // ::ffff:0:a.b.c.d（SIIT）
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return isBlockedIPv4(v4(g6, g7)); // 64:ff9b::/96（NAT64）
  if (g0 === 0x2002) return isBlockedIPv4(v4(g1, g2)); // 2002::/16（6to4。埋め込みは g1:g2）
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7（ユニークローカル）
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10（リンクローカル）
  if ((g0 & 0xffc0) === 0xfec0) return true; // fec0::/10（サイトローカル）
  return false;
}

/** IPv6 文字列を 8 つの 16 ビット群に展開する（不正なら null）。ドット表記の末尾 v4 も受ける */
function expandIPv6(ip: string): number[] | null {
  let s = ip.split("%")[0];
  const dotted = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const o = dotted[2].split(".").map(Number);
    if (o.some((n) => n > 255)) return null;
    s = `${dotted[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const all = [...head, ...Array(fill).fill("0"), ...tail].map((h) => parseInt(h, 16));
  return all.length === 8 && all.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? all : null;
}

/** 取りに行ってよい宛先か確かめる。だめなら Error。許すときは何も返さない */
export async function assertPublicUrl(rawUrl: string, lookup: LookupFn = defaultLookup): Promise<void> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error("URL が正しくありません");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("http / https 以外の URL は取得しません");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost")) {
    throw new Error("この PC 内・社内ネットワークの宛先は、MCP からは取得しません");
  }
  if (isIP(host)) {
    if (isBlockedIp(host)) throw new Error("この PC 内・社内ネットワークの宛先は、MCP からは取得しません");
    return;
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host);
  } catch {
    throw new Error("宛先を解決できませんでした");
  }
  if (addrs.length === 0 || addrs.some((a) => isBlockedIp(a.address))) {
    throw new Error("この PC 内・社内ネットワークの宛先は、MCP からは取得しません");
  }
}

/**
 * 登録済みの Web ページを取り、本文テキストを返す。宛先は毎回（リダイレクト先も）検査する。
 * 本文の抽出は Reader と同じ（Readability）
 */
export async function fetchPublicUrlText(
  url: string,
  deps: { fetchFn?: typeof fetch; lookup?: LookupFn } = {},
): Promise<{ title: string; text: string }> {
  const { html, finalUrl } = await fetchPublicUrlHtml(url, deps);
  const { extractReaderFromHtml } = await import("../server/services/url-reader");
  const article = extractReaderFromHtml(html, finalUrl);
  return { title: article.title, text: article.textContent };
}

/** 登録済みの Web ページの HTML を取る。宛先は毎回（リダイレクト先も）検査する */
export async function fetchPublicUrlHtml(
  url: string,
  deps: { fetchFn?: typeof fetch; lookup?: LookupFn } = {},
): Promise<{ html: string; finalUrl: string }> {
  const fetchFn = deps.fetchFn ?? fetch;
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(current, deps.lookup);
    const res = await fetchFn(current, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error(`Fetch failed: ${res.status}`);
      current = new URL(location, current).toString();
      continue;
    }
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    if ((res.headers.get("content-type") ?? "").includes("application/pdf")) {
      throw new Error("PDF の URL は読めません");
    }
    return { html: await res.text(), finalUrl: current };
  }
  throw new Error("リダイレクトが多すぎます");
}
