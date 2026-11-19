// 共有ノートの「順番に更新」の部品（共有ノートの全画面で使う）。
//
// 3 つの部品と 1 つの hook に分けてある:
//   - useSharedNoteVersions: 前の版の一覧と同期の競合コピーを、共有フォルダから読む
//   - SharedNoteUpdatePanel: 作者のスイッチ・最後に更新した人・前の版（右レール「バージョン」）
//   - AcceptsUpdatesBadge: 受け付け中の印（誰が見ても出す）
//   - ConflictCopiesNotice: 同期ソフトの競合コピーの注意
//
// 守っていること:
//   - 書き込みは update-shared-note.ts の関数だけを通す（判定は Rust 側）。ここは画面だけ
//   - 受け付けは権限ではなく事故防止。誰が更新できるかは共有フォルダの権限で決まる

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, History, Loader2, RotateCcw } from "lucide-react";
import { useT } from "../../i18n";
import type { AuthorIdentity } from "../document-provenance/types";
import type { ReadableCopyContext } from "./readable-copy";
import { LocalFolderSharedProvider, type SharedEntry } from "../../lib/storage/shared";
import { formatDateTime } from "../../lib/format-datetime";
import { confirmAction } from "../../ui/confirm-dialog";
import { SwitchButton } from "../settings/SettingToggle";
import {
  canUpdateSharedNote,
  restoreSharedVersion,
  setAcceptsUpdates,
} from "./update-shared-note";
import { notifySharedLibraryChanged } from "./shared-library-store";
import { sharedEntryTitle } from "./shared-entry-parts";

/**
 * extra.updatedBy から表示に使える名前だけを取り出す。共有フォルダのファイルは誰でも書き換えられるので、
 * name が文字列でないもの（オブジェクトなど）は使わない（React の子にそのまま置くと画面が落ちる）
 */
export function readUpdatedByName(entry: SharedEntry): string | undefined {
  const u = entry.extra?.updatedBy as { name?: unknown } | undefined;
  return u && typeof u.name === "string" && u.name ? u.name : undefined;
}

/** 共有フォルダへの読み書き。既定は実物。Storybook / テストで差し替える */
/**
 * 前の版 1 件の表示用の情報。ファイル名の時刻は「上書きされて控えに回った時刻」なので使わず、
 * 版の中身（updated_at と updatedBy / author）から「その版を作った日時と人」を出す。
 * 読めなかった版は ok=false（戻すボタンを出さない）
 */
export type SharedVersionInfo = {
  name: string;
  ok: boolean;
  /** その版を作った日時（ISO）。読めなければ null */
  at: string | null;
  /** その版を作った人の名前。分からなければ null */
  by: string | null;
};

/** 前の版を画面で読む件数の上限（Rust 側が控えるのも 5 件） */
const MAX_VERSIONS_SHOWN = 5;

export type SharedNoteUpdateOps = {
  listVersions: (root: string, id: string) => Promise<string[]>;
  /** 前の版の中身から、作った日時と人を読む（読めなければ ok=false） */
  readVersionInfo: (root: string, id: string, name: string) => Promise<SharedVersionInfo>;
  conflictCopies: (root: string, id: string) => Promise<string[]>;
  setAcceptsUpdates: typeof setAcceptsUpdates;
  restoreSharedVersion: typeof restoreSharedVersion;
};

export const defaultSharedNoteUpdateOps: SharedNoteUpdateOps = {
  listVersions: (root, id) => new LocalFolderSharedProvider(root).listVersions(id),
  readVersionInfo: async (root, id, name) => {
    try {
      const { entry } = await new LocalFolderSharedProvider(root).readVersion(id, name);
      const authorName = typeof entry.author?.name === "string" ? entry.author.name : null;
      return {
        name,
        ok: true,
        at: entry.updated_at,
        by: readUpdatedByName(entry) || authorName,
      };
    } catch {
      return { name, ok: false, at: null, by: null };
    }
  },
  conflictCopies: (root, id) => new LocalFolderSharedProvider(root).conflictCopies("note", id),
  setAcceptsUpdates,
  restoreSharedVersion,
};

