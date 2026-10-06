// note-index.json の読み書き（MCP 側）。
// 仕様: docs/internal/mcp-upkeep-stage3-spec-2026-10.md §3.1（index-store.ts）
// version と他のエントリは触らない。wiki ページについて意味を持つのはフラグ（deletedAt / archivedAt）だけ。

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { GraphiumDocument } from "../../lib/document-types";
import { buildIndexEntry, type GraphiumIndex, type NoteIndexEntry } from "../../features/navigation/index-file";
import { writeFileAtomic } from "./atomic-write";
import { appDataDir, readNote } from "../vault";

export type IndexReadResult =
  | { ok: true; index: GraphiumIndex }
  | { ok: false; code: "NO_INDEX" | "INDEX_UNREADABLE" };

export type IndexFlag = "deletedAt" | "archivedAt";

const indexPath = (root: string) => join(appDataDir(root), "note-index.json");

/** 索引を厳密に読む。無い／読めない／形が違うときは理由を返す（書き換え系はこれで断る） */
export function readIndexStrict(root: string): IndexReadResult {
  const path = indexPath(root);
  if (!existsSync(path)) return { ok: false, code: "NO_INDEX" };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as GraphiumIndex;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.notes)) {
      return { ok: false, code: "INDEX_UNREADABLE" };
    }
    return { ok: true, index: parsed };
  } catch {
    return { ok: false, code: "INDEX_UNREADABLE" };
  }
}

/** 索引を書く。version と他のエントリは触らず、updatedAt だけ今の時刻にする */
export async function writeIndex(root: string, index: GraphiumIndex): Promise<void> {
  await writeFileAtomic(
    indexPath(root),
    JSON.stringify({ ...index, updatedAt: new Date().toISOString() }),
  );
}

function readOrThrow(root: string): GraphiumIndex {
  const r = readIndexStrict(root);
  if (!r.ok) throw new Error(`${r.code}: note-index.json を読めません`);
  return r.index;
}

/** 索引のフラグ。エントリが無い（索引が読めない場合も）ときは null */
export function getFlags(
  root: string,
  id: string,
): { deletedAt: string | null; archivedAt: string | null } | null {
  const r = readIndexStrict(root);
  if (!r.ok) return null;
  const e = r.index.notes.find((n) => n.noteId === id);
  if (!e) return null;
  return { deletedAt: e.deletedAt ?? null, archivedAt: e.archivedAt ?? null };
}

/** 既存エントリを差し替えて返す（無ければ末尾に挿入）。フラグは既存のものを保つ */
function withEntry(index: GraphiumIndex, entry: NoteIndexEntry): GraphiumIndex {
  const i = index.notes.findIndex((n) => n.noteId === entry.noteId);
  if (i < 0) return { ...index, notes: [...index.notes, entry] };
  const old = index.notes[i];
  const merged: NoteIndexEntry = { ...entry };
  if (old.deletedAt) merged.deletedAt = old.deletedAt;
  if (old.archivedAt) merged.archivedAt = old.archivedAt;
  const notes = index.notes.slice();
  notes[i] = merged;
  return { ...index, notes };
}

/** ページの本文を書いたあとに、そのエントリだけを作り直す（既存のフラグは保つ） */
export async function upsertEntry(root: string, id: string, doc: GraphiumDocument): Promise<void> {
  const index = readOrThrow(root);
  await writeIndex(root, withEntry(index, buildIndexEntry(id, doc)));
}

/**
 * フラグを立てる／外す。エントリが無ければ readNote から作って挿入してから値を入れる
 * （エントリの無いページのフラグはアプリの起動時に引き継がれないため）。書いたあとに読み直して確かめる
 */
export async function setFlag(
  root: string,
  id: string,
  flag: IndexFlag,
  value: string | null,
): Promise<void> {
  let index = readOrThrow(root);
  if (!index.notes.some((n) => n.noteId === id)) {
    const doc = readNote(id, root);
    if (!doc) throw new Error(`NOT_FOUND: ページを読めません: ${id}`);
    index = withEntry(index, buildIndexEntry(id, doc));
  }
  const notes = index.notes.map((n) => {
    if (n.noteId !== id) return n;
    const next: NoteIndexEntry = { ...n };
    if (value === null) delete next[flag];
    else next[flag] = value;
    return next;
  });
  await writeIndex(root, { ...index, notes });
  const after = getFlags(root, id)?.[flag] ?? null;
  if (after !== value) throw new Error(`フラグを書けませんでした: ${id} ${flag}`);
}
