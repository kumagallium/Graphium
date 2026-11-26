// チャットの修正案の反映・やめる・元に戻す（アプリに 1 つ）
//
// 書き込み先は 2 つ。どちらに書くかは対象を開いているかで決める（後勝ちで巻き戻らないため）
// - 開いているノート・スキル: そのエディタ（registerLiveEditor。NoteEditorInner が docKey で登録する）
// - 閉じているもの: ファイル（registerEditFileHost。NoteApp が fm の保存関数で登録する）
// 状態（反映した・やめた）は appData の edit-proposal-status に変更 ID ごとに残す。
// 元に戻すはこの起動の中だけ（反映前の配列を覚えておき、反映後から誰も触っていなければ戻す）。

import { useEffect, useState } from "react";
import type { ChatEditProposal } from "../../../lib/document-types";
import { getActiveProvider } from "../../../lib/storage/registry";
import { applyEditChange } from "./edit-ops";
import type { EditProposalStatus } from "./EditProposalCard";

export type EditTarget = ChatEditProposal["target"];

/** ファイルとして読み書きする口（NoteApp が登録する） */
export type EditFileHost = {
  /** 題（または "this note"）から対象を決める。書き換えてはいけないものは error */
  resolveTarget(
    ref: string,
    ctx: { currentNoteId?: string | null; onlyIds?: ReadonlySet<string> },
  ): EditTarget | { error: string };
  /** 書き換えてよいスキルの一覧 */
  listSkills(): { id: string; title: string }[];
  /** 本文のブロック（pages[0].blocks）。読めなければ null */
  readFile(target: EditTarget): Promise<any[] | null>;
  /**
   * 本文のブロックを差し替えて保存する（来歴に AI の編集として残す）。
   * サイドピーク・別ウィンドウの未保存の編集を書き出せない（書くと後勝ちで巻き戻る）ときは書かずに "busy"
   */
  writeFile(target: EditTarget, blocks: any[]): Promise<boolean | "busy">;
  /** 反映の直前に対象を確かめ直す（保存された案が書き換えてはいけないものを指していないか）。問題があれば理由 */
  checkTarget(target: EditTarget): string | null;
  /** 対象を開く */
  openTarget(target: EditTarget): void;
};

/** 開いているエディタの口（NoteEditorInner が登録する） */
export type LiveEditorWriter = {
  read(): any[];
  write(blocks: any[]): void;
};

let fileHost: EditFileHost | null = null;
const liveEditors = new Map<string, LiveEditorWriter>();

export function registerEditFileHost(host: EditFileHost): () => void {
  fileHost = host;
  return () => {
    if (fileHost === host) fileHost = null;
  };
}

/** docKey はノートなら ID、スキルなら `skill:<id>`（fm.activeFileId と同じ形） */
export function registerLiveEditor(docKey: string, writer: LiveEditorWriter): () => void {
  liveEditors.set(docKey, writer);
  return () => {
    if (liveEditors.get(docKey) === writer) liveEditors.delete(docKey);
  };
}

export function getEditFileHost(): EditFileHost | null {
  return fileHost;
}

export function docKeyOf(target: EditTarget): string {
  return target.kind === "skill" ? `skill:${target.id}` : target.id;
}

/** 今の本文（開いていればエディタ、閉じていればファイル） */
export async function readTargetBlocks(target: EditTarget): Promise<any[] | null> {
  const live = liveEditors.get(docKeyOf(target));
  if (live) return live.read();
  return fileHost ? fileHost.readFile(target) : null;
}

async function writeTargetBlocks(target: EditTarget, blocks: any[]): Promise<boolean | "busy"> {
  const live = liveEditors.get(docKeyOf(target));
  if (live) {
    live.write(blocks);
    return true;
  }
  return fileHost ? fileHost.writeFile(target, blocks) : false;
}

// ── 状態（appData に残す） ─────────────────────────────

const STATUS_KEY = "edit-proposal-status";
let statuses: Record<string, EditProposalStatus> = {};
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();

function ensureLoaded(): Promise<void> {
  if (!loaded) {
    loaded = (async () => {
      try {
        const raw = await getActiveProvider().readAppData?.(STATUS_KEY);
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          statuses = { ...(raw as Record<string, EditProposalStatus>), ...statuses };
        }
      } catch {
        // 読めなくても未決として出す（反映の前に本文と照らすので二重には当たらない）
      }
      for (const l of listeners) l();
    })();
  }
  return loaded;
}

function setStatuses(ids: string[], status: EditProposalStatus): void {
  const next = { ...statuses };
  for (const id of ids) {
    if (status === "pending") delete next[id];
    else next[id] = status;
  }
  statuses = next;
  for (const l of listeners) l();
  void getActiveProvider()
    .writeAppData?.(STATUS_KEY, statuses)
    ?.catch((err: unknown) => console.warn("修正案の状態を保存できませんでした:", err));
}