/** 前の版の一覧（新しい順）と、同期の競合コピーのファイル名。note 以外は読まない */
export function useSharedNoteVersions(
  entry: SharedEntry,
  root: string,
  ops: SharedNoteUpdateOps = defaultSharedNoteUpdateOps,
) {
  const [versions, setVersions] = useState<SharedVersionInfo[]>([]);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [tick, setTick] = useState(0);
  const isNote = entry.type === "note";
  // 前の版は受け付け中のノートだけ読む（受け付けていなければ一覧は出さない）
  const accepting = isNote && canUpdateSharedNote(entry);

  useEffect(() => {
    if (!isNote) return;
    let cancelled = false;
    void (async () => {
      // 読めなくても画面は壊さない（一覧が空のまま）
      const [allNames, c] = await Promise.all([
        accepting ? ops.listVersions(root, entry.id).catch(() => [] as string[]) : Promise.resolve([] as string[]),
        ops.conflictCopies(root, entry.id).catch(() => [] as string[]),
      ]);
      // 並びは listVersions のまま（新しい順）。画面で読むのは先頭 5 件まで。各版の中身から日時と人を読む
      const names = allNames.slice(0, MAX_VERSIONS_SHOWN);
      const v = await Promise.all(
        names.map((name) =>
          ops
            .readVersionInfo(root, entry.id, name)
            .catch(() => ({ name, ok: false, at: null, by: null }) as SharedVersionInfo),
        ),
      );
      if (cancelled) return;
      setVersions(v);
      setConflicts(c);
    })();
    return () => {
      cancelled = true;
    };
    // ops は呼び出し側が固定で渡す前提（依存に入れると毎回読み直す）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNote, accepting, root, entry.id, entry.hash, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { versions, conflicts, reload };
}

/** 受け付け中の印。誰が見ても出す（作者でなくても写しを作って反映できる、の目印） */
export function AcceptsUpdatesBadge({ accepting }: { accepting: boolean }) {
  const t = useT();
  if (!accepting) return null;
  return (
    <span
      className="px-1 py-0.5 rounded bg-primary/10 text-primary text-[9px] shrink-0"
      data-tooltip={t("sharedNote.updates.badgeHint")}
      data-testid="shared-note-accepts-badge"
    >
      {t("sharedNote.updates.badge")}
    </span>
  );
}

/** 同期ソフトが残した競合コピーの注意。中身は自動では取り込まれていないことを言う */
export function ConflictCopiesNotice({ names }: { names: string[] }) {
  const t = useT();
  if (names.length === 0) return null;
  return (
    <div
      className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 space-y-1 text-xs"
      data-testid="shared-note-conflict-copies"
    >
      <div className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
        <AlertTriangle size={12} className="shrink-0" />
        {t("sharedNote.conflictCopies.title")}
      </div>
      <p className="text-muted-foreground leading-relaxed">
        {t("sharedNote.conflictCopies.body", { count: String(names.length) })}
      </p>
      <ul className="list-disc list-inside text-muted-foreground">
        {names.map((n) => (
          <li key={n} className="font-mono text-[10px] break-all">
            {n}
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground leading-relaxed">{t("sharedNote.conflictCopies.hint")}</p>
    </div>
  );
}

export type SharedNoteUpdatePanelProps = {
  entry: SharedEntry;
  isMine: boolean;
  currentIdentity: AuthorIdentity | null;
  /** 書き込み先（このエントリがある共有フォルダ） */
  root: string;
  versions: SharedVersionInfo[];
  /** 切り替え・戻したあとに版の一覧を読み直す */
  onReload: () => void;
  /** 自分が書いた版の hash を知らせる（自分で戻した直後に「更新あり」を出さないため） */
  onSelfWrite?: (hash: string) => void;
  /** 戻したあとに読める写しを置く材料。渡さなければ共有 id だけの最小の材料を使う */
  readable?: ReadableCopyContext;
  ops?: SharedNoteUpdateOps;
};

/** 右レール「バージョン」に置く節。note のときだけ出す */
export function SharedNoteUpdatePanel({
  entry,
  isMine,
  currentIdentity,
  root,
  versions,
  onReload,
  onSelfWrite,
  readable,
  ops = defaultSharedNoteUpdateOps,
}: SharedNoteUpdatePanelProps) {
  const t = useT();
  // 切り替え直後に、共有ストアの更新を待たず画面へ反映するための控え（版が変わったら捨てる）
  const [local, setLocal] = useState<{ hash: string; value: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const accepting =
    local && local.hash === entry.hash ? local.value : canUpdateSharedNote(entry);

  const handleToggle = useCallback(async () => {
    if (!currentIdentity) return;
    setBusy(true);
    setMessage(null);
    try {
      const next = !accepting;
      const result = await ops.setAcceptsUpdates(entry.id, next, { root, author: currentIdentity });
      if (result.ok) {
        setLocal({ hash: result.entry.hash, value: next });
        onSelfWrite?.(result.entry.hash);
        notifySharedLibraryChanged();
        onReload();
      } else if (result.conflict) {
        setMessage(t("sharedNote.updates.conflict"));
      } else {
        setMessage(t("sharedNote.updates.toggleFailed", { error: result.error }));
      }
    } finally {
      setBusy(false);
    }
  }, [accepting, currentIdentity, entry.id, onReload, onSelfWrite, ops, root, t]);

  const handleRestore = useCallback(
    async (version: SharedVersionInfo) => {
      if (!currentIdentity || !version.ok) return;
      const name = version.name;
      // 一覧と同じ値（その版を作った日時）を確認文にも使う
      const date = version.at ? formatDateTime(version.at) : name;
      const ok = await confirmAction(
        t("sharedNote.versions.restoreConfirm", { title: sharedEntryTitle(entry, t), date }),
      );
      if (!ok) return;
      setBusy(true);
      setMessage(null);
      try {
        const result = await ops.restoreSharedVersion(entry.id, name, {
          root,
          author: currentIdentity,
          // 読める写しの設定（共有フォルダごとのスイッチ）は syncReadableCopy が root から引く。
          // ここでは来歴の中でノートを指す名前だけ渡す（共有されたノートには手元の id が無いので共有 id）
          readable: readable ?? { noteId: entry.id },
        });
        if (result.ok) {
          setLocal(null);
          onSelfWrite?.(result.entry.hash);
          // 開いているエントリと本文を読み直す（共有ライブラリの再読み込み）。
          // 本文は entry.hash が変わると読み直される
          notifySharedLibraryChanged();
          onReload();
          if (result.readableCopy === "failed") setMessage(t("share.readableCopyFailed"));
        } else if (result.conflict) {
          setMessage(t("sharedNote.versions.restoreConflict"));
        } else {
          setMessage(t("sharedNote.versions.restoreFailed", { error: result.error }));
        }
      } finally {
        setBusy(false);
      }
    },
    [currentIdentity, entry, onReload, onSelfWrite, ops, readable, root, t],
  );

  if (entry.type !== "note" || entry.status === "unshared") return null;
  const updatedByName = readUpdatedByName(entry);

  return (
    <div className="space-y-3" data-testid="shared-note-updates">
      {isMine && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <SwitchButton
              checked={accepting}
              onChange={() => void handleToggle()}
              label={t("sharedNote.updates.toggle")}
              disabled={busy || !currentIdentity}
            />
            <span className="text-xs font-medium text-foreground">
              {t("sharedNote.updates.toggle")}
            </span>
            {busy && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {t("sharedNote.updates.help")}
          </p>
        </div>
      )}

      {message && (
        <p
          className="text-xs text-red-500 flex items-start gap-1"
          role="alert"
          data-testid="shared-note-updates-message"
        >
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span className="break-all">{message}</span>
        </p>
      )}

      {accepting && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <AcceptsUpdatesBadge accepting />
            {updatedByName && (
              <span className="text-[11px] text-muted-foreground" data-testid="shared-note-updated-by">
                {t("sharedNote.updates.lastUpdatedBy")}: {updatedByName}
                {" · "}
                {formatDateTime(entry.updated_at)}
              </span>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <History size={12} className="text-muted-foreground" />
              {t("sharedNote.versions.title")}
            </div>
            {versions.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">{t("sharedNote.versions.empty")}</p>
            ) : (
              <ul className="space-y-1" data-testid="shared-note-versions">
                {versions.map((v) => (
                  <li
                    key={v.name}
                    className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-2 py-1.5"
                  >
                    {v.ok && v.at ? (
                      <span className="text-[11px] text-foreground min-w-0">
                        {formatDateTime(v.at)}
                        {v.by ? ` · ${v.by}` : ""}
                      </span>
                    ) : (
                      <span
                        className="text-[11px] text-muted-foreground"
                        data-testid="shared-note-version-unreadable"
                      >
                        {t("sharedNote.versions.unreadable")}
                      </span>
                    )}
                    {v.ok && (
                      <button
                        type="button"
                        onClick={() => void handleRestore(v)}
                        disabled={busy || !currentIdentity}
                        className="text-[11px] px-2 py-1 rounded border border-border hover:bg-muted text-foreground transition-colors inline-flex items-center gap-1 disabled:opacity-50 shrink-0"
                      >
                        <RotateCcw size={11} />
                        {t("sharedNote.versions.restore")}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
