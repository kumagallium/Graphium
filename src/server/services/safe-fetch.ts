// サーバーが利用者・記事・同期されたデータの指定で外部 URL を取りに行くときの宛先検査。
//
// 方針は 2 段（policy）:
//   - "strict"        : ループバック・プライベート・リンクローカル・メタデータを止める。
//                       記事の本文などが自動で叩く口（image-proxy）に使う
//   - "metadata-only" : リンクローカル（169.254.0.0/16・fe80::/10）とクラウドのメタデータだけ止める。
//                       利用者が自分で指定する URL（PDF など）に使う。LAN の文書を読む正当な使い方があるので
//                       LAN は止めない
// どちらも、リダイレクトは自動で辿らず 1 段ずつ（最大 5 回）、要求を送る前に宛先を検査する。
// ホスト名は DNS で解決した全アドレスも見る。ただし検査した後に接続先が別の IP に変わる
// （DNS リバインディング）ことまでは防げない —— それにはソケット単位の検査が要る。

import { lookup } from "node:dns/promises";

export type TargetPolicy = "strict" | "metadata-only";

const METADATA_HOSTS = new Set(["metadata.google.internal", "metadata.goog"]);

/** URL の hostname を判定用に整える（小文字・末尾ドット除去） */
function normalizeHost(hostname: string): string {
  let h = hostname.toLowerCase();
  while (h.endsWith(".")) h = h.slice(0, -1);
  return h;
}

function parseIpv4(host: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const o = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] as [number, number, number, number];
  if (o.some((x) => x > 255)) return null; // IP リテラルとして不正 → ホスト名扱い
  return o;
}

function isLinkLocalOrMetadataIpv4(o: [number, number, number, number]): boolean {
  return o[0] === 169 && o[1] === 254;
}

function isPrivateIpv4Octets(o: [number, number, number, number]): boolean {
  const [a, b] = o;
  return (
    a === 0 || // 0.0.0.0/8 ("this network")
    a === 10 ||
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local（169.254.169.254 = クラウドのメタデータ）
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224 // multicast / reserved / 255.255.255.255
  );
}

/** IPv6 内に埋め込まれた IPv4（::ffff:a.b.c.d / ::a.b.c.d / hex 2 グループ）を取り出す */
function embeddedIpv4(h: string): [number, number, number, number] | null {
  const dotted = /^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
  if (dotted) return parseIpv4(dotted[1]);
  const hex = /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
  }
  return null;
}

/** IP アドレス（IPv6 は角括弧の有無どちらでも）が policy で止める宛先か */
export function isBlockedAddress(address: string, policy: TargetPolicy): boolean {
  const h = normalizeHost(address).replace(/^\[|\]$/g, "");
  const v4 = parseIpv4(h);
  if (v4) return policy === "strict" ? isPrivateIpv4Octets(v4) : isLinkLocalOrMetadataIpv4(v4);
  if (!h.includes(":")) return false;
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true; // link-local fe80::/10
  if (h.startsWith("fd00:ec2:")) return true; // AWS の IPv6 メタデータ
  const emb = embeddedIpv4(h);
  if (emb) return policy === "strict" ? isPrivateIpv4Octets(emb) : isLinkLocalOrMetadataIpv4(emb);
  if (policy === "strict") {
    if (h === "::1" || h === "::") return true;
    if (/^f[cd][0-9a-f]{2}:/.test(h)) return true; // ULA fc00::/7
  }
  return false;
}

/** URL の字面（hostname）だけで見る判定。DNS は引かない */
export function isBlockedUrl(rawUrl: string, policy: TargetPolicy): boolean {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return true;
  }
  const host = normalizeHost(u.hostname);
  if (METADATA_HOSTS.has(host)) return true;
  if (policy === "strict" && (host === "localhost" || host.endsWith(".localhost"))) return true;
  return isBlockedAddress(host, policy);
}

type Resolver = (hostname: string) => Promise<string[]>;

const LOOKUP_TIMEOUT_MS = 3000;

const defaultResolver: Resolver = async (hostname) => {
  const result = await Promise.race([
    lookup(hostname, { all: true }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("lookup timeout")), LOOKUP_TIMEOUT_MS).unref()),
  ]);
  return result.map((r) => r.address);
};

let resolver: Resolver = defaultResolver;

/** テスト用: 名前解決を差し替える（引数なしで既定に戻す） */
export function setHostResolverForTest(fn?: Resolver): void {
  resolver = fn ?? defaultResolver;
}

/** 字面に加えて、DNS で解決した全アドレスも見る。解決できないホストは（接続も失敗するので）通す */
export async function isBlockedAfterResolve(rawUrl: string, policy: TargetPolicy): Promise<boolean> {
  if (isBlockedUrl(rawUrl, policy)) return true;
  let host: string;
  try {
    host = normalizeHost(new URL(rawUrl).hostname);
  } catch {
    return true;
  }
  if (parseIpv4(host) || host.includes(":") || host.startsWith("[")) return false; // IP リテラルは字面で判定済み
  try {
    const addresses = await resolver(host);
    return addresses.some((a) => isBlockedAddress(a, policy));
  } catch {
    return false;
  }
}

export class BlockedTargetError extends Error {
  constructor() {
    super("This host is not allowed");
    this.name = "BlockedTargetError";
  }
}

const MAX_REDIRECTS = 5;

/**
 * リダイレクトを自動で辿らず、1 段ずつ宛先を検査してから要求を送る fetch。
 * 止めた宛先なら BlockedTargetError。リダイレクトが多すぎれば通常の Error。
 */
export async function guardedFetch(
  rawUrl: string,
  init: RequestInit,
  policy: TargetPolicy,
): Promise<Response> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (await isBlockedAfterResolve(current, policy)) throw new BlockedTargetError();
    const res = await fetch(current, { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res;
      void res.body?.cancel();
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new Error("Invalid redirect");
      }
      if (next.protocol !== "http:" && next.protocol !== "https:") throw new BlockedTargetError();
      current = next.href;
      continue;
    }
    // 実装によっては最終 URL が入る。想定外の宛先に変わっていたら捨てる
    if (res.url && res.url !== current && isBlockedUrl(res.url, policy)) {
      void res.body?.cancel();
      throw new BlockedTargetError();
    }
    return res;
  }
  throw new Error("Too many redirects");
}
