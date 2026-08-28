// 見出しの折りたたみ状態の保存先。
//
// 折りたたみは「表示の都合」であってノートの中身ではないので、ノート JSON には
// 一切書かない（旧トグル見出しの isToggleable と違う点）。端末ローカルにだけ残す。
// ブロック id は UUID なのでノートをまたいでも衝突しない。1 キーにまとめて持つ。
//
// 消えたブロックの id が残り続けるのを防ぐため、件数に上限を置いて古いものから捨てる。
// 折りたたんだまま放置する見出しが数百に達することは実用上ないので、
// あふれた＝もう使っていない、とみなしてよい。

const STORAGE_KEY = "graphium.collapsedHeadings";
const MAX_ENTRIES = 1000;

function safeLocalStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    // Safari のプライベートモード等でアクセス自体が throw することがある
    return null;
  }
}

/** 保存済みの「畳んでいる見出し id」を読む。壊れていれば空で始める。 */
export function loadCollapsedIds(): string[] {
  const store = safeLocalStorage();
  if (!store) return [];
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

/**
 * 畳んでいる見出し id を保存する。
 * 追加順の末尾が新しい。上限を超えたら先頭（古いもの）から捨てる。
 */
export function saveCollapsedIds(ids: readonly string[]): void {
  const store = safeLocalStorage();
  if (!store) return;
  try {
    const trimmed = ids.length > MAX_ENTRIES ? ids.slice(ids.length - MAX_ENTRIES) : ids;
    store.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // 容量オーバー等。折りたたみ状態が残らないだけなので、編集は続行させる
  }
}

export const COLLAPSED_STORAGE_KEY = STORAGE_KEY;
export const COLLAPSED_MAX_ENTRIES = MAX_ENTRIES;
