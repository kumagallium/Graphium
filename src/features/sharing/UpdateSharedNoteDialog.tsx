// 「共有に反映」の 2 つのダイアログ（順番に更新）。
//
//   - UpdateSharedNoteDialog: 反映の確認（反映先の題・更新者として残る名前）。
//     「反映する」を押すと updateSharedNoteFromCopy を呼ぶ
//   - UpdateConflictDialog: 先に更新されていたとき。何も書いていないことを伝え、
//     「最新の版から写しを作る」「提案として出す」「閉じる」を出す
//
// 作法は ProposeChangesDialog に合わせる（同じ枠・同じ入力・同じボタン配置、
// 本文は「押した時点」に組み立てる resolveSource）。トリガーは持たない。
// 手元の写しは、どちらのダイアログでも消さない。

import { DIALOG_LAYER } from "@/ui/z-layers";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { AlertCircle, AlertTriangle, Loader2, UploadCloud } from "lucide-react";
import { useT } from "../../i18n";
import type { GraphiumDocument } from "../../lib/document-types";
import { loadAuthorIdentity } from "../identity";
import {
  getBlobRoot,
  getShareIncludesPrivateHistory,
  type SharedEntry,
} from "../../lib/storage/shared";
import type { ReadableCopyContext } from "./readable-copy";
import { sharedEntryTitle } from "./shared-entry-parts";
import {
  getSharedEntryRoot,
  getSharedLibrarySnapshot,
  notifySharedLibraryChanged,
  subscribeSharedLibrary,
  useSharedLibrary,
} from "./shared-library-store";
import {
  canUpdateSharedNote,
  updateSharedNoteFromCopy,
  type UpdateSharedNoteResult,
} from "./update-shared-note";

/**
 * 対象の共有ノートが、他の人の更新を受け付けているか。
 *
 * スナップショットそのものではなく真偽値を返す（useNoteProposalCount と同じ作法）。
 * ノート本体はこの値で「共有に反映」の出し入れを決めるので、共有フォルダが更新されても
 * 値が変わらない限り再描画が起きない。
 */
export function useSharedNoteAcceptsUpdates(targetId: string | undefined | null): boolean {
  const get = useCallback(() => {
    if (!targetId) return false;
    const hit = getSharedLibrarySnapshot().entries.find(
      (e) => e.id === targetId && e.type === "note",
    );
    return !!hit && canUpdateSharedNote(hit);
  }, [targetId]);
  return useSyncExternalStore(subscribeSharedLibrary, get, get);
}

export type UpdateSharedNoteDialogProps = {
  open: boolean;
  /** 反映先＝派生元の共有エントリ id（doc.forkedFrom.sharedId）。実体は共有ストアから引く */
  targetId: string;
  /** DI: 共有エントリ一覧（既定は共有ストア）。Storybook / テスト用 */
  entries?: readonly SharedEntry[];
  /** 反映する本文を組み立てる（押した時点の最新。null なら反映しない） */
  resolveSource: () => Promise<GraphiumDocument | null>;
  /** 手元のノート id（渡すと反映後に基準版の控えを更新する） */
  noteId?: string;
  /** 読める写しの材料（ノート共有と同じもの） */
  readable?: ReadableCopyContext;
  onClose: () => void;
  /** 反映できた（共有ライブラリへの通知は済ませてある）。呼び出し側が返った doc を保存する */
  onUpdated?: (result: Extract<UpdateSharedNoteResult, { ok: true }>) => void;
  /** 先に更新されていた（何も書いていない）。ダイアログは閉じてから呼ぶ */
  onConflict?: () => void;
  /** DI: 実際の書き込み（既定は updateSharedNoteFromCopy）。テスト・Storybook 用 */
  __update?: typeof updateSharedNoteFromCopy;
};

const BACKDROP = `fixed inset-0 ${DIALOG_LAYER} flex items-center justify-center bg-black/40`;
const CARD = "bg-background border border-border rounded-lg shadow-2xl w-[90%] max-w-md p-5 space-y-4";

