// 最近のノート履歴を localStorage で管理するストア

import { t } from "../../i18n";

export type RecentNote = {
  noteId: string;
  title: string;
  lastAccessedAt: string; // ISO 8601
};

const STORAGE_KEY = "graphium-recent-notes";
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

// 相対時間表示（ロケールに応じて「2h前」「yesterday」等を返す）
export function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return t("time.justNow");
  if (minutes < 60) return t("time.minutesAgo", { n: String(minutes) });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("time.hoursAgo", { n: String(hours) });
  const days = Math.floor(hours / 24);
  if (days === 1) return t("time.yesterday");
  if (days < 7) return t("time.daysAgo", { n: String(days) });
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return t("time.weeksAgo", { n: String(weeks) });
  const months = Math.floor(days / 30);
  return t("time.monthsAgo", { n: String(months) });
}
