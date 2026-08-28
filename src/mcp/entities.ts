// インラインラベル（material / tool / attribute / output）をノート横断で集約する。
//
// 実データでの確認（2026-08-27, 506 エントリ）:
//   - text 単位では 181 種、うち 49 種が複数ノートに跨る
//   - entityId 単位では 327 種、うち 56 種が複数ノートに跨る
// 同じ語（例 "99.99%"）が別々の entityId を持つことがあるため、**横断の主キーは
// 正規化した text**、entityId は補助にする。entityId だけで引くと取りこぼす。

import type { NoteIndexEntry } from "../features/navigation/index-file";
import { allEntries } from "./search";
import { resolveGraphiumRoot } from "./vault";

export type EntityLabel = "material" | "tool" | "attribute" | "output";

export const ENTITY_LABELS: EntityLabel[] = ["material", "tool", "attribute", "output"];

/** 横断照合用のキー。表示は原文のまま返す */
export function normalizeEntityText(text: string): string {
  return text.normalize("NFKC").trim().toLowerCase();
}

export type EntityOccurrence = {
  noteId: string;
  title: string;
  blockIds: string[];
  entityIds: string[];
};

export type EntityGroup = {
  label: EntityLabel;
  /** 代表表記（最初に見つかった原文） */
  text: string;
  noteCount: number;
  occurrenceCount: number;
  notes: EntityOccurrence[];
};

type Bucket = {
  label: EntityLabel;
  text: string;
  byNote: Map<string, { title: string; blockIds: Set<string>; entityIds: Set<string> }>;
  occurrences: number;
};

function collect(entries: NoteIndexEntry[]): Map<string, Bucket> {
  const buckets = new Map<string, Bucket>();
  for (const entry of entries) {
    for (const il of entry.inlineLabels ?? []) {
      const text = (il.text ?? "").trim();
      if (!text) continue;
      const key = `${il.label}|${normalizeEntityText(text)}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { label: il.label, text, byNote: new Map(), occurrences: 0 };
        buckets.set(key, bucket);
      }
      bucket.occurrences += 1;
      let note = bucket.byNote.get(entry.noteId);
      if (!note) {
        note = { title: entry.title, blockIds: new Set(), entityIds: new Set() };
        bucket.byNote.set(entry.noteId, note);
      }
      note.blockIds.add(il.blockId);
      note.entityIds.add(il.entityId);
    }
  }
  return buckets;
}

function toGroup(bucket: Bucket): EntityGroup {
  return {
    label: bucket.label,
    text: bucket.text,
    noteCount: bucket.byNote.size,
    occurrenceCount: bucket.occurrences,
    notes: Array.from(bucket.byNote.entries()).map(([noteId, v]) => ({
      noteId,
      title: v.title,
      blockIds: Array.from(v.blockIds),
      entityIds: Array.from(v.entityIds),
    })),
  };
}

export type ListEntitiesOptions = {
  label?: EntityLabel;
  /** 何ノート以上に出てくるものに絞るか（既定 1 = 全部） */
  minNotes?: number;
  limit?: number;
};

/** vault 全体のラベル一覧を、横断件数の多い順に返す */
export function listEntities(
  options: ListEntitiesOptions = {},
  root = resolveGraphiumRoot(),
): EntityGroup[] {
  const { label, minNotes = 1, limit = 100 } = options;
  const buckets = collect(allEntries(root));

  return Array.from(buckets.values())
    .filter((b) => (!label || b.label === label) && b.byNote.size >= minNotes)
    .map(toGroup)
    .sort((a, b) => b.noteCount - a.noteCount || b.occurrenceCount - a.occurrenceCount)
    .slice(0, limit);
}

export type FindNotesUsingQuery = {
  /** 材料名・道具名など。正規化して照合する（部分一致も許す） */
  text?: string;
  /** PROV Entity の同一性キー。text より狭いが厳密 */
  entityId?: string;
  label?: EntityLabel;
  /** text の部分一致を許すか（既定 true）。false なら完全一致のみ */
  partial?: boolean;
};

/** 指定した材料・道具・条件・出力を使っているノートを横断で探す */
export function findNotesUsing(
  query: FindNotesUsingQuery,
  root = resolveGraphiumRoot(),
): EntityGroup[] {
  const { text, entityId, label, partial = true } = query;
  if (!text && !entityId) return [];

  const needle = text ? normalizeEntityText(text) : null;
  const buckets = collect(allEntries(root));
  const out: EntityGroup[] = [];

  for (const bucket of buckets.values()) {
    if (label && bucket.label !== label) continue;

    if (entityId) {
      const hit = Array.from(bucket.byNote.values()).some((n) => n.entityIds.has(entityId));
      if (hit) {
        out.push(toGroup(bucket));
        continue;
      }
    }

    if (needle) {
      const key = normalizeEntityText(bucket.text);
      const matched = partial ? key.includes(needle) || needle.includes(key) : key === needle;
      if (matched) out.push(toGroup(bucket));
    }
  }

  return out.sort((a, b) => b.noteCount - a.noteCount);
}
