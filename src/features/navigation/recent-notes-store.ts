// 最近のノート履歴を localStorage で管理するストア

export type RecentNote = {
  noteId: string;
  title: string;
  lastAccessedAt: string; // ISO 8601
};

const STORAGE_KEY = "provnote-recent-notes";
const MAX_ENTRIES = 5;

// localStorage から読み込み
export function getRecentNotes(): RecentNote[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

// ノートを先頭に追加（既存エントリは削除して再挿入）
export function addToRecent(noteId: string, title: string): RecentNote[] {
  const recent = getRecentNotes().filter((n) => n.noteId !== noteId);
  recent.unshift({
    noteId,
    title,
    lastAccessedAt: new Date().toISOString(),
  });
  const trimmed = recent.slice(0, MAX_ENTRIES);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  return trimmed;
}

// 削除されたノートを履歴から除去
export function removeFromRecent(noteId: string): RecentNote[] {
  const recent = getRecentNotes().filter((n) => n.noteId !== noteId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(recent));
  return recent;
}

// 相対時間表示（「2h前」「昨日」「3日前」等）
export function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "たった今";
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h前`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "昨日";
  if (days < 7) return `${days}日前`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}週前`;
  const months = Math.floor(days / 30);
  return `${months}ヶ月前`;
}