/** 変更 ID → 状態（読み込み前は空） */
export function useEditProposalStatuses(): Readonly<Record<string, EditProposalStatus>> {
  const [snapshot, setSnapshot] = useState(statuses);
  useEffect(() => {
    const update = () => setSnapshot(statuses);
    listeners.add(update);
    void ensureLoaded().then(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  return snapshot;
}

// ── 元に戻す（この起動の中だけ） ───────────────────────

type UndoEntry = { target: EditTarget; changeIds: string[]; beforeBlocks: any[]; afterPrint: string };
const undoStack: UndoEntry[] = [];

/**
 * 誰かが触ったかを見るための指紋（ID・種別・props・中身。表のセルや文字色の変更も拾う）。
 * エディタは既定の props を足すことがあるので、反映後の指紋は書いた配列ではなく読み直した配列から取る
 */
function fingerprint(blocks: any[]): string {
  const parts: string[] = [];
  const walk = (list: any[]) => {
    for (const b of list ?? []) {
      parts.push(JSON.stringify([b?.id ?? null, b?.type ?? null, b?.props ?? {}, b?.content ?? null]));
      if (Array.isArray(b?.children)) walk(b.children);
    }
  };
  walk(blocks);
  return parts.join("\u0002");
}

export function canUndo(changeIds: string[]): boolean {
  return undoStack.some((e) => e.changeIds.some((id) => changeIds.includes(id)));
}

// ── 操作 ──────────────────────────────────────────

/** 選んだ変更を順に当てて 1 回で保存する。当てられなかった変更は stale / failed にする */
export async function applyProposal(proposal: ChatEditProposal, changeIds: string[]): Promise<void> {
  await ensureLoaded();
  // 保存された案（共有・取り込んだチャットも含む）が、書き換えてはいけないものを指していないかを反映の前に確かめる
  const problem = fileHost ? fileHost.checkTarget(proposal.target) : "editing is not available";
  if (problem) {
    console.warn("修正案を反映できません:", problem);
    setStatuses(changeIds, "failed");
    return;
  }
  const current = await readTargetBlocks(proposal.target);
  if (!current) {
    setStatuses(changeIds, "failed");
    return;
  }
  let blocks = current;
  const applied: string[] = [];
  const stale: string[] = [];
  const failed: string[] = [];
  for (const change of proposal.changes) {
    if (!changeIds.includes(change.id)) continue;
    const r = applyEditChange(blocks, change);
    if (r.ok) {
      blocks = r.blocks;
      applied.push(change.id);
    } else if (r.reason === "stale" || r.reason === "missing") {
      stale.push(change.id);
    } else {
      failed.push(change.id);
    }
  }
  if (applied.length > 0) {
    let ok: boolean | "busy";
    try {
      ok = await writeTargetBlocks(proposal.target, blocks);
    } catch (err) {
      console.error("修正案の書き込みに失敗:", err);
      ok = false;
    }
    if (ok === "busy") {
      // ピーク・別ウィンドウの未保存を書き出せなかった: 何も書いていないので、もう一度押せるようにする
      setStatuses(applied, "busy");
      return;
    }
    if (!ok) {
      setStatuses([...applied, ...failed], "failed");
      if (stale.length > 0) setStatuses(stale, "stale");
      return;
    }
    const written = (await readTargetBlocks(proposal.target)) ?? blocks;
    undoStack.push({ target: proposal.target, changeIds: applied, beforeBlocks: current, afterPrint: fingerprint(written) });
    setStatuses(applied, "applied");
  }
  if (stale.length > 0) setStatuses(stale, "stale");
  if (failed.length > 0) setStatuses(failed, "failed");
}

export function declineProposal(changeIds: string[]): void {
  void ensureLoaded().then(() => setStatuses(changeIds, "declined"));
}

/**
 * 反映を取り消す。反映した後に本文が変わっていれば戻さない（人の編集を消さないため）。
 * 戻せたら true。
 */
export async function undoProposal(changeIds: string[]): Promise<boolean> {
  for (let i = undoStack.length - 1; i >= 0; i--) {
    const entry = undoStack[i];
    if (!entry.changeIds.some((id) => changeIds.includes(id))) continue;
    const now = await readTargetBlocks(entry.target);
    if (!now || fingerprint(now) !== entry.afterPrint) return false;
    let ok: boolean | "busy";
    try {
      ok = await writeTargetBlocks(entry.target, entry.beforeBlocks);
    } catch (err) {
      console.error("修正案の取り消しに失敗:", err);
      ok = false;
    }
    if (ok !== true) return false;
    undoStack.splice(i, 1);
    setStatuses(entry.changeIds, "pending");
    return true;
  }
  return false;
}

export function openEditTarget(target: EditTarget): void {
  fileHost?.openTarget(target);
}

/** テスト用: 状態をまっさらにする */
export function __resetEditProposalControllerForTest(): void {
  fileHost = null;
  liveEditors.clear();
  statuses = {};
  loaded = null;
  undoStack.length = 0;
  listeners.clear();
}
