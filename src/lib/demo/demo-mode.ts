// 見本モード（demo）— URL の `?demo=<id>` で入る、読み込み済みの見本データを眺めるための起動形。
//
// - 本人のノート（IndexedDB `graphium-local` / サーバー保存）とは別の IndexedDB に読み込む。
//   本人のデータは一切触らない。見本の中で書いても、見本の DB にしか残らない
// - AI の接続は要らない。トピック・知見・洞察は束（bundle）に事前生成したものが入っている
// - DOM / localStorage に依存しない純関数だけをここに置く（テストと設定ストアから共有する）

/** 用意している見本の id。URL の値はこの一覧に無ければ見本モードにしない（任意の文字列で DB を作らない） */
export const DEMO_IDS = ["bread-ja", "bread-en"] as const;
export type DemoId = (typeof DEMO_IDS)[number];

export function isDemoId(v: string | null | undefined): v is DemoId {
  return typeof v === "string" && (DEMO_IDS as readonly string[]).includes(v);
}

/** `location.search` から見本の id を取り出す。無い・一覧に無いときは null */
export function parseDemoId(search: string): DemoId | null {
  if (!search) return null;
  const v = new URLSearchParams(search.startsWith("?") ? search : `?${search}`).get("demo");
  return isDemoId(v) ? v : null;
}

/** 見本の id ごとの IndexedDB 名。本人用の `graphium-local` と衝突しない接頭辞 */
export function demoDbName(id: DemoId): string {
  return `graphium-demo-${id}`;
}

/** 束の配信 URL。`base` は vite の `import.meta.env.BASE_URL`（`/Graphium/` や `/`） */
export function demoBundleUrl(base: string, id: DemoId): string {
  const b = base.endsWith("/") ? base : `${base}/`;
  return `${b}demo/${id}.json`;
}

/** 見本から戻る先（本人のアプリ）。`?demo=` を外した同じページ */
export function demoExitUrl(pathname: string): string {
  return pathname;
}

let cached: DemoId | null | undefined;

/** いまの画面が見本モードか。起動中に変わらないので 1 度だけ読む */
export function getDemoId(): DemoId | null {
  if (cached !== undefined) return cached;
  if (typeof location === "undefined") {
    cached = null;
  } else {
    cached = parseDemoId(location.search);
  }
  return cached;
}

export function isDemoMode(): boolean {
  return getDemoId() !== null;
}

/** テスト用: 判定のキャッシュを捨てる */
export function resetDemoModeCacheForTest(): void {
  cached = undefined;
}
