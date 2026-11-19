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

/** 共有フォルダへの読み書き。既定は実物。Storybook / テストで差し替える */
export type SharedNoteUpdateOps = {
  listVersions: (root: string, id: string) => Promise<string[]>;
  conflictCopies: (root: string, id: string) => Promise<string[]>;
  setAcceptsUpdates: typeof setAcceptsUpdates;
  restoreSharedVersion: typeof restoreSharedVersion;
};

export const defaultSharedNoteUpdateOps: SharedNoteUpdateOps = {
  listVersions: (root, id) => new LocalFolderSharedProvider(root).listVersions(id),
  conflictCopies: (root, id) => new LocalFolderSharedProvider(root).conflictCopies("note", id),
  setAcceptsUpdates,
  restoreSharedVersion,
};

/** 前の版のファイル名の先頭 13 桁は UTC ミリ秒。読めなければ null */
export function versionTime(name: string): number | null {
  const ms = Number(name.slice(0, 13));
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

/** 前の版の一覧（新しい順）と、同期の競合コピーのファイル名。note 以外は読まない */
export function useSharedNoteVersions(
  entry: SharedEntry,
  root: string,
  ops: SharedNoteUpdateOps = defaultSharedNoteUpdateOps,
) {
  const [versions, setVersions] = useState<string[]>([]);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [tick, setTick] = useState(0);
  const isNote = entry.type === "note";

  useEffect(() => {
    if (!isNote) return;
    let cancelled = false;
    void (async () => {
      // 読めなくても画面は壊さない（一覧が空のまま）
      const [v, c] = await Promise.all([
        ops.listVersions(root, entry.id).catch(() => [] as string[]),
        ops.conflictCopies(root, entry.id).catch(() => [] as string[]),
      ]);
      if (cancelled) return;
      setVersions(v);
      setConflicts(c);
    })();
    return () => {
      cancelled = true;
    };
    // ops は呼び出し側が固定で渡す前提（依存に入れると毎回読み直す）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNote, root, entry.id, entry.hash, tick]);

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
  versions: string[];
  /** 切り替え・戻したあとに版の一覧を読み直す */
  onReload: () => void;
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
  }, [accepting, currentIdentity, entry.id, onReload, ops, root, t]);

  const handleRestore = useCallback(
    async (name: string) => {
      if (!currentIdentity) return;
      const ms = versionTime(name);
      const date = ms !== null ? formatDateTime(ms) : name;
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
        });
        if (result.ok) {
          setLocal(null);
          notifySharedLibraryChanged();
          onReload();
        } else if (result.conflict) {
          setMessage(t("sharedNote.versions.restoreConflict"));
        } else {
          setMessage(t("sharedNote.versions.restoreFailed", { error: result.error }));
        }
      } finally {
        setBusy(false);
      }
    },
    [currentIdentity, entry, onReload, ops, root, t],
  );

  if (entry.type !== "note" || entry.status === "unshared") return null;
  const updatedBy = entry.extra?.updatedBy as { name?: string; email?: string } | undefined;

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
            {updatedBy?.name && (
              <span className="text-[11px] text-muted-foreground" data-testid="shared-note-updated-by">
                {t("sharedNote.updates.lastUpdatedBy")}: {updatedBy.name}
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
                {versions.map((name) => {
                  const ms = versionTime(name);
                  return (
                    <li
                      key={name}
                      className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-2 py-1.5"
                    >
                      <span className="text-[11px] text-foreground">
                        {ms !== null ? formatDateTime(ms) : name}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleRestore(name)}
                        disabled={busy || !currentIdentity}
                        className="text-[11px] px-2 py-1 rounded border border-border hover:bg-muted text-foreground transition-colors inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        <RotateCcw size={11} />
                        {t("sharedNote.versions.restore")}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
