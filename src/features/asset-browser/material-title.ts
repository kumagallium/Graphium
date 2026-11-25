// 素材の「題」を読む（「タイトルで名前を変更」の 1 件ずつ・まとめての両方が使う）
//
//   - ファイルのある素材（PDF / Word / PowerPoint / Excel）: 実体を読んで、文書の中の題を取り出す
//   - URL: sidecar の /url/reader でページを取り直し、その題を使う
//
// URL の題は、登録時にはブラウザから直接ページを読みに行く（fetchUrlMetadata）。CORS で
// 断られるサイトではドメイン名が名前になるので、あとから付け直す道がここ。/url/reader は
// URL のピークで本文を出すときと同じ経路で（同じ信頼レベル・サーバ側でキャッシュ済み）、
// 新しく外へ出る道は増やさない。
//
// 見つからないときは undefined、読めなかったときは例外（呼び出し側が「読めなかった」を出す）。

import { apiBase } from "../../lib/platform";
import { extractDocumentTitle, finalizeTitle } from "./document-info";
import type { MediaIndexEntry } from "./media-index";
import { readEntryBytes } from "./read-entry-bytes";

export async function readMaterialTitle(entry: MediaIndexEntry): Promise<string | undefined> {
  if (entry.type === "url") return readUrlPageTitle(entry.url);
  const bytes = await readEntryBytes(entry);
  return extractDocumentTitle(bytes, entry);
}

/** ページの題を /url/reader から読む */
export async function readUrlPageTitle(url: string): Promise<string | undefined> {
  if (!/^https?:\/\//i.test(url)) return undefined;
  const res = await fetch(`${apiBase()}/url/reader`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  // 422 = 本文を読み取れなかった（題も無い）
  if (res.status === 422) return undefined;
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const payload = (await res.json().catch(() => null)) as { kind?: string; title?: unknown } | null;
  // URL の先が PDF のときは題を返さない（本文を読んでいないので）
  if (!payload || payload.kind === "pdf") return undefined;
  return finalizeTitle(typeof payload.title === "string" ? payload.title : undefined);
}