export function UpdateSharedNoteDialog({
  open,
  targetId,
  entries,
  resolveSource,
  noteId,
  readable,
  onClose,
  onUpdated,
  onConflict,
  __update,
}: UpdateSharedNoteDialogProps) {
  const t = useT();
  const snapshot = useSharedLibrary();
  const all = entries ?? snapshot.entries;
  const target = useMemo(
    () => all.find((e) => e.id === targetId && e.type === "note") ?? null,
    [all, targetId],
  );
  const author = loadAuthorIdentity();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    if (!author || !target) return;
    const root = getSharedEntryRoot(target.id);
    if (!root) return;
    setBusy(true);
    setError(null);
    try {
      const doc = await resolveSource();
      if (!doc) {
        setError(t("share.update.dialog.noTarget"));
        return;
      }
      const result = await (__update ?? updateSharedNoteFromCopy)(doc, {
        root,
        author,
        blobRoot: getBlobRoot(root) ?? undefined,
        // 単発の共有と同じく、設定のスイッチがそのまま効く（§24）
        includePrivateHistory: getShareIncludesPrivateHistory(),
        readable,
        noteId,
      });
      if (result.ok) {
        notifySharedLibraryChanged();
        onUpdated?.(result);
        onClose();
        return;
      }
      if (result.conflict) {
        // 何も書いていない。ここでは閉じて、次の選択肢は呼び出し側のダイアログに任せる
        onClose();
        onConflict?.();
        return;
      }
      setError(t("share.update.failed", { error: result.error }));
    } finally {
      setBusy(false);
    }
  }, [author, target, resolveSource, t, __update, readable, noteId, onUpdated, onClose, onConflict]);

  if (!open) return null;

  return (
    <div
      className={BACKDROP}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      data-testid="update-shared-note-dialog"
    >
      <div className={CARD}>
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-1.5">
            <UploadCloud size={14} className="text-muted-foreground" />
            {t("share.update.dialog.title")}
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t("share.update.dialog.help")}
          </p>
        </div>

        {target ? (
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 space-y-1.5">
            <div className="flex items-start gap-3 text-xs">
              <span className="text-muted-foreground w-16 shrink-0">
                {t("share.update.dialog.targetLabel")}
              </span>
              <span className="flex-1 min-w-0 text-foreground">
                <span className="block truncate font-medium">{sharedEntryTitle(target, t)}</span>
                {target.author?.name && (
                  <span className="block text-muted-foreground">{target.author.name}</span>
                )}
              </span>
            </div>
            <div className="flex items-start gap-3 text-xs">
              <span className="text-muted-foreground w-16 shrink-0">
                {t("share.update.dialog.byLabel")}
              </span>
              <span className="flex-1 min-w-0 text-foreground">
                <span className="block truncate font-medium">{author?.name ?? ""}</span>
                <span className="block text-muted-foreground leading-relaxed">
                  {t("share.update.dialog.byHelp")}
                </span>
              </span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground rounded-md border border-border bg-muted/30 px-3 py-2 leading-relaxed">
            {t("share.update.dialog.noTarget")}
          </p>
        )}

        {error && (
          <p className="text-xs text-red-500 flex items-start gap-1">
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            <span className="break-all">{error}</span>
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={busy || !target || !author}
            className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {busy ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                {t("share.sharing")}
              </>
            ) : (
              t("share.update.dialog.submit")
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export type UpdateConflictDialogProps = {
  open: boolean;
  /** 最新の版から写しを作る（既存の fork の処理）。呼び出し側がダイアログを閉じる */
  onFork: () => void;
  /** 提案として出す（既存の ProposeChangesDialog を開く）。未指定なら選択肢を出さない */
  onPropose?: () => void;
  onClose: () => void;
};

/** 先に更新されていたとき。共有には何も書いていないこと・手元の写しが残ることを伝える */
export function UpdateConflictDialog({ open, onFork, onPropose, onClose }: UpdateConflictDialogProps) {
  const t = useT();
  if (!open) return null;
  return (
    <div
      className={BACKDROP}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="update-conflict-dialog"
    >
      <div className={CARD}>
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-1.5">
            <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400" />
            {t("share.update.conflict.title")}
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t("share.update.conflict.body")}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("common.close")}
          </button>
          {onPropose && (
            <button
              onClick={onPropose}
              className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted text-foreground transition-colors"
            >
              {t("share.update.conflict.propose")}
            </button>
          )}
          <button
            onClick={onFork}
            className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            {t("share.update.conflict.fork")}
          </button>
        </div>
      </div>
    </div>
  );
}
